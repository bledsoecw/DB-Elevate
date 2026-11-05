import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { collectDescendants, loadReportingGraph } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  canChangeReportingLine,
  canDeactivateEmployee,
  canEditEmployeeRecord,
  canViewEmployeePerformanceRecord,
  employeeAccess,
  type EmployeeAccess,
} from '../authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { revokeAllSessionsForUser } from '../auth/session';
import { hashPassword } from '../auth/password';
import { notify } from '../notify';

/**
 * People: the employee directory, profiles and employment changes.
 *
 * Two rules shape this module:
 *
 *  - Everyone can look a colleague up in the directory (name, title,
 *    department, manager) because that is what a wall chart would show.
 *    Everything else — reviews, goals, feedback, plans — is gated.
 *  - A reporting-line change is an event, not an edit. It closes the open
 *    ManagerAssignment row and opens a new one, leaving every historical
 *    review pointing at the manager who actually wrote it.
 */

export interface DirectoryFilters {
  query?: string;
  departmentId?: string;
  jobTitleId?: string;
  managerId?: string;
  status?: 'active' | 'on_leave' | 'terminated' | 'all';
  scope?: 'all' | 'team' | 'direct';
}

export async function listDirectory(actor: Actor, filters: DirectoryFilters = {}) {
  const status = filters.status ?? 'active';
  const where: Record<string, unknown> = { orgId: actor.orgId };

  if (status !== 'all') where.employmentStatus = status;
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.jobTitleId) where.jobTitleId = filters.jobTitleId;
  if (filters.managerId) where.managerId = filters.managerId;

  if (filters.scope === 'direct' && actor.employeeId) {
    where.id = { in: actor.directReportIds };
  } else if (filters.scope === 'team' && actor.employeeId) {
    where.id = { in: [actor.employeeId, ...actor.descendantIds] };
  }

  if (filters.query) {
    const q = filters.query.trim();
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { preferredName: { contains: q } },
      { workEmail: { contains: q } },
      { employeeNumber: { contains: q } },
      { crew: { contains: q } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: 500,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      workEmail: true,
      employeeNumber: true,
      employmentStatus: true,
      employmentType: true,
      hireDate: true,
      workLocation: true,
      crew: true,
      userId: true,
      department: { select: { id: true, name: true } },
      jobTitle: { select: { id: true, name: true, level: true } },
      manager: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      _count: { select: { directReports: true } },
    },
  });

  return employees.map((e) => ({
    ...e,
    access: employeeAccess(actor, e.id),
    hasAccount: e.userId !== null,
  }));
}

export async function getEmployeeProfile(actor: Actor, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    include: {
      department: true,
      jobTitle: { include: { competencyLibrary: { include: { items: { include: { competency: true } } } } } },
      manager: { select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: { select: { name: true } } } },
      directReports: {
        where: { employmentStatus: { not: 'terminated' } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          jobTitle: { select: { name: true } },
        },
        orderBy: { lastName: 'asc' },
      },
      user: { select: { id: true, email: true, status: true, lastLoginAt: true, roles: true } },
      managerAssignments: {
        orderBy: { effectiveFrom: 'desc' },
        include: { manager: { select: { firstName: true, lastName: true, preferredName: true } } },
      },
    },
  });

  if (!employee) throw new NotFoundError();

  const access: EmployeeAccess = employeeAccess(actor, employeeId);
  const canSeeRecord = canViewEmployeePerformanceRecord(actor, employeeId);

  return {
    employee,
    access,
    canSeeRecord,
    canEdit: canEditEmployeeRecord(actor, employeeId),
    canChangeManager: canChangeReportingLine(actor),
    canDeactivate: canDeactivateEmployee(actor) && employee.employmentStatus !== 'terminated',
    isSelf: actor.employeeId === employeeId,
  };
}

// ---------------------------------------------------------------------------
// Creating and editing
// ---------------------------------------------------------------------------

export interface EmployeeInput {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  workEmail: string;
  workPhone?: string | null;
  employeeNumber?: string | null;
  departmentId?: string | null;
  jobTitleId?: string | null;
  managerId?: string | null;
  hireDate?: string | null;
  employmentType?: string;
  employmentStatus?: string;
  workLocation?: string | null;
  crew?: string | null;
  reviewCohort?: string | null;
  reviewEligible?: boolean;
  createAccount?: boolean;
  temporaryPassword?: string | null;
}

/** Guards against a reporting loop, which would break every chain walk. */
async function assertNoReportingLoop(
  orgId: string,
  employeeId: string | null,
  managerId: string | null,
): Promise<void> {
  if (!managerId || !employeeId) return;
  if (managerId === employeeId) {
    throw new ValidationError('Someone cannot be their own manager.');
  }
  const { childrenOf } = await loadReportingGraph(orgId);
  const descendants = collectDescendants(employeeId, childrenOf);
  if (descendants.includes(managerId)) {
    throw new ValidationError(
      'That change would create a loop in the reporting structure: the proposed manager already reports to this person.',
    );
  }
}

export async function createEmployee(actor: Actor, input: EmployeeInput) {
  if (!actor.isHrAdmin) {
    throw new ForbiddenError('Only an HR administrator can add an employee.');
  }

  const email = input.workEmail.trim().toLowerCase();
  const existing = await prisma.employee.findFirst({
    where: { orgId: actor.orgId, workEmail: email },
    select: { id: true, firstName: true, lastName: true, employmentStatus: true },
  });
  if (existing) {
    throw new ConflictError(
      `${existing.firstName} ${existing.lastName} already uses ${email}${existing.employmentStatus === 'terminated' ? ' (deactivated)' : ''}. Reactivate that record instead of creating a second one.`,
    );
  }

  await assertNoReportingLoop(actor.orgId, null, input.managerId ?? null);

  const hireDate = input.hireDate ? new Date(input.hireDate) : null;

  const employee = await prisma.$transaction(async (tx) => {
    let userId: string | null = null;

    if (input.createAccount !== false) {
      const temporary = input.temporaryPassword?.trim();
      if (!temporary || temporary.length < 10) {
        throw new ValidationError(
          'Set a temporary password of at least 10 characters, or create the record without an account.',
        );
      }
      const user = await tx.user.create({
        data: {
          orgId: actor.orgId,
          email,
          passwordHash: await hashPassword(temporary),
          status: 'active',
          mustChangePassword: true,
        },
      });
      userId = user.id;
      await tx.userRole.create({ data: { userId: user.id, role: 'EMPLOYEE' } });
    }

    const created = await tx.employee.create({
      data: {
        orgId: actor.orgId,
        userId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        preferredName: input.preferredName?.trim() || null,
        workEmail: email,
        workPhone: input.workPhone?.trim() || null,
        employeeNumber: input.employeeNumber?.trim() || null,
        departmentId: input.departmentId || null,
        jobTitleId: input.jobTitleId || null,
        managerId: input.managerId || null,
        hireDate,
        employmentType: input.employmentType ?? 'full_time',
        employmentStatus: input.employmentStatus ?? 'active',
        workLocation: input.workLocation?.trim() || null,
        crew: input.crew?.trim() || null,
        reviewCohort: input.reviewCohort?.trim() || null,
        reviewEligible: input.reviewEligible ?? true,
      },
    });

    // Open the first reporting-line record.
    await tx.managerAssignment.create({
      data: {
        employeeId: created.id,
        managerId: input.managerId || null,
        effectiveFrom: hireDate ?? new Date(),
        reason: 'Initial assignment when the employee record was created.',
        createdById: actor.userId,
      },
    });

    return created;
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
    entityType: 'employee',
    entityId: employee.id,
    summary: `Added ${employee.firstName} ${employee.lastName}.`,
    metadata: { email, withAccount: employee.userId !== null },
  });

  return employee;
}

export async function updateEmployee(actor: Actor, employeeId: string, input: Partial<EmployeeInput>) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
  });
  if (!employee) throw new NotFoundError();

  if (!canEditEmployeeRecord(actor, employeeId)) {
    throw new ForbiddenError('You can only edit the records of people who report directly to you.');
  }

  // A manager may maintain details, but reporting line and employment status
  // are HR decisions with downstream consequences.
  const restricted = ['managerId', 'employmentStatus', 'reviewEligible'] as const;
  for (const field of restricted) {
    if (input[field] !== undefined && input[field] !== (employee as Record<string, unknown>)[field]) {
      if (!actor.isHrAdmin) {
        throw new ForbiddenError(
          'Changing the reporting line, employment status or review eligibility is restricted to HR administrators.',
        );
      }
    }
  }

  const data: Record<string, unknown> = {};
  const changes: string[] = [];
  const assign = <K extends keyof EmployeeInput>(key: K, column: string, transform?: (v: unknown) => unknown) => {
    if (input[key] === undefined) return;
    const next = transform ? transform(input[key]) : input[key];
    if (next !== (employee as Record<string, unknown>)[column]) {
      data[column] = next;
      changes.push(column);
    }
  };

  assign('firstName', 'firstName', (v) => String(v).trim());
  assign('lastName', 'lastName', (v) => String(v).trim());
  assign('preferredName', 'preferredName', (v) => (v ? String(v).trim() : null));
  assign('workPhone', 'workPhone', (v) => (v ? String(v).trim() : null));
  assign('employeeNumber', 'employeeNumber', (v) => (v ? String(v).trim() : null));
  assign('departmentId', 'departmentId', (v) => v || null);
  assign('jobTitleId', 'jobTitleId', (v) => v || null);
  assign('workLocation', 'workLocation', (v) => (v ? String(v).trim() : null));
  assign('crew', 'crew', (v) => (v ? String(v).trim() : null));
  assign('reviewCohort', 'reviewCohort', (v) => (v ? String(v).trim() : null));
  assign('employmentType', 'employmentType');
  assign('reviewEligible', 'reviewEligible');
  if (input.hireDate !== undefined) {
    data.hireDate = input.hireDate ? new Date(input.hireDate) : null;
    changes.push('hireDate');
  }

  // The reporting line goes through its own path so history is written.
  if (input.managerId !== undefined && input.managerId !== employee.managerId) {
    await changeManager(actor, employeeId, input.managerId || null, 'Updated from the employee record.');
  }

  if (Object.keys(data).length === 0) return employee;

  const updated = await prisma.employee.update({ where: { id: employeeId }, data });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
    entityType: 'employee',
    entityId: employeeId,
    summary: `Updated ${updated.firstName} ${updated.lastName} (${changes.join(', ')}).`,
    metadata: { fields: changes },
  });

  return updated;
}

/**
 * A reporting-line change.
 *
 * Closes the current assignment and opens a new one. Existing review records
 * keep their launch-time manager snapshot, so this never alters who wrote,
 * approved or can read a past review.
 */
export async function changeManager(
  actor: Actor,
  employeeId: string,
  newManagerId: string | null,
  reason: string,
  effectiveFrom: Date = new Date(),
): Promise<void> {
  if (!canChangeReportingLine(actor)) {
    throw new ForbiddenError('Only an HR administrator can change a reporting line.');
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    select: { id: true, firstName: true, lastName: true, managerId: true },
  });
  if (!employee) throw new NotFoundError();
  if (employee.managerId === newManagerId) return;

  if (newManagerId) {
    const manager = await prisma.employee.findFirst({
      where: { id: newManagerId, orgId: actor.orgId },
      select: { id: true, firstName: true, lastName: true, employmentStatus: true },
    });
    if (!manager) throw new ValidationError('That manager record does not exist.');
    if (manager.employmentStatus === 'terminated') {
      throw new ValidationError('A deactivated employee cannot be set as someone’s manager.');
    }
  }

  await assertNoReportingLoop(actor.orgId, employeeId, newManagerId);

  const previousManagerId = employee.managerId;

  await prisma.$transaction(async (tx) => {
    await tx.managerAssignment.updateMany({
      where: { employeeId, effectiveTo: null },
      data: { effectiveTo: effectiveFrom },
    });
    await tx.managerAssignment.create({
      data: {
        employeeId,
        managerId: newManagerId,
        effectiveFrom,
        reason: reason.trim() || 'Reporting line changed.',
        createdById: actor.userId,
      },
    });
    await tx.employee.update({ where: { id: employeeId }, data: { managerId: newManagerId } });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.MANAGER_CHANGED,
    entityType: 'employee',
    entityId: employeeId,
    summary: `Changed the manager of ${employee.firstName} ${employee.lastName}. Existing review records keep their original manager of record.`,
    metadata: { from: previousManagerId, to: newManagerId, reason, effectiveFrom },
  });

  // Tell the new manager, and anyone with an in-flight review of this person.
  if (newManagerId) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: newManagerId,
      type: 'employee.transferred_in',
      title: `${employee.firstName} ${employee.lastName} now reports to you`,
      body: 'Reviews already under way stay with the previous manager so the record is not disturbed.',
      linkUrl: `/people/${employeeId}`,
      dedupeKey: `transfer:${employeeId}:${effectiveFrom.getTime()}`,
    });
  }
}

/**
 * Deactivation.
 *
 * The employee record and every review, goal and piece of feedback are kept —
 * that history is the point of the system. What stops is access: sessions are
 * revoked, the account cannot sign in, and open assignments are surfaced to HR
 * as exceptions to reassign rather than silently deleted.
 */
export async function deactivateEmployee(
  actor: Actor,
  employeeId: string,
  options: { terminationDate?: Date; reason: string },
): Promise<{ openAssignments: number; directReports: number }> {
  if (!canDeactivateEmployee(actor)) {
    throw new ForbiddenError('Only an HR administrator can deactivate an employee.');
  }
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    include: { user: { select: { id: true } }, directReports: { select: { id: true } } },
  });
  if (!employee) throw new NotFoundError();
  if (employee.employmentStatus === 'terminated') {
    throw new ConflictError('That employee is already deactivated.');
  }
  if (actor.employeeId === employeeId) {
    throw new ValidationError('You cannot deactivate your own account.');
  }
  if (!options.reason || options.reason.trim().length < 5) {
    throw new ValidationError('Record a short reason. It is kept in the audit log.');
  }

  const openAssignments = await prisma.reviewAssignment.count({
    where: {
      reviewerEmployeeId: employeeId,
      status: { in: ['NOT_STARTED', 'DRAFT', 'REOPENED'] },
      participant: { cycle: { status: 'ACTIVE' } },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employeeId },
      data: {
        employmentStatus: 'terminated',
        terminationDate: options.terminationDate ?? new Date(),
        reviewEligible: false,
      },
    });
    if (employee.user) {
      await tx.user.update({ where: { id: employee.user.id }, data: { status: 'deactivated' } });
    }
    // Close the open reporting-line record so historical lookups are exact.
    await tx.managerAssignment.updateMany({
      where: { employeeId, effectiveTo: null },
      data: { effectiveTo: options.terminationDate ?? new Date() },
    });
  });

  if (employee.user) await revokeAllSessionsForUser(employee.user.id);

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EMPLOYEE_DEACTIVATED,
    entityType: 'employee',
    entityId: employeeId,
    summary: `Deactivated ${employee.firstName} ${employee.lastName}. History retained; sign-in revoked.`,
    metadata: {
      reason: options.reason.trim(),
      openAssignments,
      directReports: employee.directReports.length,
    },
  });

  return { openAssignments, directReports: employee.directReports.length };
}

export async function reactivateEmployee(actor: Actor, employeeId: string): Promise<void> {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can reactivate an employee.');
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    include: { user: true },
  });
  if (!employee) throw new NotFoundError();
  if (employee.employmentStatus !== 'terminated') {
    throw new ConflictError('That employee is already active.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employeeId },
      data: { employmentStatus: 'active', terminationDate: null, reviewEligible: true },
    });
    if (employee.user) {
      await tx.user.update({ where: { id: employee.user.id }, data: { status: 'active' } });
    }
    await tx.managerAssignment.create({
      data: {
        employeeId,
        managerId: employee.managerId,
        effectiveFrom: new Date(),
        reason: 'Reactivated.',
        createdById: actor.userId,
      },
    });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EMPLOYEE_REACTIVATED,
    entityType: 'employee',
    entityId: employeeId,
    summary: `Reactivated ${employee.firstName} ${employee.lastName}.`,
  });
}

/** Options for the department / job title / manager pickers. */
export async function getFormOptions(orgId: string) {
  const [departments, jobTitles, managers] = await Promise.all([
    prisma.department.findMany({
      where: { orgId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.jobTitle.findMany({
      where: { orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, level: true },
    }),
    prisma.employee.findMany({
      where: { orgId, employmentStatus: { not: 'terminated' } },
      orderBy: [{ lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: { select: { name: true } } },
    }),
  ]);
  return { departments, jobTitles, managers };
}
