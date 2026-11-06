import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { loadReportingGraph, collectManagerChain } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  canCommentOnGoal,
  canCreateCompanyGoal,
  canEditGoal,
  canUpdateGoalProgress,
  canViewGoal,
  type GoalRef,
} from '../authz/policy';
import { computeGoalProgress, goalRisk, type GoalProgressResult } from '../scoring/goal-progress';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import { GOAL_SCOPES, GOAL_STATUSES, GOAL_HEALTHS, GOAL_VISIBILITIES, MEASUREMENT_TYPES } from '@/lib/enums';
import { containsInsensitive, containsInsensitiveNullable } from '../search';

/**
 * Goals.
 *
 * The visibility rules are the interesting part: a goal is not automatically
 * public, and a manager does not automatically see a private one. Every list
 * query builds the viewer's permitted set rather than filtering in the view,
 * so an export cannot leak what a page would have hidden.
 */

export interface GoalWithProgress {
  id: string;
  title: string;
  description: string | null;
  outcome: string | null;
  category: string | null;
  scope: string;
  status: string;
  health: string;
  visibility: string;
  measurementType: string;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  higherIsBetter: boolean;
  weight: number;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  parentGoalId: string | null;
  parentGoalTitle: string | null;
  childCount: number;
  milestones: { id: string; title: string; dueDate: Date | null; completedAt: Date | null; weight: number }[];
  collaboratorIds: string[];
  progress: GoalProgressResult;
  risk: string;
  canEdit: boolean;
}

/**
 * Loads management chains for the whole organization once, so a list of goals
 * can be filtered without a query per goal.
 */
async function chainLookup(orgId: string) {
  const { managerOf } = await loadReportingGraph(orgId);
  const cache = new Map<string, string[]>();
  return (employeeId: string): string[] => {
    const hit = cache.get(employeeId);
    if (hit) return hit;
    const chain = collectManagerChain(employeeId, managerOf);
    cache.set(employeeId, chain);
    return chain;
  };
}

type GoalRow = Awaited<ReturnType<typeof loadGoalRows>>[number];

async function loadGoalRows(where: object, take = 400) {
  return prisma.goal.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take,
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      department: { select: { id: true, name: true } },
      parentGoal: { select: { id: true, title: true } },
      milestones: { orderBy: { sortOrder: 'asc' } },
      collaborators: { select: { employeeId: true } },
      _count: { select: { childGoals: true } },
    },
  });
}

function shape(
  row: GoalRow,
  actor: Actor,
  ownerChain: string[],
): GoalWithProgress {
  const progress = computeGoalProgress({
    measurementType: row.measurementType,
    startValue: row.startValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    higherIsBetter: row.higherIsBetter,
    reportedProgressPct: row.reportedProgressPct,
    status: row.status,
    milestones: row.milestones,
  });
  const ref: GoalRef = {
    id: row.id,
    scope: row.scope,
    ownerEmployeeId: row.ownerEmployeeId,
    departmentId: row.departmentId,
    visibility: row.visibility,
    collaboratorIds: row.collaborators.map((c) => c.employeeId),
    ownerManagerChainIds: ownerChain,
  };
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    outcome: row.outcome,
    category: row.category,
    scope: row.scope,
    status: row.status,
    health: row.health,
    visibility: row.visibility,
    measurementType: row.measurementType,
    startValue: row.startValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    unit: row.unit,
    higherIsBetter: row.higherIsBetter,
    weight: row.weight,
    startDate: row.startDate,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    ownerEmployeeId: row.ownerEmployeeId,
    ownerName: row.owner ? `${row.owner.preferredName || row.owner.firstName} ${row.owner.lastName}` : null,
    ownerFirstName: row.owner?.firstName ?? null,
    ownerLastName: row.owner?.lastName ?? null,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    parentGoalId: row.parentGoalId,
    parentGoalTitle: row.parentGoal?.title ?? null,
    childCount: row._count.childGoals,
    milestones: row.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      dueDate: m.dueDate,
      completedAt: m.completedAt,
      weight: m.weight,
    })),
    collaboratorIds: ref.collaboratorIds,
    progress,
    risk: goalRisk({ status: row.status, health: row.health, dueDate: row.dueDate }),
    canEdit: canEditGoal(actor, ref),
  };
}

export interface GoalFilters {
  scope?: 'ALL' | 'MINE' | 'TEAM' | 'COMPANY' | 'INDIVIDUAL';
  status?: string;
  health?: string;
  ownerEmployeeId?: string;
  departmentId?: string;
  query?: string;
  needsAttention?: boolean;
}

export async function listGoals(actor: Actor, filters: GoalFilters = {}): Promise<GoalWithProgress[]> {
  const where: Record<string, unknown> = { orgId: actor.orgId };

  if (filters.scope === 'MINE' && actor.employeeId) where.ownerEmployeeId = actor.employeeId;
  if (filters.scope === 'TEAM' && actor.employeeId) {
    where.OR = [
      { ownerEmployeeId: { in: [actor.employeeId, ...actor.descendantIds] } },
      { scope: 'TEAM' },
    ];
  }
  if (filters.scope === 'COMPANY') where.scope = 'COMPANY';
  if (filters.scope === 'INDIVIDUAL') where.scope = 'INDIVIDUAL';
  if (filters.ownerEmployeeId) where.ownerEmployeeId = filters.ownerEmployeeId;
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.status) where.status = filters.status;
  if (filters.health) where.health = filters.health;
  if (filters.query) {
    where.OR = [
      { title: containsInsensitive(filters.query) },
      { description: containsInsensitiveNullable(filters.query) },
    ];
  }

  const rows = await loadGoalRows(where);
  const chainFor = await chainLookup(actor.orgId);

  const visible = rows
    .map((row) => ({ row, chain: row.ownerEmployeeId ? chainFor(row.ownerEmployeeId) : [] }))
    .filter(({ row, chain }) =>
      canViewGoal(actor, {
        id: row.id,
        scope: row.scope,
        ownerEmployeeId: row.ownerEmployeeId,
        departmentId: row.departmentId,
        visibility: row.visibility,
        collaboratorIds: row.collaborators.map((c) => c.employeeId),
        ownerManagerChainIds: chain,
      }),
    )
    .map(({ row, chain }) => shape(row, actor, chain));

  if (filters.needsAttention) {
    return visible.filter((g) => g.risk !== 'NONE' && g.risk !== 'DUE_SOON');
  }
  return visible;
}

export async function getGoal(actor: Actor, goalId: string) {
  const row = await prisma.goal.findFirst({
    where: { id: goalId, orgId: actor.orgId },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      department: { select: { id: true, name: true } },
      parentGoal: { select: { id: true, title: true, scope: true } },
      childGoals: {
        select: {
          id: true,
          title: true,
          status: true,
          health: true,
          reportedProgressPct: true,
          owner: { select: { firstName: true, lastName: true, preferredName: true } },
        },
      },
      milestones: { orderBy: { sortOrder: 'asc' } },
      collaborators: {
        include: { employee: { select: { id: true, firstName: true, lastName: true, preferredName: true } } },
      },
      updates: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { author: { select: { firstName: true, lastName: true, preferredName: true } } },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, firstName: true, lastName: true, preferredName: true } } },
      },
      _count: { select: { childGoals: true } },
    },
  });
  if (!row) throw new NotFoundError();

  const chainFor = await chainLookup(actor.orgId);
  const chain = row.ownerEmployeeId ? chainFor(row.ownerEmployeeId) : [];
  const ref: GoalRef = {
    id: row.id,
    scope: row.scope,
    ownerEmployeeId: row.ownerEmployeeId,
    departmentId: row.departmentId,
    visibility: row.visibility,
    collaboratorIds: row.collaborators.map((c) => c.employeeId),
    ownerManagerChainIds: chain,
  };
  if (!canViewGoal(actor, ref)) throw new NotFoundError();

  return {
    goal: shape(row as unknown as GoalRow, actor, chain),
    raw: row,
    canEdit: canEditGoal(actor, ref),
    canUpdateProgress: canUpdateGoalProgress(actor, ref),
    canComment: canCommentOnGoal(actor, ref),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface GoalInput {
  title: string;
  description?: string | null;
  outcome?: string | null;
  category?: string | null;
  scope: string;
  ownerEmployeeId?: string | null;
  departmentId?: string | null;
  parentGoalId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  status?: string;
  health?: string;
  visibility: string;
  measurementType: string;
  startValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string | null;
  higherIsBetter?: boolean;
  reportedProgressPct?: number | null;
  weight?: number;
  milestones?: { title: string; dueDate?: string | null; weight?: number }[];
  collaboratorIds?: string[];
}

function validateGoalInput(input: GoalInput): void {
  if (!input.title || input.title.trim().length < 3) {
    throw new ValidationError('Give the goal a title of at least 3 characters.');
  }
  if (!GOAL_SCOPES.includes(input.scope as never)) throw new ValidationError('Unknown goal scope.');
  if (!GOAL_VISIBILITIES.includes(input.visibility as never)) {
    throw new ValidationError('Unknown visibility setting.');
  }
  if (!MEASUREMENT_TYPES.includes(input.measurementType as never)) {
    throw new ValidationError('Unknown way of measuring progress.');
  }
  if (input.status && !GOAL_STATUSES.includes(input.status as never)) {
    throw new ValidationError('Unknown status.');
  }
  if (input.health && !GOAL_HEALTHS.includes(input.health as never)) {
    throw new ValidationError('Unknown health setting.');
  }
  if (input.measurementType === 'NUMERIC') {
    if (input.targetValue === null || input.targetValue === undefined) {
      throw new ValidationError('A numeric goal needs a target value.');
    }
    if (input.startValue === null || input.startValue === undefined) {
      throw new ValidationError(
        'A numeric goal needs a starting value, so progress can be measured from somewhere.',
      );
    }
    if (input.startValue === input.targetValue) {
      throw new ValidationError(
        'The start and target values are the same, so progress could never be expressed as a percentage.',
      );
    }
  }
  if (input.startDate && input.dueDate && new Date(input.startDate) > new Date(input.dueDate)) {
    throw new ValidationError('The start date is after the due date.');
  }
}

export async function createGoal(actor: Actor, input: GoalInput) {
  validateGoalInput(input);
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can own a goal.');

  if (input.scope === 'COMPANY' && !canCreateCompanyGoal(actor)) {
    throw new ForbiddenError(
      'Company goals can be created by HR administrators and leadership. Set a team or individual goal instead.',
    );
  }

  const ownerId = input.ownerEmployeeId ?? actor.employeeId;
  if (ownerId !== actor.employeeId) {
    const allowed = actor.isHrAdmin || actor.descendantIds.includes(ownerId);
    if (!allowed) {
      throw new ForbiddenError('You can only set goals for yourself or for someone in your reporting line.');
    }
  }

  const goal = await prisma.goal.create({
    data: {
      orgId: actor.orgId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      outcome: input.outcome?.trim() || null,
      category: input.category?.trim() || null,
      scope: input.scope,
      ownerEmployeeId: input.scope === 'COMPANY' ? (input.ownerEmployeeId ?? actor.employeeId) : ownerId,
      departmentId: input.departmentId || null,
      parentGoalId: input.parentGoalId || null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      status: input.status ?? 'NOT_STARTED',
      health: input.health ?? 'ON_TRACK',
      visibility: input.visibility,
      measurementType: input.measurementType,
      startValue: input.startValue ?? null,
      targetValue: input.targetValue ?? null,
      currentValue: input.currentValue ?? input.startValue ?? null,
      unit: input.unit?.trim() || null,
      higherIsBetter: input.higherIsBetter !== false,
      reportedProgressPct: input.reportedProgressPct ?? null,
      weight: input.weight ?? 1,
      createdById: actor.employeeId,
      milestones: input.milestones?.length
        ? {
            create: input.milestones
              .filter((m) => m.title.trim())
              .map((m, i) => ({
                title: m.title.trim(),
                dueDate: m.dueDate ? new Date(m.dueDate) : null,
                weight: m.weight ?? 1,
                sortOrder: i,
              })),
          }
        : undefined,
      collaborators: input.collaboratorIds?.length
        ? { create: input.collaboratorIds.map((employeeId) => ({ employeeId })) }
        : undefined,
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.GOAL_CREATED,
    entityType: 'goal',
    entityId: goal.id,
    summary: `Created the ${goal.scope.toLowerCase()} goal "${goal.title}".`,
    metadata: { visibility: goal.visibility, ownerEmployeeId: goal.ownerEmployeeId },
  });

  // Tell the owner when someone else set the goal for them.
  if (goal.ownerEmployeeId && goal.ownerEmployeeId !== actor.employeeId) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: goal.ownerEmployeeId,
      type: 'goal.assigned',
      title: `${actor.displayName} set you a goal`,
      body: goal.title,
      linkUrl: `/goals/${goal.id}`,
      dedupeKey: `goal.assigned:${goal.id}`,
    });
  }

  return goal;
}

async function loadGoalForWrite(actor: Actor, goalId: string) {
  const row = await prisma.goal.findFirst({
    where: { id: goalId, orgId: actor.orgId },
    include: { collaborators: { select: { employeeId: true } }, milestones: true },
  });
  if (!row) throw new NotFoundError();
  const chainFor = await chainLookup(actor.orgId);
  const chain = row.ownerEmployeeId ? chainFor(row.ownerEmployeeId) : [];
  const ref: GoalRef = {
    id: row.id,
    scope: row.scope,
    ownerEmployeeId: row.ownerEmployeeId,
    departmentId: row.departmentId,
    visibility: row.visibility,
    collaboratorIds: row.collaborators.map((c) => c.employeeId),
    ownerManagerChainIds: chain,
  };
  if (!canViewGoal(actor, ref)) throw new NotFoundError();
  return { row, ref };
}

export async function updateGoal(actor: Actor, goalId: string, input: Partial<GoalInput>) {
  const { row, ref } = await loadGoalForWrite(actor, goalId);
  if (!canEditGoal(actor, ref)) {
    throw new ForbiddenError('You can edit a goal you own, collaborate on, or that one of your reports owns.');
  }
  if (row.status === 'COMPLETED' && input.status === undefined) {
    // Editing a completed goal is allowed, but it is worth being explicit.
  }

  const merged = { ...row, ...input } as unknown as GoalInput;
  validateGoalInput({ ...merged, title: input.title ?? row.title });

  const visibilityChanged = input.visibility !== undefined && input.visibility !== row.visibility;

  const updated = await prisma.goal.update({
    where: { id: goalId },
    data: {
      title: input.title?.trim() ?? undefined,
      description: input.description !== undefined ? input.description?.trim() || null : undefined,
      outcome: input.outcome !== undefined ? input.outcome?.trim() || null : undefined,
      category: input.category !== undefined ? input.category?.trim() || null : undefined,
      startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
      dueDate: input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined,
      status: input.status ?? undefined,
      health: input.health ?? undefined,
      visibility: input.visibility ?? undefined,
      measurementType: input.measurementType ?? undefined,
      startValue: input.startValue !== undefined ? input.startValue : undefined,
      targetValue: input.targetValue !== undefined ? input.targetValue : undefined,
      currentValue: input.currentValue !== undefined ? input.currentValue : undefined,
      unit: input.unit !== undefined ? input.unit?.trim() || null : undefined,
      higherIsBetter: input.higherIsBetter ?? undefined,
      weight: input.weight ?? undefined,
      parentGoalId: input.parentGoalId !== undefined ? input.parentGoalId || null : undefined,
      departmentId: input.departmentId !== undefined ? input.departmentId || null : undefined,
      completedAt:
        input.status === 'COMPLETED'
          ? (row.completedAt ?? new Date())
          : input.status && input.status !== 'COMPLETED'
            ? null
            : undefined,
    },
  });

  await recordAudit(actor, {
    action: visibilityChanged ? AUDIT_ACTIONS.GOAL_VISIBILITY_CHANGED : AUDIT_ACTIONS.GOAL_UPDATED,
    entityType: 'goal',
    entityId: goalId,
    summary: visibilityChanged
      ? `Changed who can see "${updated.title}" from ${row.visibility} to ${updated.visibility}.`
      : `Updated the goal "${updated.title}".`,
  });

  return updated;
}

export interface ProgressUpdateInput {
  body?: string | null;
  currentValue?: number | null;
  reportedProgressPct?: number | null;
  status?: string;
  health?: string;
  completedMilestoneIds?: string[];
  reopenedMilestoneIds?: string[];
}

/**
 * Records a progress update.
 *
 * Every update is appended to the history rather than overwriting the last
 * one, and the computed figure at the time is stored alongside the reported
 * one, so a later change to the measurement rules cannot rewrite what was
 * reported on a given day.
 */
export async function addGoalUpdate(actor: Actor, goalId: string, input: ProgressUpdateInput) {
  const { row, ref } = await loadGoalForWrite(actor, goalId);
  if (!canUpdateGoalProgress(actor, ref)) {
    throw new ForbiddenError('You do not have permission to update progress on this goal.');
  }
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can post a progress update.');

  const hasSomething =
    (input.body && input.body.trim()) ||
    input.currentValue !== undefined ||
    input.reportedProgressPct !== undefined ||
    input.status ||
    input.health ||
    input.completedMilestoneIds?.length ||
    input.reopenedMilestoneIds?.length;
  if (!hasSomething) {
    throw new ValidationError('There is nothing to record. Add a note, a value, or change the status.');
  }

  if (input.reportedProgressPct !== undefined && input.reportedProgressPct !== null) {
    if (input.reportedProgressPct < 0 || input.reportedProgressPct > 100) {
      throw new ValidationError('Reported progress must be between 0 and 100.');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    if (input.completedMilestoneIds?.length) {
      await tx.goalMilestone.updateMany({
        where: { goalId, id: { in: input.completedMilestoneIds }, completedAt: null },
        data: { completedAt: new Date() },
      });
    }
    if (input.reopenedMilestoneIds?.length) {
      await tx.goalMilestone.updateMany({
        where: { goalId, id: { in: input.reopenedMilestoneIds } },
        data: { completedAt: null },
      });
    }

    const goalData: Record<string, unknown> = {};
    if (input.currentValue !== undefined) goalData.currentValue = input.currentValue;
    if (input.reportedProgressPct !== undefined) goalData.reportedProgressPct = input.reportedProgressPct;
    if (input.status) {
      goalData.status = input.status;
      goalData.completedAt = input.status === 'COMPLETED' ? (row.completedAt ?? new Date()) : null;
    }
    if (input.health) goalData.health = input.health;
    if (Object.keys(goalData).length > 0) {
      await tx.goal.update({ where: { id: goalId }, data: goalData });
    }

    const fresh = await tx.goal.findUniqueOrThrow({
      where: { id: goalId },
      include: { milestones: { select: { completedAt: true, weight: true } } },
    });
    const progress = computeGoalProgress({
      measurementType: fresh.measurementType,
      startValue: fresh.startValue,
      targetValue: fresh.targetValue,
      currentValue: fresh.currentValue,
      higherIsBetter: fresh.higherIsBetter,
      reportedProgressPct: fresh.reportedProgressPct,
      status: fresh.status,
      milestones: fresh.milestones,
    });

    const update = await tx.goalUpdate.create({
      data: {
        goalId,
        authorEmployeeId: actor.employeeId as string,
        body: input.body?.trim() || null,
        valueAtUpdate: fresh.currentValue,
        reportedProgressPct: fresh.reportedProgressPct,
        computedProgressPct: progress.computedPct,
        statusAtUpdate: fresh.status,
        healthAtUpdate: fresh.health,
      },
    });

    return { update, goal: fresh, progress };
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.GOAL_UPDATED,
    entityType: 'goal',
    entityId: goalId,
    summary: `Recorded progress on "${row.title}".`,
    metadata: {
      reported: result.goal.reportedProgressPct,
      computed: result.progress.computedPct,
      status: result.goal.status,
      health: result.goal.health,
    },
  });

  // A goal going off track is something the owner's manager should hear about.
  const concerning = ['OFF_TRACK', 'BLOCKED'].includes(result.goal.health);
  if (concerning && row.ownerEmployeeId) {
    const chainFor = await chainLookup(actor.orgId);
    const manager = chainFor(row.ownerEmployeeId)[0];
    if (manager && manager !== actor.employeeId) {
      await notify({
        orgId: actor.orgId,
        recipientEmployeeId: manager,
        type: 'goal.at_risk',
        title: `A goal has been flagged ${result.goal.health === 'BLOCKED' ? 'blocked' : 'off track'}`,
        body: row.title,
        linkUrl: `/goals/${goalId}`,
        severity: 'warning',
        dedupeKey: `goal.risk:${goalId}:${result.goal.health}:${new Date().toDateString()}`,
      });
    }
  }

  return result;
}

export async function addGoalComment(actor: Actor, goalId: string, body: string) {
  const { row, ref } = await loadGoalForWrite(actor, goalId);
  if (!canCommentOnGoal(actor, ref)) throw new ForbiddenError('You cannot comment on this goal.');
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can comment.');
  if (!body.trim()) throw new ValidationError('Write something before posting.');

  const comment = await prisma.goalComment.create({
    data: { goalId, authorEmployeeId: actor.employeeId, body: body.trim() },
  });

  if (row.ownerEmployeeId && row.ownerEmployeeId !== actor.employeeId) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: row.ownerEmployeeId,
      type: 'goal.comment',
      title: `${actor.displayName} commented on "${row.title}"`,
      linkUrl: `/goals/${goalId}`,
      dedupeKey: `goal.comment:${comment.id}`,
    });
  }
  return comment;
}

export async function closeGoal(
  actor: Actor,
  goalId: string,
  status: 'COMPLETED' | 'CANCELLED',
  note: string,
) {
  const { row, ref } = await loadGoalForWrite(actor, goalId);
  if (!canEditGoal(actor, ref)) throw new ForbiddenError('You cannot close this goal.');
  if (row.status === status) throw new ConflictError('This goal is already in that state.');

  await prisma.goal.update({
    where: { id: goalId },
    data: {
      status,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      closedNote: note.trim() || null,
      reportedProgressPct: status === 'COMPLETED' ? 100 : row.reportedProgressPct,
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.GOAL_CLOSED,
    entityType: 'goal',
    entityId: goalId,
    summary: `${status === 'COMPLETED' ? 'Completed' : 'Cancelled'} the goal "${row.title}".`,
    metadata: { note: note.trim() },
  });
}

/** Goals that can be chosen as a parent, respecting visibility. */
export async function listAlignmentTargets(actor: Actor) {
  const rows = await listGoals(actor, {});
  return rows
    .filter((g) => g.scope !== 'INDIVIDUAL' && g.status !== 'CANCELLED')
    .map((g) => ({ id: g.id, title: g.title, scope: g.scope, ownerName: g.ownerName }));
}
