import 'server-only';
import { z } from 'zod';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import {
  canAdministerApp,
  canAdministerProgram,
  canManageAccountsAndRoles,
  canManageOrgSettings,
  canReadAuditLog,
} from '../authz/policy';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { hashPassword } from '../auth/password';
import { ROLES, type Role } from '@/lib/enums';
import type { OrgSettingsSchema } from '../validation/admin';
import { containsInsensitive, startsWithInsensitive } from '../search';
import { accountUsesSso } from '../auth/sso';

/**
 * Application administration: organization settings and branding, accounts and
 * roles, the audit log, the e-mail outbox, optional AI configuration, and
 * removal of the demonstration data.
 *
 * The role split is the point of this module. A system administrator runs the
 * application — accounts, branding, integrations, the log — and gets no review
 * content for doing so. An HR administrator runs the performance programme and
 * gets no keys to the application. Where one person genuinely needs both, both
 * roles are granted explicitly, and the grant itself is audited.
 */

type OrgSettingsInput = z.infer<typeof OrgSettingsSchema>;

// ---------------------------------------------------------------------------
// Organization settings and branding
// ---------------------------------------------------------------------------

export async function getOrgSettings(actor: Actor) {
  if (!canManageOrgSettings(actor)) {
    throw new ForbiddenError('Only a system administrator can view organization settings.');
  }
  const org = await prisma.organization.findUnique({ where: { id: actor.orgId } });
  if (!org) throw new NotFoundError();
  return org;
}

/**
 * AI fields are deliberately *not* writable here — they go through
 * `updateAiSettings`, which enforces the budget and provider rules. Splitting
 * them stops a careless settings save from switching on a metered service.
 */
export async function updateOrgSettings(actor: Actor, input: OrgSettingsInput) {
  if (!canManageOrgSettings(actor)) {
    throw new ForbiddenError('Only a system administrator can change organization settings.');
  }

  const before = await prisma.organization.findUnique({ where: { id: actor.orgId } });
  if (!before) throw new NotFoundError();

  if (input.emailProvider && input.emailProvider !== 'outbox') {
    // Switching to a real provider is a deliberate, auditable act and it needs
    // server-side credentials that are never stored in the database.
    const configured = process.env.EMAIL_TRANSPORT_CONFIGURED === 'true';
    if (!configured) {
      throw new ConflictError(
        'No mail transport is configured on the server, so messages would be queued and never sent. ' +
          'Set the mail environment variables and EMAIL_TRANSPORT_CONFIGURED=true (see docs/DEPLOYMENT.md), ' +
          'then switch the provider.',
      );
    }
  }

  const org = await prisma.organization.update({
    where: { id: actor.orgId },
    data: {
      name: input.name ?? undefined,
      productName: input.productName ?? undefined,
      wordmarkText: input.wordmarkText === undefined ? undefined : input.wordmarkText,
      logoUrl: input.logoUrl === undefined ? undefined : input.logoUrl,
      brandPrimaryHex: input.brandPrimaryHex ?? undefined,
      brandAccentHex: input.brandAccentHex ?? undefined,
      timezone: input.timezone ?? undefined,
      surveyMinResponses: input.surveyMinResponses ?? undefined,
      surveySuppressComplement: input.surveySuppressComplement ?? undefined,
      peerReviewMinForAggregate: input.peerReviewMinForAggregate ?? undefined,
      requireReviewAcknowledgement: input.requireReviewAcknowledgement ?? undefined,
      emailProvider: input.emailProvider ?? undefined,
      emailFromName: input.emailFromName ?? undefined,
      emailFromAddr: input.emailFromAddr ?? undefined,
    },
  });

  const changed = describeChanges(before, org, [
    'name',
    'productName',
    'wordmarkText',
    'logoUrl',
    'brandPrimaryHex',
    'brandAccentHex',
    'timezone',
    'surveyMinResponses',
    'surveySuppressComplement',
    'peerReviewMinForAggregate',
    'requireReviewAcknowledgement',
    'emailProvider',
    'emailFromName',
    'emailFromAddr',
  ]);

  const brandingOnly = changed.every((c) =>
    ['logoUrl', 'wordmarkText', 'brandPrimaryHex', 'brandAccentHex', 'productName'].includes(c.field),
  );

  if (changed.length) {
    await recordAudit(actor, {
      action: brandingOnly ? AUDIT_ACTIONS.BRANDING_UPDATED : AUDIT_ACTIONS.ORG_SETTINGS_UPDATED,
      entityType: 'organization',
      entityId: org.id,
      summary: `Updated ${changed.map((c) => c.field).join(', ')}`,
      metadata: { changes: changed },
    });
  }

  return { org, changed };
}

function describeChanges<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T & string)[],
): { field: string; from: unknown; to: unknown }[] {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of fields) {
    if (before[field] !== after[field]) {
      out.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Optional AI configuration
// ---------------------------------------------------------------------------

export const AiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  aiProvider: z.enum(['none', 'mock', 'anthropic', 'openai', 'azure-openai']),
  aiModel: z.string().trim().max(120).nullable().optional(),
  aiMonthlyCallBudget: z.number().int().min(0).max(1_000_000),
});

/**
 * Turning AI on is gated on four separate things being true at once: a chosen
 * provider, a credential present on the server, a non-zero call budget, and
 * this explicit switch. A paid provider additionally requires
 * `AI_BILLING_APPROVED=true` in the environment, so nobody can start a metered
 * service from the web interface alone.
 */
export async function updateAiSettings(actor: Actor, input: z.infer<typeof AiSettingsSchema>) {
  if (!canManageOrgSettings(actor)) {
    throw new ForbiddenError('Only a system administrator can change AI settings.');
  }

  const paid = ['anthropic', 'openai', 'azure-openai'].includes(input.aiProvider);

  if (input.aiEnabled) {
    if (input.aiProvider === 'none') {
      throw new ValidationError('Choose a provider before enabling AI assistance.', [
        { path: 'aiProvider', message: 'Pick a provider, or leave AI disabled.' },
      ]);
    }
    if (input.aiMonthlyCallBudget <= 0 && paid) {
      throw new ValidationError(
        'Set a monthly call budget above zero before enabling a paid provider.',
        [{ path: 'aiMonthlyCallBudget', message: 'A paid provider needs a spending ceiling.' }],
      );
    }
    if (paid) {
      if (process.env.AI_BILLING_APPROVED !== 'true') {
        throw new ConflictError(
          'A paid AI provider cannot be enabled from this screen. It requires AI_BILLING_APPROVED=true in the ' +
            'server environment, which is a deliberate sign-off that someone has approved the spend. ' +
            'The mock provider works without it and needs no credentials.',
        );
      }
      if (!providerCredentialPresent(input.aiProvider)) {
        throw new ConflictError(
          `No credential is configured on the server for ${input.aiProvider}. Set it in the environment ` +
            '(see docs/DEPLOYMENT.md) and try again. Nothing is stored in the database.',
        );
      }
    }
  }

  const before = await prisma.organization.findUnique({ where: { id: actor.orgId } });
  if (!before) throw new NotFoundError();

  const org = await prisma.organization.update({
    where: { id: actor.orgId },
    data: {
      aiEnabled: input.aiEnabled,
      aiProvider: input.aiProvider,
      aiModel: input.aiModel ?? null,
      aiMonthlyCallBudget: input.aiMonthlyCallBudget,
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.AI_SETTINGS_UPDATED,
    entityType: 'organization',
    entityId: org.id,
    summary: input.aiEnabled
      ? `Enabled AI assistance via ${org.aiProvider}, budget ${org.aiMonthlyCallBudget} calls/month`
      : 'Disabled AI assistance',
    metadata: {
      from: { enabled: before.aiEnabled, provider: before.aiProvider },
      to: { enabled: org.aiEnabled, provider: org.aiProvider },
    },
  });

  return org;
}

function providerCredentialPresent(provider: string): boolean {
  switch (provider) {
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY);
    case 'azure-openai':
      return Boolean(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT);
    default:
      return true;
  }
}

/** Reports what the environment makes possible, never the credential itself. */
export function aiEnvironmentStatus(): {
  billingApproved: boolean;
  credentials: Record<string, boolean>;
} {
  return {
    billingApproved: process.env.AI_BILLING_APPROVED === 'true',
    credentials: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      'azure-openai': Boolean(
        process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT,
      ),
    },
  };
}

export async function aiUsageThisMonth(orgId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return prisma.aiSuggestion.count({
    where: { orgId, createdAt: { gte: start }, provider: { not: 'mock' } },
  });
}

// ---------------------------------------------------------------------------
// Accounts and roles
// ---------------------------------------------------------------------------

export async function listAccounts(actor: Actor, search?: string) {
  if (!canManageAccountsAndRoles(actor)) {
    throw new ForbiddenError('Only a system administrator can manage accounts.');
  }
  const term = search?.trim();
  return prisma.user.findMany({
    where: {
      orgId: actor.orgId,
      ...(term
        ? {
            OR: [
              { email: containsInsensitive(term) },
              { employee: { firstName: containsInsensitive(term) } },
              { employee: { lastName: containsInsensitive(term) } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: 'asc' }, { email: 'asc' }],
    select: {
      id: true,
      email: true,
      status: true,
      lastLoginAt: true,
      mustChangePassword: true,
      failedLoginCount: true,
      lockedUntil: true,
      isDemoAccount: true,
      passwordHash: true,
      externalIdpSubject: true,
      createdAt: true,
      roles: { select: { role: true, grantedAt: true } },
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          employmentStatus: true,
          jobTitle: { select: { name: true } },
          department: { select: { name: true } },
          _count: { select: { directReports: true } },
        },
      },
    },
  });
}

/** Active employees who cannot sign in, which is why they never appear in a cycle. */
export async function listEmployeesWithoutAccounts(actor: Actor) {
  if (!canManageAccountsAndRoles(actor) && !canAdministerProgram(actor)) {
    throw new ForbiddenError();
  }
  return prisma.employee.findMany({
    where: { orgId: actor.orgId, employmentStatus: { not: 'terminated' }, userId: null },
    orderBy: [{ lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      workEmail: true,
      jobTitle: { select: { name: true } },
      department: { select: { name: true } },
    },
  });
}

export async function setUserRole(
  actor: Actor,
  userId: string,
  role: Role,
  granted: boolean,
): Promise<void> {
  if (!canManageAccountsAndRoles(actor)) {
    throw new ForbiddenError('Only a system administrator can change roles.');
  }
  if (!ROLES.includes(role)) throw new ValidationError('Unknown role.');

  const user = await prisma.user.findFirst({
    where: { id: userId, orgId: actor.orgId },
    select: { id: true, email: true, roles: { select: { role: true } } },
  });
  if (!user) throw new NotFoundError();

  if (role === 'EMPLOYEE' && !granted) {
    throw new ConflictError(
      'Every account keeps the Employee role — it is what grants access to a person’s own records. ' +
        'To stop someone signing in, suspend the account instead.',
    );
  }

  // Removing your own last system-administrator grant would lock the
  // organization out of its own settings.
  if (role === 'SYS_ADMIN' && !granted) {
    const others = await prisma.userRole.count({
      where: { role: 'SYS_ADMIN', userId: { not: userId }, user: { orgId: actor.orgId, status: 'active' } },
    });
    if (others === 0) {
      throw new ConflictError(
        'This is the last active system administrator. Grant the role to someone else before removing it here, ' +
          'or the organization would be locked out of its own settings.',
      );
    }
  }

  const held = user.roles.some((r) => r.role === role);
  if (held === granted) return;

  if (granted) {
    await prisma.userRole.create({ data: { userId, role, grantedBy: actor.userId } });
  } else {
    await prisma.userRole.deleteMany({ where: { userId, role } });
  }

  await recordAudit(actor, {
    action: granted ? AUDIT_ACTIONS.ROLE_GRANTED : AUDIT_ACTIONS.ROLE_REVOKED,
    entityType: 'user',
    entityId: userId,
    summary: `${granted ? 'Granted' : 'Revoked'} ${role} ${granted ? 'to' : 'from'} ${user.email}`,
    metadata: { role },
  });
}

export async function setUserStatus(
  actor: Actor,
  userId: string,
  status: 'active' | 'suspended',
): Promise<void> {
  if (!canManageAccountsAndRoles(actor)) {
    throw new ForbiddenError('Only a system administrator can change account status.');
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId: actor.orgId },
    select: { id: true, email: true, status: true },
  });
  if (!user) throw new NotFoundError();

  if (userId === actor.userId && status === 'suspended') {
    throw new ConflictError('You cannot suspend your own account.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        status,
        ...(status === 'active' ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    // Suspending ends every live session immediately rather than at expiry.
    if (status === 'suspended') {
      await tx.session.deleteMany({ where: { userId } });
    }
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'user',
    entityId: userId,
    summary: `Account ${user.email} ${status === 'suspended' ? 'suspended' : 'reactivated'}`,
    metadata: { from: user.status, to: status },
  });
}

/**
 * Sets a temporary password and forces a change at next sign-in. The plain
 * value is returned once, to the administrator who asked, and never stored or
 * logged — it is theirs to hand over out of band.
 */
export async function resetUserPassword(
  actor: Actor,
  userId: string,
  temporaryPassword: string,
): Promise<void> {
  if (!canManageAccountsAndRoles(actor)) {
    throw new ForbiddenError('Only a system administrator can reset a password.');
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId: actor.orgId },
    select: { id: true, email: true },
  });
  if (!user) throw new NotFoundError();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await tx.session.deleteMany({ where: { userId } });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: 'user',
    entityId: userId,
    summary: `Password reset for ${user.email} by an administrator; change required at next sign-in`,
  });
}

/**
 * Unlinks an account from the Google identity it is bound to.
 *
 * Needed because a sign-in is refused when an address matches an account that
 * is already linked to a *different* Google subject — the recycled-address
 * case. Refusing is right, but it is a dead end unless somebody can clear the
 * link, and telling a person to "ask an administrator" is only honest if the
 * administrator has a control to use.
 *
 * Every session is ended at the same time. If the link was wrong, anything
 * signed in under it should stop.
 */
export async function unlinkSsoIdentity(actor: Actor, userId: string): Promise<void> {
  if (!canManageAccountsAndRoles(actor)) {
    throw new ForbiddenError('Only a system administrator can unlink a sign-in identity.');
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId: actor.orgId },
    select: { id: true, email: true, externalIdpSubject: true },
  });
  if (!user) throw new NotFoundError();
  if (!user.externalIdpSubject) {
    throw new ConflictError('That account is not linked to a Google identity.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { externalIdpSubject: null } });
    await tx.session.deleteMany({ where: { userId } });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.SSO_UNLINKED,
    entityType: 'user',
    entityId: userId,
    summary:
      `Unlinked ${user.email} from its Google account. The next successful Google sign-in for ` +
      `that address will claim the account and link afresh.`,
    metadata: { previousSubject: user.externalIdpSubject },
  });
}

/** Creates a sign-in account for an employee who has none. */
export async function createAccountForEmployee(
  actor: Actor,
  employeeId: string,
  temporaryPassword: string,
): Promise<{ userId: string; usesSso: boolean }> {
  if (!canManageAccountsAndRoles(actor)) {
    throw new ForbiddenError('Only a system administrator can create accounts.');
  }
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    select: { id: true, workEmail: true, firstName: true, lastName: true, userId: true },
  });
  if (!employee) throw new NotFoundError();
  if (employee.userId) throw new ConflictError('That employee already has an account.');

  const existing = await prisma.user.findFirst({
    where: { orgId: actor.orgId, email: employee.workEmail },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      'An account already uses that e-mail address. Link it from the employee record instead.',
    );
  }

  // A Workspace address signs in with Google, so it gets no password. Any
  // temporary password supplied for such an account is discarded rather than
  // stored — it could never be used, and an unused credential is only a
  // liability.
  const usesSso = accountUsesSso(employee.workEmail);
  const passwordHash = usesSso ? null : await hashPassword(temporaryPassword);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        orgId: actor.orgId,
        email: employee.workEmail,
        passwordHash,
        status: 'active',
        mustChangePassword: !usesSso,
        roles: { create: [{ role: 'EMPLOYEE', grantedBy: actor.userId }] },
      },
    });
    await tx.employee.update({ where: { id: employeeId }, data: { userId: created.id } });
    return created;
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.USER_INVITED,
    entityType: 'user',
    entityId: user.id,
    summary:
      `Created an account for ${employee.firstName} ${employee.lastName} (${employee.workEmail}), ` +
      `signing in with ${usesSso ? 'Google Workspace' : 'a password'}`,
  });

  return { userId: user.id, usesSso };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditFilters {
  action?: string;
  entityType?: string;
  actorEmployeeId?: string;
  from?: string;
  to?: string;
  take?: number;
  cursor?: string;
}

export async function listAuditEvents(actor: Actor, filters: AuditFilters = {}) {
  if (!canReadAuditLog(actor)) {
    throw new ForbiddenError('Only a system administrator can read the audit log.');
  }
  const take = Math.min(Math.max(filters.take ?? 100, 1), 500);

  const events = await prisma.auditEvent.findMany({
    where: {
      orgId: actor.orgId,
      ...(filters.action ? { action: startsWithInsensitive(filters.action) } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.actorEmployeeId ? { actorEmployeeId: filters.actorEmployeeId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      actorLabel: true,
      actorEmployeeId: true,
      ip: true,
      createdAt: true,
      metadataJson: true,
    },
  });

  const hasMore = events.length > take;
  return { events: events.slice(0, take), nextCursor: hasMore ? events[take - 1]!.id : null };
}

/** The distinct action prefixes present, for the filter control. */
export async function auditActionGroups(actor: Actor): Promise<{ value: string; count: number }[]> {
  if (!canReadAuditLog(actor)) throw new ForbiddenError();
  const rows = await prisma.auditEvent.groupBy({
    by: ['action'],
    where: { orgId: actor.orgId },
    _count: { action: true },
  });
  const groups = new Map<string, number>();
  for (const row of rows) {
    const prefix = row.action.split('.')[0] as string;
    groups.set(prefix, (groups.get(prefix) ?? 0) + row._count.action);
  }
  return [...groups.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function endOfDay(value: string): Date {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ---------------------------------------------------------------------------
// E-mail outbox
// ---------------------------------------------------------------------------

export async function listOutbox(
  actor: Actor,
  status?: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED',
) {
  if (!canAdministerApp(actor)) {
    throw new ForbiddenError('Only a system administrator can read the outbox.');
  }
  const [messages, counts, org] = await Promise.all([
    prisma.emailMessage.findMany({
      where: { orgId: actor.orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.emailMessage.groupBy({
      by: ['status'],
      where: { orgId: actor.orgId },
      _count: { status: true },
    }),
    prisma.organization.findUnique({
      where: { id: actor.orgId },
      select: { emailProvider: true, emailFromName: true, emailFromAddr: true },
    }),
  ]);

  return {
    messages,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count.status])) as Record<
      string,
      number
    >,
    provider: org?.emailProvider ?? 'outbox',
    from: org ? `${org.emailFromName} <${org.emailFromAddr}>` : '',
    transportConfigured: process.env.EMAIL_TRANSPORT_CONFIGURED === 'true',
  };
}

/**
 * Clears queued messages without sending them. Useful after a bulk reminder in
 * a test organization. Deliberately does *not* mark them sent — a message that
 * never left should not claim it did.
 */
export async function discardQueuedEmail(actor: Actor): Promise<{ discarded: number }> {
  if (!canAdministerApp(actor)) throw new ForbiddenError();
  const result = await prisma.emailMessage.updateMany({
    where: { orgId: actor.orgId, status: 'QUEUED' },
    data: { status: 'SUPPRESSED', error: 'Discarded by an administrator; never sent.' },
  });
  await recordAudit(actor, {
    action: 'email.discarded',
    entityType: 'organization',
    entityId: actor.orgId,
    summary: `Discarded ${result.count} queued message(s) without sending`,
  });
  return { discarded: result.count };
}

// ---------------------------------------------------------------------------
// Demonstration data
// ---------------------------------------------------------------------------

export async function demoDataSummary(actor: Actor) {
  if (!canAdministerApp(actor)) throw new ForbiddenError();
  const where = { orgId: actor.orgId, isDemoData: true };
  const [
    employees,
    cycles,
    goals,
    feedback,
    feedbackRequests,
    meetingSeries,
    meetings,
    actionItems,
    surveys,
    plans,
    accounts,
    realEmployees,
  ] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.reviewCycle.count({ where }),
    prisma.goal.count({ where }),
    prisma.feedback.count({ where }),
    prisma.feedbackRequest.count({ where }),
    prisma.meetingSeries.count({ where }),
    prisma.meeting.count({ where }),
    prisma.actionItem.count({ where }),
    prisma.survey.count({ where }),
    prisma.developmentPlan.count({ where }),
    prisma.user.count({ where: { orgId: actor.orgId, isDemoAccount: true } }),
    prisma.employee.count({ where: { orgId: actor.orgId, isDemoData: false } }),
  ]);

  const total =
    employees +
    cycles +
    goals +
    feedback +
    feedbackRequests +
    meetingSeries +
    meetings +
    actionItems +
    surveys +
    plans +
    accounts;

  return {
    counts: {
      employees,
      accounts,
      cycles,
      goals,
      feedback,
      feedbackRequests,
      meetingSeries,
      meetings,
      actionItems,
      surveys,
      plans,
    },
    total,
    realEmployees,
    /** The catalogue is kept: it is a sensible starting configuration. */
    keeps: ['Departments and job titles', 'Competencies and libraries', 'Rating scales', 'Recognition values', 'Review templates'],
  };
}

/**
 * Removes the synthetic organization. Cascades handle the children, so this
 * deletes the parents in dependency order and lets the database do the rest.
 *
 * The configuration catalogue is kept on purpose — departments, job titles,
 * competencies, scales and templates are a reasonable starting point for a real
 * rollout, and a company that has already edited them would not thank us for
 * wiping them.
 */
export async function removeDemoData(
  actor: Actor,
  confirmation: string,
): Promise<{ removed: Record<string, number> }> {
  if (!canAdministerApp(actor)) {
    throw new ForbiddenError('Only a system administrator can remove the demonstration data.');
  }
  if (confirmation !== 'REMOVE DEMO DATA') {
    throw new ValidationError('Type REMOVE DEMO DATA exactly to confirm.');
  }

  const actorIsDemo = actor.employeeId
    ? await prisma.employee.findFirst({
        where: { id: actor.employeeId, isDemoData: true },
        select: { id: true },
      })
    : null;
  if (actorIsDemo) {
    throw new ConflictError(
      'You are signed in as a demonstration account, so removing the demonstration data would delete your own ' +
        'access mid-operation. Create a real administrator account first, sign in as that, and then remove it.',
    );
  }

  const removed: Record<string, number> = {};
  const where = { orgId: actor.orgId, isDemoData: true };

  await prisma.$transaction(async (tx) => {
    removed.surveys = (await tx.survey.deleteMany({ where })).count;
    removed.cycles = (await tx.reviewCycle.deleteMany({ where })).count;
    removed.plans = (await tx.developmentPlan.deleteMany({ where })).count;
    removed.actionItems = (await tx.actionItem.deleteMany({ where })).count;
    removed.meetings = (await tx.meeting.deleteMany({ where })).count;
    removed.meetingSeries = (await tx.meetingSeries.deleteMany({ where })).count;
    removed.feedback = (await tx.feedback.deleteMany({ where })).count;
    removed.feedbackRequests = (await tx.feedbackRequest.deleteMany({ where })).count;
    removed.goals = (await tx.goal.deleteMany({ where })).count;
    removed.employees = (await tx.employee.deleteMany({ where })).count;
    removed.accounts = (
      await tx.user.deleteMany({ where: { orgId: actor.orgId, isDemoAccount: true } })
    ).count;
  });

  await recordAudit(actor, {
    action: 'org.demo_data.removed',
    entityType: 'organization',
    entityId: actor.orgId,
    summary: `Removed the demonstration data: ${Object.entries(removed)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')}`,
    metadata: { removed },
  });

  return { removed };
}

// ---------------------------------------------------------------------------
// Exceptions worklist
// ---------------------------------------------------------------------------

/**
 * The rows behind the exception counts on the Administration home. Each one is
 * something a person has to decide about — the application will not guess.
 */
export async function listExceptions(actor: Actor) {
  if (!canAdministerProgram(actor)) {
    throw new ForbiddenError('Only an HR administrator can work the exceptions list.');
  }
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 21 * 86_400_000);

  const [noManager, noAccount, deactivatedReviewer, approvedNotReleased, staleAck, orphanedGoals] =
    await Promise.all([
      prisma.employee.findMany({
        where: {
          orgId: actor.orgId,
          employmentStatus: 'active',
          managerId: null,
          reviewEligible: true,
        },
        orderBy: { lastName: 'asc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          jobTitle: { select: { name: true } },
          department: { select: { name: true } },
        },
      }),

      prisma.employee.findMany({
        where: { orgId: actor.orgId, employmentStatus: 'active', userId: null },
        orderBy: { lastName: 'asc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          workEmail: true,
          jobTitle: { select: { name: true } },
        },
      }),

      prisma.reviewAssignment.findMany({
        where: {
          status: { in: ['NOT_STARTED', 'DRAFT', 'REOPENED'] },
          participant: { cycle: { orgId: actor.orgId, status: 'ACTIVE' } },
          reviewer: { employmentStatus: 'terminated' },
        },
        select: {
          id: true,
          kind: true,
          dueAt: true,
          reviewer: { select: { id: true, firstName: true, lastName: true } },
          participant: {
            select: {
              id: true,
              employee: { select: { firstName: true, lastName: true } },
              cycle: { select: { id: true, name: true } },
            },
          },
        },
      }),

      prisma.cycleParticipant.findMany({
        where: { status: 'APPROVED', cycle: { orgId: actor.orgId, status: 'ACTIVE' } },
        select: {
          id: true,
          updatedAt: true,
          employee: { select: { firstName: true, lastName: true } },
          cycle: { select: { id: true, name: true } },
        },
      }),

      prisma.cycleParticipant.findMany({
        where: {
          status: 'RELEASED',
          releasedAt: { lt: staleCutoff },
          cycle: { orgId: actor.orgId },
        },
        select: {
          id: true,
          releasedAt: true,
          employee: { select: { firstName: true, lastName: true } },
          cycle: { select: { id: true, name: true } },
        },
      }),

      // Goals owned by someone who has since been deactivated, which otherwise
      // sit open forever and distort team progress.
      prisma.goal.findMany({
        where: {
          orgId: actor.orgId,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
          owner: { employmentStatus: 'terminated' },
        },
        select: {
          id: true,
          title: true,
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

  return {
    noManager,
    noAccount,
    deactivatedReviewer,
    approvedNotReleased,
    staleAck,
    orphanedGoals,
    total:
      noManager.length +
      noAccount.length +
      deactivatedReviewer.length +
      approvedNotReleased.length +
      staleAck.length +
      orphanedGoals.length,
  };
}
