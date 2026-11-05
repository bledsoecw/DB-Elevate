import 'server-only';
import { z } from 'zod';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { collectManagerChain, loadReportingGraph } from '../authz/actor';
import {
  canCreateImprovementPlan,
  canEditPlan,
  canViewPlan,
  type PlanRef,
} from '../authz/policy';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import type {
  DevelopmentPlanPatchSchema,
  DevelopmentPlanSchema,
  PlanActionSchema,
} from '../validation/admin';

/**
 * Development plans, and the restricted kind.
 *
 * Two plan types share one table because they are the same shape, but they are
 * governed differently and that difference is enforced in the service, not left
 * to whoever builds the next screen:
 *
 *  - A **development plan** is collaborative. The employee can work it
 *    themselves, their management chain can see it, and it reads as what it is:
 *    an agreement about growth.
 *
 *  - A **performance improvement plan** is a restricted personnel record. It is
 *    visible to the employee, their direct manager and HR — not the wider
 *    chain, and not leadership. `hrRestricted` is forced true on creation
 *    regardless of what the client sent, so a mis-set form cannot widen access
 *    to one. The employee can record progress against it but cannot alter its
 *    terms.
 *
 * Every list and read goes through `canViewPlan`, and the queries are filtered
 * in the database rather than fetched and hidden in the view, so a direct API
 * call sees exactly what a page would.
 */

type PlanInput = z.infer<typeof DevelopmentPlanSchema>;
type PlanPatch = z.infer<typeof DevelopmentPlanPatchSchema>;
type ActionInput = z.infer<typeof PlanActionSchema>;

/** Resolves the subject's current management chain, needed by canViewPlan. */
async function managerChainOf(orgId: string, employeeId: string): Promise<string[]> {
  const { managerOf } = await loadReportingGraph(orgId);
  return collectManagerChain(employeeId, managerOf);
}

function planRef(plan: {
  employeeId: string;
  planType: string;
  hrRestricted: boolean;
}, chain: string[]): PlanRef {
  return {
    employeeId: plan.employeeId,
    planType: plan.planType,
    hrRestricted: plan.hrRestricted,
    employeeManagerChainIds: chain,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface PlanFilters {
  employeeId?: string;
  planType?: 'DEVELOPMENT' | 'PERFORMANCE_IMPROVEMENT';
  status?: string;
  scope?: 'mine' | 'team' | 'all';
}

/**
 * Plans the actor may see.
 *
 * The `where` clause is built from the actor's position rather than filtered
 * afterwards. An improvement plan is only ever reachable through the narrow
 * branch — subject, direct manager, or HR — which is the same rule
 * `canViewPlan` states, expressed as a query so the database enforces it too.
 */
export async function listPlans(actor: Actor, filters: PlanFilters = {}) {
  if (!actor.employeeId && !actor.isHrAdmin) return [];

  const me = actor.employeeId;
  const scope = filters.scope ?? 'all';

  const visibility = actor.isHrAdmin
    ? {}
    : {
        OR: [
          // Own plans, of either kind.
          ...(me ? [{ employeeId: me }] : []),
          // Direct reports: both kinds, including improvement plans.
          ...(actor.directReportIds.length
            ? [{ employeeId: { in: actor.directReportIds } }]
            : []),
          // Wider chain: development plans only, never the restricted kind.
          ...(actor.descendantIds.length
            ? [
                {
                  employeeId: { in: actor.descendantIds },
                  planType: 'DEVELOPMENT',
                  hrRestricted: false,
                },
              ]
            : []),
        ],
      };

  const scopeWhere =
    scope === 'mine' && me
      ? { employeeId: me }
      : scope === 'team' && actor.directReportIds.length
        ? { employeeId: { in: actor.directReportIds } }
        : {};

  return prisma.developmentPlan.findMany({
    where: {
      orgId: actor.orgId,
      ...visibility,
      ...scopeWhere,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.planType ? { planType: filters.planType } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ status: 'asc' }, { targetDate: 'asc' }, { createdAt: 'desc' }],
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          jobTitle: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      actions: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, status: true, dueDate: true, itemType: true },
      },
      _count: { select: { checkIns: true, actions: true } },
    },
  });
}

export async function getPlan(actor: Actor, id: string) {
  const plan = await prisma.developmentPlan.findFirst({
    where: { id, orgId: actor.orgId },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          managerId: true,
          jobTitle: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      actions: {
        orderBy: { sortOrder: 'asc' },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          competency: { select: { id: true, name: true } },
        },
      },
      checkIns: {
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!plan) throw new NotFoundError();

  const chain = await managerChainOf(actor.orgId, plan.employeeId);
  if (!canViewPlan(actor, planRef(plan, chain))) {
    // 404 rather than 403: confirming that a named person has an improvement
    // plan is itself the disclosure.
    throw new NotFoundError();
  }

  return {
    ...plan,
    canEdit: canEditPlan(actor, planRef(plan, chain)),
    /** The employee may record progress on their own development plan. */
    canRecordProgress:
      canEditPlan(actor, planRef(plan, chain)) || plan.employeeId === actor.employeeId,
    isSubject: plan.employeeId === actor.employeeId,
  };
}

// ---------------------------------------------------------------------------
// Creating and editing
// ---------------------------------------------------------------------------

export async function createPlan(actor: Actor, input: PlanInput) {
  if (!actor.employeeId && !actor.isHrAdmin) throw new ForbiddenError();

  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, orgId: actor.orgId },
    select: { id: true, firstName: true, lastName: true, employmentStatus: true },
  });
  if (!employee) throw new NotFoundError();

  if (employee.employmentStatus === 'terminated') {
    throw new ConflictError(
      'That person has been deactivated, so a new plan cannot be started for them.',
    );
  }

  const isPip = input.planType === 'PERFORMANCE_IMPROVEMENT';

  if (isPip) {
    if (!canCreateImprovementPlan(actor, input.employeeId)) {
      throw new ForbiddenError(
        'An improvement plan can only be started by the person’s direct manager or an HR administrator.',
      );
    }
  } else {
    const chain = await managerChainOf(actor.orgId, input.employeeId);
    const mayWrite =
      actor.isHrAdmin ||
      input.employeeId === actor.employeeId ||
      actor.directReportIds.includes(input.employeeId) ||
      chain.includes(actor.employeeId ?? '');
    if (!mayWrite) {
      throw new ForbiddenError('You can only start a plan for yourself or for someone you manage.');
    }
  }

  const plan = await prisma.developmentPlan.create({
    data: {
      orgId: actor.orgId,
      employeeId: input.employeeId,
      title: input.title,
      description: input.description ?? null,
      planType: input.planType,
      status: 'DRAFT',
      startDate: input.startDate ? new Date(input.startDate) : null,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      // Forced, not trusted. An improvement plan is a restricted personnel
      // record whatever the client posted.
      hrRestricted: isPip ? true : (input.hrRestricted ?? false),
      createdById: actor.employeeId,
      actions: {
        create: (input.actions ?? []).map((action, index) => ({
          title: action.title,
          description: action.description ?? null,
          itemType: action.itemType ?? 'ACTION',
          ownerEmployeeId: action.ownerEmployeeId ?? input.employeeId,
          competencyId: action.competencyId ?? null,
          dueDate: action.dueDate ? new Date(action.dueDate) : null,
          status: action.status ?? 'OPEN',
          sortOrder: index,
        })),
      },
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PLAN_CREATED,
    entityType: 'development_plan',
    entityId: plan.id,
    summary: `Started a ${isPip ? 'performance improvement plan' : 'development plan'} for ${employee.firstName} ${employee.lastName}: "${plan.title}"`,
    metadata: { planType: plan.planType, hrRestricted: plan.hrRestricted },
  });

  return plan;
}

export async function updatePlan(actor: Actor, id: string, input: PlanPatch) {
  const existing = await prisma.developmentPlan.findFirst({
    where: { id, orgId: actor.orgId },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  if (!existing) throw new NotFoundError();

  const chain = await managerChainOf(actor.orgId, existing.employeeId);
  const ref = planRef(existing, chain);
  if (!canViewPlan(actor, ref)) throw new NotFoundError();
  if (!canEditPlan(actor, ref)) {
    throw new ForbiddenError(
      existing.planType === 'PERFORMANCE_IMPROVEMENT'
        ? 'Only the manager who owns this improvement plan, or an HR administrator, can change its terms.'
        : 'You do not have permission to change this plan.',
    );
  }

  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
    if (input.status !== 'ACTIVE') {
      throw new ConflictError(
        'This plan is closed. Reopen it before editing, so the record shows that it was reopened rather than quietly changing a closed plan.',
      );
    }
  }

  // Downgrading an improvement plan's restriction is never allowed: it would
  // retroactively widen who can read a record written under a narrower promise.
  if (existing.planType === 'PERFORMANCE_IMPROVEMENT' && input.hrRestricted === false) {
    throw new ConflictError(
      'An improvement plan stays restricted to the employee, their manager and HR. That cannot be relaxed — ' +
        'it was written on that understanding.',
    );
  }

  const closing =
    (input.status === 'COMPLETED' || input.status === 'CANCELLED') &&
    existing.status !== input.status;

  if (closing && !input.outcome?.trim()) {
    throw new ValidationError('Record the outcome when closing a plan.', [
      { path: 'outcome', message: 'Say how it ended — it is the part a later reader needs.' },
    ]);
  }

  const plan = await prisma.developmentPlan.update({
    where: { id },
    data: {
      title: input.title ?? undefined,
      description: input.description === undefined ? undefined : input.description,
      status: input.status ?? undefined,
      startDate:
        input.startDate === undefined
          ? undefined
          : input.startDate
            ? new Date(input.startDate)
            : null,
      targetDate:
        input.targetDate === undefined
          ? undefined
          : input.targetDate
            ? new Date(input.targetDate)
            : null,
      hrRestricted: input.hrRestricted ?? undefined,
      outcome: input.outcome === undefined ? undefined : input.outcome,
      closedAt: closing ? new Date() : input.status === 'ACTIVE' ? null : undefined,
    },
  });

  await recordAudit(actor, {
    action: closing ? AUDIT_ACTIONS.PLAN_CLOSED : AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: 'development_plan',
    entityId: id,
    summary: closing
      ? `Closed the plan "${plan.title}" for ${existing.employee.firstName} ${existing.employee.lastName} as ${plan.status.toLowerCase()}`
      : `Updated the plan "${plan.title}" for ${existing.employee.firstName} ${existing.employee.lastName}`,
    metadata: { from: existing.status, to: plan.status },
  });

  // Activating a plan is the moment the employee needs to know it exists.
  if (input.status === 'ACTIVE' && existing.status === 'DRAFT') {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: existing.employeeId,
      type: 'plan.activated',
      title:
        existing.planType === 'PERFORMANCE_IMPROVEMENT'
          ? 'A performance improvement plan has been started with you'
          : 'Your development plan is active',
      body: plan.title,
      linkUrl: `/development/${plan.id}`,
      severity: existing.planType === 'PERFORMANCE_IMPROVEMENT' ? 'urgent' : 'info',
      dedupeKey: `plan.activated:${plan.id}`,
    });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Actions and check-ins
// ---------------------------------------------------------------------------

export async function upsertPlanAction(actor: Actor, planId: string, input: ActionInput) {
  const { plan, ref } = await loadForWrite(actor, planId);
  if (!canEditPlan(actor, ref)) {
    throw new ForbiddenError('You do not have permission to change this plan’s actions.');
  }

  if (input.id) {
    const action = await prisma.developmentAction.findFirst({
      where: { id: input.id, planId },
      select: { id: true },
    });
    if (!action) throw new NotFoundError();
    await prisma.developmentAction.update({
      where: { id: input.id },
      data: {
        title: input.title,
        description: input.description ?? null,
        itemType: input.itemType ?? undefined,
        ownerEmployeeId: input.ownerEmployeeId ?? undefined,
        competencyId: input.competencyId === undefined ? undefined : input.competencyId,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        status: input.status ?? undefined,
        completedAt: input.status === 'COMPLETED' ? new Date() : input.status ? null : undefined,
      },
    });
  } else {
    const max = await prisma.developmentAction.aggregate({
      where: { planId },
      _max: { sortOrder: true },
    });
    await prisma.developmentAction.create({
      data: {
        planId,
        title: input.title,
        description: input.description ?? null,
        itemType: input.itemType ?? 'ACTION',
        ownerEmployeeId: input.ownerEmployeeId ?? plan.employeeId,
        competencyId: input.competencyId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        status: input.status ?? 'OPEN',
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
  }

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: 'development_plan',
    entityId: planId,
    summary: `${input.id ? 'Updated' : 'Added'} the action "${input.title}" on "${plan.title}"`,
  });
}

/**
 * Marks an action done. Available to the employee on their own plan — including
 * an improvement plan, where they cannot change the terms but must be able to
 * show they have met them.
 */
export async function setActionStatus(
  actor: Actor,
  planId: string,
  actionId: string,
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
): Promise<void> {
  const { plan, ref } = await loadForWrite(actor, planId);
  const mayRecord = canEditPlan(actor, ref) || plan.employeeId === actor.employeeId;
  if (!mayRecord) throw new ForbiddenError('You cannot change this plan.');

  const action = await prisma.developmentAction.findFirst({
    where: { id: actionId, planId },
    select: { id: true, title: true, status: true },
  });
  if (!action) throw new NotFoundError();

  // Cancelling an action is a change to the plan's terms, not progress against
  // them, so the subject alone cannot do it.
  if (status === 'CANCELLED' && !canEditPlan(actor, ref)) {
    throw new ForbiddenError(
      'Cancelling an action changes the plan itself. Record it as still open and raise it with your manager instead.',
    );
  }

  await prisma.developmentAction.update({
    where: { id: actionId },
    data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: 'development_plan',
    entityId: planId,
    summary: `Marked "${action.title}" as ${status.toLowerCase().replace('_', ' ')} on "${plan.title}"`,
    metadata: { actionId, from: action.status, to: status },
  });
}

export async function deletePlanAction(
  actor: Actor,
  planId: string,
  actionId: string,
): Promise<void> {
  const { plan, ref } = await loadForWrite(actor, planId);
  if (!canEditPlan(actor, ref)) throw new ForbiddenError();
  const action = await prisma.developmentAction.findFirst({
    where: { id: actionId, planId },
    select: { id: true, title: true },
  });
  if (!action) throw new NotFoundError();
  await prisma.developmentAction.delete({ where: { id: actionId } });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: 'development_plan',
    entityId: planId,
    summary: `Removed the action "${action.title}" from "${plan.title}"`,
  });
}

/**
 * A check-in is the conversation record. Both the employee and whoever may edit
 * the plan can add one, and they are never editable or deletable afterwards —
 * an append-only thread is what makes the history worth reading.
 */
export async function addPlanCheckIn(actor: Actor, planId: string, body: string): Promise<void> {
  if (!actor.employeeId) throw new ForbiddenError('A check-in has to be attributable to a person.');
  const { plan, ref } = await loadForWrite(actor, planId);
  const mayWrite = canEditPlan(actor, ref) || plan.employeeId === actor.employeeId;
  if (!mayWrite) throw new ForbiddenError('You cannot add a check-in to this plan.');

  await prisma.planCheckIn.create({
    data: { planId, authorEmployeeId: actor.employeeId, body: body.trim() },
  });

  // Tell the other side there is something to read.
  const recipient =
    plan.employeeId === actor.employeeId ? plan.employee.managerId : plan.employeeId;
  if (recipient && recipient !== actor.employeeId) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: recipient,
      type: 'plan.checkin',
      title: `New check-in on "${plan.title}"`,
      body: `${actor.displayName} added a note.`,
      linkUrl: `/development/${planId}`,
      dedupeKey: `plan.checkin:${planId}:${Date.now()}`,
    });
  }

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: 'development_plan',
    entityId: planId,
    summary: `Added a check-in to "${plan.title}"`,
  });
}

async function loadForWrite(actor: Actor, planId: string) {
  const plan = await prisma.developmentPlan.findFirst({
    where: { id: planId, orgId: actor.orgId },
    include: { employee: { select: { managerId: true, firstName: true, lastName: true } } },
  });
  if (!plan) throw new NotFoundError();
  const chain = await managerChainOf(actor.orgId, plan.employeeId);
  const ref = planRef(plan, chain);
  if (!canViewPlan(actor, ref)) throw new NotFoundError();
  return { plan, ref };
}

/** People the actor may start a plan for, for the create form. */
export async function planSubjectOptions(actor: Actor) {
  const ids = new Set<string>(actor.directReportIds);
  if (actor.employeeId) ids.add(actor.employeeId);

  const employees = await prisma.employee.findMany({
    where: {
      orgId: actor.orgId,
      employmentStatus: { not: 'terminated' },
      ...(actor.isHrAdmin ? {} : { id: { in: [...ids] } }),
    },
    orderBy: [{ lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      jobTitle: { select: { name: true } },
    },
  });

  return employees.map((e) => ({
    id: e.id,
    name: `${e.preferredName ?? e.firstName} ${e.lastName}`,
    jobTitle: e.jobTitle?.name ?? null,
    /** Whether this actor could open the restricted kind for this person. */
    canStartImprovement: canCreateImprovementPlan(actor, e.id),
  }));
}
