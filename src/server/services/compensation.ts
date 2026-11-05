import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import {
  canAdministerCompensation,
  canAllocateCompensation,
  canApproveCompensation,
  canManageSalaryBands,
  canViewCompensationParticipant,
  canViewOwnCompensation,
} from '../authz/policy';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { recordAudit } from '../audit';
import { notify } from '../notify';
import {
  budgetState,
  formatMoney,
  increaseFromBasisPoints,
  newBaseFrom,
  recommendIncrease,
  totalAllocated,
  type BasisPoints,
} from '@/lib/money';

/**
 * Compensation cycles.
 *
 * The shape is: an administrator opens a cycle over a set of people, each
 * manager gets a budget pool, managers allocate within it informed by
 * performance, submit, an administrator approves, and only then is anything
 * written to pay history.
 *
 * Four things this module will not do, each for a reason:
 *
 *  1. **Nothing is applied automatically.** Approved is not applied. Writing
 *     to pay history is a separate, explicit act, because it is the step that
 *     changes what somebody is actually paid.
 *  2. **A recommendation is never a decision.** The matrix populates a field;
 *     a person sets the number. An override is stored alongside what was
 *     recommended so it is visible as an override.
 *  3. **Pay history is append-only.** A correction is a new row, never an
 *     edit, so "what were we paying them in March" always has an answer.
 *  4. **Going over budget is reported, not blocked, until submission.** A
 *     manager part-way through is legitimately over; refusing the keystroke
 *     would push the work into a spreadsheet.
 */

function requireCompAdmin(actor: Actor): void {
  if (!canAdministerCompensation(actor)) {
    throw new ForbiddenError(
      'Compensation is restricted to the compensation administrator role, which is deliberately separate from HR.',
    );
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Cycles the actor can see: all for an administrator, their own allocations otherwise. */
export async function listCompensationCycles(actor: Actor) {
  const isAdmin = canAdministerCompensation(actor);
  if (!isAdmin && !actor.employeeId) return [];

  const cycles = await prisma.compensationCycle.findMany({
    where: {
      orgId: actor.orgId,
      ...(isAdmin
        ? {}
        : {
            status: { in: ['PLANNING', 'IN_APPROVAL', 'APPROVED', 'APPLIED'] },
            participants: { some: { managerIdSnapshot: actor.employeeId } },
          }),
    },
    orderBy: [{ effectiveDate: 'desc' }],
    include: {
      reviewCycle: { select: { id: true, name: true } },
      _count: { select: { participants: true } },
    },
  });

  // Progress per cycle, from stored rows rather than a cached counter.
  const withProgress = await Promise.all(
    cycles.map(async (c) => {
      const where = isAdmin
        ? { cycleId: c.id }
        : { cycleId: c.id, managerIdSnapshot: actor.employeeId };
      const [mine, decided, submitted] = await Promise.all([
        prisma.compensationParticipant.count({ where }),
        prisma.compensationParticipant.count({
          where: { ...where, status: { in: ['DECIDED', 'SUBMITTED', 'APPROVED', 'APPLIED'] } },
        }),
        prisma.compensationParticipant.count({
          where: { ...where, status: { in: ['SUBMITTED', 'APPROVED', 'APPLIED'] } },
        }),
      ]);
      return { ...c, mine, decided, submitted };
    }),
  );
  return withProgress;
}

export interface CompRow {
  id: string;
  employeeId: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  managerName: string | null;
  managerIdSnapshot: string | null;
  currency: string;
  currentBaseMinor: number;
  bandMinMinor: number | null;
  bandMidMinor: number | null;
  bandMaxMinor: number | null;
  performanceScore: number | null;
  performanceBand: string | null;
  recommendedBp: number | null;
  recommendationNote: string;
  decidedBp: number | null;
  decidedAmountMinor: number | null;
  newBaseMinor: number | null;
  rationale: string | null;
  status: string;
  canEdit: boolean;
  isOverride: boolean;
}

/**
 * One cycle, with the rows the actor may see.
 *
 * An administrator sees everybody; a manager sees exactly their own
 * allocations. The filter is in the query, not applied to a full result, so a
 * manager's request never loads a colleague's salary into memory at all.
 */
export async function getCompensationCycle(actor: Actor, cycleId: string) {
  const isAdmin = canAdministerCompensation(actor);
  if (!isAdmin && !actor.employeeId) throw new NotFoundError();

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: { reviewCycle: { select: { id: true, name: true } } },
  });
  if (!cycle) throw new NotFoundError();

  if (!isAdmin) {
    const owns = await prisma.compensationParticipant.count({
      where: { cycleId, managerIdSnapshot: actor.employeeId },
    });
    if (owns === 0) throw new NotFoundError();
    if (!['PLANNING', 'IN_APPROVAL', 'APPROVED', 'APPLIED'].includes(cycle.status)) {
      throw new NotFoundError();
    }
  }

  const participants = await prisma.compensationParticipant.findMany({
    where: {
      cycleId,
      ...(isAdmin ? {} : { managerIdSnapshot: actor.employeeId }),
    },
    orderBy: [{ employee: { lastName: 'asc' } }],
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
    },
  });

  const rows: CompRow[] = participants.map((p) => {
    const rec = recommendIncrease({
      score: p.performanceScore,
      baseMinor: p.currentBaseMinor,
      rangeMinMinor: p.bandMinMinor,
      rangeMaxMinor: p.bandMaxMinor,
      rangeMidMinor: p.bandMidMinor,
    });
    return {
      id: p.id,
      employeeId: p.employeeId,
      name: `${p.employee.preferredName ?? p.employee.firstName} ${p.employee.lastName}`,
      jobTitle: p.jobTitleNameSnapshot,
      department: p.departmentNameSnapshot,
      managerName: p.managerNameSnapshot,
      managerIdSnapshot: p.managerIdSnapshot,
      currency: p.currency,
      currentBaseMinor: p.currentBaseMinor,
      bandMinMinor: p.bandMinMinor,
      bandMidMinor: p.bandMidMinor,
      bandMaxMinor: p.bandMaxMinor,
      performanceScore: p.performanceScore,
      performanceBand: p.performanceBand,
      recommendedBp: p.recommendedBp,
      recommendationNote: rec.explanation,
      decidedBp: p.decidedBp,
      decidedAmountMinor: p.decidedAmountMinor,
      newBaseMinor: p.newBaseMinor,
      rationale: p.rationale,
      status: p.status,
      canEdit: canAllocateCompensation(actor, {
        employeeId: p.employeeId,
        managerIdSnapshot: p.managerIdSnapshot,
        cycleStatus: cycle.status,
        status: p.status,
      }),
      isOverride:
        p.decidedBp !== null && p.recommendedBp !== null && p.decidedBp !== p.recommendedBp,
    };
  });

  // Budget: the actor's own pool as a manager, or the whole cycle for an admin.
  const budgets = await prisma.compensationBudget.findMany({
    where: { cycleId, ...(isAdmin ? {} : { ownerEmployeeId: actor.employeeId ?? '' }) },
    include: { owner: { select: { id: true, firstName: true, lastName: true } } },
  });

  const allocated = totalAllocated(rows.map((r) => r.decidedAmountMinor));
  const pool = isAdmin
    ? cycle.totalPoolMinor
    : budgets.reduce((sum, b) => sum + b.poolMinor, 0);

  // Per-manager budgets, for the administrator who has to set them. Built from
  // the participant snapshots rather than from today's reporting line, so the
  // list is the people who are actually allocating in this cycle.
  const managerBudgets = isAdmin ? buildManagerBudgets(rows, budgets) : [];

  /**
   * Which of the three budget situations this actor is in. A pool of zero is
   * not the same as no pool, and a screen that collapses them tells somebody
   * nothing is enforced right before they are refused at submission.
   */
  const ceiling: 'none' | 'zero' | 'amount' = isAdmin
    ? cycle.totalPoolMinor > 0
      ? 'amount'
      : 'none'
    : budgets.length === 0
      ? 'none'
      : pool === 0
        ? 'zero'
        : 'amount';

  return {
    cycle,
    rows,
    budgets,
    managerBudgets,
    budget: budgetState(pool, allocated),
    ceiling,
    isAdmin,
  };
}

export interface ManagerBudgetRow {
  managerId: string;
  managerName: string;
  /** People in this manager's scope for this cycle. */
  headcount: number;
  decided: number;
  /** Payroll being allocated over, which is what a share of the pool is weighted by. */
  payrollMinor: number;
  poolMinor: number;
  allocatedMinor: number;
  remainingMinor: number;
  over: boolean;
  /** True when no pool has been set, so nothing is enforced at submission. */
  unset: boolean;
}

function buildManagerBudgets(
  rows: CompRow[],
  budgets: { ownerEmployeeId: string; poolMinor: number; owner: { firstName: string; lastName: string } }[],
): ManagerBudgetRow[] {
  const byManager = new Map<string, { name: string; rows: CompRow[] }>();
  for (const r of rows) {
    if (!r.managerIdSnapshot) continue;
    const entry = byManager.get(r.managerIdSnapshot);
    if (entry) entry.rows.push(r);
    else byManager.set(r.managerIdSnapshot, { name: r.managerName ?? 'Unnamed manager', rows: [r] });
  }

  // A budget can exist for somebody who is no longer allocating — a manager
  // whose people moved, for instance. Showing it is better than hiding a pool
  // that still counts against the total.
  for (const b of budgets) {
    if (!byManager.has(b.ownerEmployeeId)) {
      byManager.set(b.ownerEmployeeId, {
        name: `${b.owner.firstName} ${b.owner.lastName}`,
        rows: [],
      });
    }
  }

  const poolByManager = new Map(budgets.map((b) => [b.ownerEmployeeId, b.poolMinor]));

  return [...byManager.entries()]
    .map(([managerId, { name, rows: mine }]) => {
      const poolMinor = poolByManager.get(managerId) ?? 0;
      const allocatedMinor = totalAllocated(mine.map((r) => r.decidedAmountMinor));
      const state = budgetState(poolMinor, allocatedMinor);
      return {
        managerId,
        managerName: name,
        headcount: mine.length,
        decided: mine.filter((r) => r.decidedBp !== null).length,
        payrollMinor: mine.reduce((sum, r) => sum + r.currentBaseMinor, 0),
        poolMinor,
        allocatedMinor,
        remainingMinor: state.remainingMinor,
        over: state.over,
        unset: !poolByManager.has(managerId),
      };
    })
    .sort((a, b) => a.managerName.localeCompare(b.managerName));
}

// ---------------------------------------------------------------------------
// Creating a cycle
// ---------------------------------------------------------------------------

export interface CreateCycleInput {
  name: string;
  effectiveDate: string;
  dueAt?: string | null;
  reviewCycleId?: string | null;
  totalPoolMinor: number;
  currency?: string;
  notes?: string | null;
  employeeIds?: string[];
}

/**
 * Opens a cycle and snapshots everything a decision will be made against:
 * current pay, the salary band, the manager of record, and the released
 * performance score. Snapshotting matters for the same reason it does on a
 * review cycle — a band revision or a reorganization afterwards must not
 * silently rewrite the basis of a decision already taken.
 */
export async function createCompensationCycle(actor: Actor, input: CreateCycleInput) {
  requireCompAdmin(actor);

  if (input.totalPoolMinor < 0) {
    throw new ValidationError('A budget cannot be negative.');
  }

  const employees = await prisma.employee.findMany({
    where: {
      orgId: actor.orgId,
      employmentStatus: 'active',
      ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      managerId: true,
      manager: { select: { firstName: true, lastName: true } },
      jobTitle: {
        select: {
          name: true,
          salaryBand: { select: { minMinor: true, midMinor: true, maxMinor: true } },
        },
      },
      department: { select: { name: true } },
      compensationRecords: {
        orderBy: { effectiveDate: 'desc' },
        take: 1,
        select: { baseMinor: true, currency: true },
      },
    },
  });

  if (employees.length === 0) {
    throw new ConflictError('No active employees match that selection.');
  }

  const withoutPay = employees.filter((e) => e.compensationRecords.length === 0);
  if (withoutPay.length === employees.length) {
    throw new ConflictError(
      'None of the selected employees has a salary on record, so there is nothing to base a cycle on. ' +
        'Import or enter current pay first.',
    );
  }

  // Released scores from the linked review cycle, if one was chosen.
  const scores = new Map<string, number>();
  if (input.reviewCycleId) {
    const participants = await prisma.cycleParticipant.findMany({
      where: {
        cycleId: input.reviewCycleId,
        releasedAt: { not: null },
        cycle: { orgId: actor.orgId },
      },
      select: { employeeId: true, finalScore: true, calibratedScore: true },
    });
    for (const p of participants) {
      const score = p.calibratedScore ?? p.finalScore;
      if (score !== null) scores.set(p.employeeId, score);
    }
  }

  const eligible = employees.filter((e) => e.compensationRecords.length > 0);

  const cycle = await prisma.$transaction(async (tx) => {
    const created = await tx.compensationCycle.create({
      data: {
        orgId: actor.orgId,
        name: input.name,
        currency: input.currency ?? 'USD',
        status: 'DRAFT',
        effectiveDate: new Date(input.effectiveDate),
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        reviewCycleId: input.reviewCycleId ?? null,
        totalPoolMinor: input.totalPoolMinor,
        notes: input.notes ?? null,
        createdById: actor.employeeId,
      },
    });

    for (const e of eligible) {
      const pay = e.compensationRecords[0]!;
      const band = e.jobTitle?.salaryBand ?? null;
      const score = scores.get(e.id) ?? null;
      const rec = recommendIncrease({
        score,
        baseMinor: pay.baseMinor,
        rangeMinMinor: band?.minMinor ?? null,
        rangeMaxMinor: band?.maxMinor ?? null,
        rangeMidMinor: band?.midMinor ?? null,
      });

      await tx.compensationParticipant.create({
        data: {
          cycleId: created.id,
          employeeId: e.id,
          managerIdSnapshot: e.managerId,
          managerNameSnapshot: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : null,
          jobTitleNameSnapshot: e.jobTitle?.name ?? null,
          departmentNameSnapshot: e.department?.name ?? null,
          currentBaseMinor: pay.baseMinor,
          currency: pay.currency,
          bandMinMinor: band?.minMinor ?? null,
          bandMidMinor: band?.midMinor ?? null,
          bandMaxMinor: band?.maxMinor ?? null,
          performanceScore: score,
          performanceBand: rec.band,
          recommendedBp: rec.bp,
          status: 'PENDING',
        },
      });
    }

    return created;
  });

  await recordAudit(actor, {
    action: 'compensation.cycle.created',
    entityType: 'compensation_cycle',
    entityId: cycle.id,
    summary: `Opened compensation cycle "${cycle.name}" over ${eligible.length} employee(s), budget ${formatMoney(cycle.totalPoolMinor, { currency: cycle.currency, whole: true })}`,
    metadata: {
      participants: eligible.length,
      skippedNoPay: withoutPay.length,
      reviewCycleId: input.reviewCycleId ?? null,
    },
  });

  return { cycle, included: eligible.length, skippedNoPay: withoutPay.map((e) => `${e.firstName} ${e.lastName}`) };
}

/** Moves a draft cycle into planning and tells each manager they can start. */
export async function launchCompensationCycle(actor: Actor, cycleId: string) {
  requireCompAdmin(actor);
  const cycle = await prisma.compensationCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    select: { id: true, name: true, status: true, dueAt: true },
  });
  if (!cycle) throw new NotFoundError();
  if (cycle.status !== 'DRAFT') {
    throw new ConflictError('Only a draft cycle can be opened for allocation.');
  }

  const claim = await prisma.compensationCycle.updateMany({
    where: { id: cycleId, status: 'DRAFT' },
    data: { status: 'PLANNING', launchedAt: new Date() },
  });
  if (claim.count === 0) throw new ConflictError('That cycle has already been opened.');

  const managers = await prisma.compensationParticipant.groupBy({
    by: ['managerIdSnapshot'],
    where: { cycleId, managerIdSnapshot: { not: null } },
    _count: { managerIdSnapshot: true },
  });

  for (const m of managers) {
    if (!m.managerIdSnapshot) continue;
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: m.managerIdSnapshot,
      type: 'compensation.allocate',
      title: `${cycle.name}: your pay decisions are open`,
      body: `${m._count.managerIdSnapshot} people to allocate.`,
      linkUrl: `/compensation/${cycleId}`,
      severity: 'warning',
      dedupeKey: `comp.allocate:${cycleId}:${m.managerIdSnapshot}`,
    });
  }

  await recordAudit(actor, {
    action: 'compensation.cycle.launched',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary: `Opened "${cycle.name}" for allocation; notified ${managers.length} manager(s)`,
  });

  return { managersNotified: managers.length };
}

// ---------------------------------------------------------------------------
// Allocating
// ---------------------------------------------------------------------------

/**
 * Records one allocation.
 *
 * The amount is derived from the percentage once, here, and stored. Deriving
 * it again at render time would let the row and the budget total disagree by a
 * cent, which is the sort of discrepancy nobody can account for later.
 */
export async function allocateCompensation(
  actor: Actor,
  participantId: string,
  input: { bp: BasisPoints | null; rationale?: string | null },
): Promise<void> {
  const participant = await prisma.compensationParticipant.findFirst({
    where: { id: participantId, cycle: { orgId: actor.orgId } },
    include: {
      cycle: { select: { id: true, name: true, status: true, currency: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
  });
  if (!participant) throw new NotFoundError();

  const ref = {
    employeeId: participant.employeeId,
    managerIdSnapshot: participant.managerIdSnapshot,
    cycleStatus: participant.cycle.status,
    status: participant.status,
  };
  if (!canViewCompensationParticipant(actor, ref)) throw new NotFoundError();
  if (!canAllocateCompensation(actor, ref)) {
    throw new ForbiddenError(
      participant.cycle.status !== 'PLANNING'
        ? 'This cycle is no longer open for allocation.'
        : 'You are not the manager of record for this person in this cycle.',
    );
  }
  if (['SUBMITTED', 'APPROVED', 'APPLIED'].includes(participant.status)) {
    throw new ConflictError(
      'This allocation has already been submitted. Ask a compensation administrator to send it back if it needs changing.',
    );
  }

  if (input.bp !== null && (input.bp < 0 || input.bp > 10_000)) {
    throw new ValidationError('An increase must be between 0% and 100%.');
  }

  const amount = increaseFromBasisPoints(participant.currentBaseMinor, input.bp);
  const newBase = newBaseFrom(participant.currentBaseMinor, amount);

  // An override of the recommendation has to be accounted for. A number a
  // manager cannot explain is one nobody can defend later.
  const isOverride =
    input.bp !== null && participant.recommendedBp !== null && input.bp !== participant.recommendedBp;
  if (isOverride && !input.rationale?.trim()) {
    throw new ValidationError(
      'This differs from the recommendation, so record why in a sentence. It is kept with the decision.',
      [{ path: 'rationale', message: 'Give a reason for the override.' }],
    );
  }

  await prisma.compensationParticipant.update({
    where: { id: participantId },
    data: {
      decidedBp: input.bp,
      decidedAmountMinor: amount,
      newBaseMinor: newBase,
      rationale: input.rationale?.trim() || null,
      status: input.bp === null ? 'PENDING' : 'DECIDED',
      decidedByEmployeeId: actor.employeeId,
      decidedAt: input.bp === null ? null : new Date(),
    },
  });
}

/**
 * Submits a manager's allocations for approval.
 *
 * This is where the budget ceiling is enforced. Up to here being over is
 * reported but allowed, because a manager mid-way through is legitimately
 * over; at submission it becomes a decision somebody is making, and the
 * refusal says by how much.
 */
export async function submitCompensationAllocations(
  actor: Actor,
  cycleId: string,
): Promise<{ submitted: number }> {
  if (!actor.employeeId) throw new ForbiddenError();

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    select: { id: true, name: true, status: true, currency: true },
  });
  if (!cycle) throw new NotFoundError();
  if (cycle.status !== 'PLANNING') {
    throw new ConflictError('This cycle is not open for allocation.');
  }

  const mine = await prisma.compensationParticipant.findMany({
    where: { cycleId, managerIdSnapshot: actor.employeeId },
    select: { id: true, status: true, decidedAmountMinor: true, decidedBp: true, employee: { select: { firstName: true, lastName: true } } },
  });
  if (mine.length === 0) throw new NotFoundError();

  const undecided = mine.filter((p) => p.decidedBp === null);
  if (undecided.length > 0) {
    throw new ConflictError(
      `${undecided.length} of ${mine.length} people have no decision yet. A 0% increase is a decision and can be entered as one; leaving the field blank is not.`,
      { undecided: undecided.length, total: mine.length },
    );
  }

  // No budget row at all means no ceiling. A budget row of zero is a ceiling
  // of zero — this manager has nothing to give out — and is enforced as one.
  // The two are deliberately different, and the screens say which is which,
  // because "set it to zero to mean unlimited" is a trap nobody should fall
  // into with somebody's pay.
  const budget = await prisma.compensationBudget.findFirst({
    where: { cycleId, ownerEmployeeId: actor.employeeId },
    select: { poolMinor: true },
  });
  const allocated = totalAllocated(mine.map((p) => p.decidedAmountMinor));
  const state = budgetState(budget?.poolMinor ?? 0, allocated);

  if (budget && state.over) {
    throw new ConflictError(
      budget.poolMinor === 0
        ? `These allocations total ${formatMoney(allocated, { currency: cycle.currency })}, and your budget for this cycle is zero. ` +
            `Either every increase here has to be 0%, or the budget needs raising — ask a compensation administrator.`
        : `These allocations total ${formatMoney(allocated, { currency: cycle.currency })}, which is ` +
            `${formatMoney(state.overBy, { currency: cycle.currency })} over your budget of ` +
            `${formatMoney(state.poolMinor, { currency: cycle.currency })}. Adjust them, or ask for the pool to be raised.`,
      { overBy: state.overBy, poolMinor: budget.poolMinor },
    );
  }

  const result = await prisma.compensationParticipant.updateMany({
    where: { cycleId, managerIdSnapshot: actor.employeeId, status: 'DECIDED' },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  });

  await recordAudit(actor, {
    action: 'compensation.submitted',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary: `Submitted ${result.count} pay decision(s) for "${cycle.name}", totalling ${formatMoney(allocated, { currency: cycle.currency })}`,
    metadata: { count: result.count, allocatedMinor: allocated },
  });

  return { submitted: result.count };
}

// ---------------------------------------------------------------------------
// Approving and applying
// ---------------------------------------------------------------------------

export async function decideCompensationApproval(
  actor: Actor,
  participantId: string,
  decision: 'APPROVE' | 'REQUEST_CHANGES',
  note?: string | null,
): Promise<void> {
  if (!canApproveCompensation(actor)) {
    throw new ForbiddenError('Only a compensation administrator can approve pay decisions.');
  }
  const participant = await prisma.compensationParticipant.findFirst({
    where: { id: participantId, cycle: { orgId: actor.orgId } },
    include: {
      cycle: { select: { id: true, name: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
  });
  if (!participant) throw new NotFoundError();
  if (participant.status !== 'SUBMITTED') {
    throw new ConflictError('Only a submitted allocation can be approved or sent back.');
  }
  if (decision === 'REQUEST_CHANGES' && !note?.trim()) {
    throw new ValidationError('Say what needs changing — the manager sees this note.');
  }

  await prisma.compensationParticipant.update({
    where: { id: participantId },
    data: {
      status: decision === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED',
      approvedByUserId: decision === 'APPROVE' ? actor.userId : null,
      approvedAt: decision === 'APPROVE' ? new Date() : null,
      approvalNote: note?.trim() || null,
    },
  });

  if (decision === 'REQUEST_CHANGES' && participant.managerIdSnapshot) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: participant.managerIdSnapshot,
      type: 'compensation.changes_requested',
      title: `Changes requested on a pay decision`,
      body: `${participant.employee.firstName} ${participant.employee.lastName} — ${participant.cycle.name}`,
      linkUrl: `/compensation/${participant.cycleId}`,
      severity: 'warning',
      dedupeKey: `comp.changes:${participantId}:${Date.now()}`,
    });
  }

  await recordAudit(actor, {
    action: decision === 'APPROVE' ? 'compensation.approved' : 'compensation.changes_requested',
    entityType: 'compensation_participant',
    entityId: participantId,
    summary:
      decision === 'APPROVE'
        ? `Approved the pay decision for ${participant.employee.firstName} ${participant.employee.lastName}`
        : `Sent back the pay decision for ${participant.employee.firstName} ${participant.employee.lastName}`,
    metadata: { note: note?.trim() ?? null },
  });
}

/**
 * Writes approved increases into pay history.
 *
 * Separate from approval on purpose: approving says the number is right,
 * applying changes what the person is paid. One row per person is appended —
 * nothing is updated — so the history remains a record rather than a current
 * state that happens to be stored.
 */
export async function applyCompensationCycle(
  actor: Actor,
  cycleId: string,
): Promise<{ applied: number; skipped: number }> {
  requireCompAdmin(actor);

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    select: { id: true, name: true, status: true, effectiveDate: true, currency: true },
  });
  if (!cycle) throw new NotFoundError();
  if (!['IN_APPROVAL', 'APPROVED'].includes(cycle.status)) {
    throw new ConflictError(
      'Only a cycle whose decisions have been approved can be applied to pay records.',
    );
  }

  const approved = await prisma.compensationParticipant.findMany({
    where: { cycleId, status: 'APPROVED', newBaseMinor: { not: null } },
    select: {
      id: true,
      employeeId: true,
      newBaseMinor: true,
      currency: true,
      decidedBp: true,
      employee: { select: { firstName: true, lastName: true } },
    },
  });
  const outstanding = await prisma.compensationParticipant.count({
    where: { cycleId, status: { in: ['PENDING', 'DECIDED', 'SUBMITTED', 'CHANGES_REQUESTED'] } },
  });

  if (approved.length === 0) {
    throw new ConflictError('No approved decisions to apply.');
  }

  await prisma.$transaction(async (tx) => {
    for (const p of approved) {
      await tx.compensationRecord.create({
        data: {
          orgId: actor.orgId,
          employeeId: p.employeeId,
          baseMinor: p.newBaseMinor as number,
          currency: p.currency,
          effectiveDate: cycle.effectiveDate,
          changeType: 'MERIT',
          note: `${cycle.name}`,
          sourceCycleId: cycleId,
          recordedByUserId: actor.userId,
        },
      });
      await tx.compensationParticipant.update({
        where: { id: p.id },
        data: { status: 'APPLIED' },
      });
    }
    await tx.compensationCycle.update({
      where: { id: cycleId },
      data: { status: outstanding > 0 ? 'APPROVED' : 'APPLIED', appliedAt: new Date() },
    });
  });

  for (const p of approved) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: p.employeeId,
      type: 'compensation.applied',
      title: 'Your pay has been updated',
      body: `Effective ${cycle.effectiveDate.toISOString().slice(0, 10)}.`,
      linkUrl: '/compensation/me',
      dedupeKey: `comp.applied:${cycleId}:${p.employeeId}`,
    });
  }

  await recordAudit(actor, {
    action: 'compensation.applied',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary: `Applied ${approved.length} approved increase(s) from "${cycle.name}" to pay records`,
    metadata: { applied: approved.length, outstanding },
  });

  return { applied: approved.length, skipped: outstanding };
}

/** Moves a cycle from planning into approval. */
export async function closeAllocation(actor: Actor, cycleId: string): Promise<void> {
  requireCompAdmin(actor);
  const updated = await prisma.compensationCycle.updateMany({
    where: { id: cycleId, orgId: actor.orgId, status: 'PLANNING' },
    data: { status: 'IN_APPROVAL' },
  });
  if (updated.count === 0) {
    throw new ConflictError('Only a cycle in allocation can be moved to approval.');
  }
  await recordAudit(actor, {
    action: 'compensation.cycle.closed',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary: 'Closed allocation; the cycle is now awaiting approval',
  });
}

export async function setBudget(
  actor: Actor,
  cycleId: string,
  ownerEmployeeId: string,
  poolMinor: number,
): Promise<void> {
  requireCompAdmin(actor);
  if (poolMinor < 0) throw new ValidationError('A budget cannot be negative.');
  const cycle = await prisma.compensationCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    select: { id: true, currency: true },
  });
  if (!cycle) throw new NotFoundError();

  await prisma.compensationBudget.upsert({
    where: { cycleId_ownerEmployeeId: { cycleId, ownerEmployeeId } },
    create: { cycleId, ownerEmployeeId, poolMinor },
    update: { poolMinor },
  });

  await recordAudit(actor, {
    action: 'compensation.budget.set',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary: `Set a budget pool of ${formatMoney(poolMinor, { currency: cycle.currency, whole: true })}`,
    metadata: { ownerEmployeeId, poolMinor },
  });
}

/**
 * Removes a manager's budget row, which is not the same as setting it to zero.
 *
 * Without this there is no way back from a budget once one has been set: zero
 * is a ceiling of zero, so an administrator who set a figure by mistake could
 * never restore "no ceiling" from the interface.
 */
export async function clearBudget(
  actor: Actor,
  cycleId: string,
  ownerEmployeeId: string,
): Promise<void> {
  requireCompAdmin(actor);
  const existing = await prisma.compensationBudget.findFirst({
    where: { cycleId, ownerEmployeeId, cycle: { orgId: actor.orgId } },
    select: { id: true, poolMinor: true, cycle: { select: { currency: true } } },
  });
  if (!existing) throw new NotFoundError();

  await prisma.compensationBudget.delete({ where: { id: existing.id } });

  await recordAudit(actor, {
    action: 'compensation.budget.cleared',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary:
      `Removed a budget of ${formatMoney(existing.poolMinor, { currency: existing.cycle.currency, whole: true })}. ` +
      `No ceiling is now enforced for this manager at submission.`,
    metadata: { ownerEmployeeId, previousPoolMinor: existing.poolMinor },
  });
}

/**
 * Divides the whole pool between the managers allocating in this cycle,
 * weighted by the payroll each is allocating over.
 *
 * The last manager takes the remainder, so the budgets sum to the pool exactly
 * rather than to the pool give or take a few cents. An administrator who wants
 * a different split can set any pool by hand afterwards; this is the starting
 * point nobody should have to compute in a spreadsheet.
 */
export async function splitBudgetByPayroll(
  actor: Actor,
  cycleId: string,
): Promise<{ managers: number; allocatedMinor: number }> {
  requireCompAdmin(actor);

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    select: { id: true, currency: true, totalPoolMinor: true },
  });
  if (!cycle) throw new NotFoundError();
  if (cycle.totalPoolMinor <= 0) {
    throw new ConflictError(
      'This cycle has no pool to divide. Set a total pool on the cycle first, or set each manager’s budget by hand.',
    );
  }

  const groups = await prisma.compensationParticipant.groupBy({
    by: ['managerIdSnapshot'],
    where: { cycleId, managerIdSnapshot: { not: null } },
    _sum: { currentBaseMinor: true },
  });
  if (groups.length === 0) {
    throw new ConflictError('Nobody in this cycle has a manager recorded, so there is nothing to divide between.');
  }

  const totalPayroll = groups.reduce((sum, g) => sum + (g._sum.currentBaseMinor ?? 0), 0);
  if (totalPayroll <= 0) {
    throw new ConflictError('The payroll in this cycle totals zero, so a weighted split is not meaningful.');
  }

  let allocated = 0;
  await prisma.$transaction(async (tx) => {
    for (const [i, g] of groups.entries()) {
      const share = (g._sum.currentBaseMinor ?? 0) / totalPayroll;
      const poolMinor =
        i === groups.length - 1
          ? cycle.totalPoolMinor - allocated
          : Math.round(cycle.totalPoolMinor * share);
      allocated += poolMinor;
      await tx.compensationBudget.upsert({
        where: {
          cycleId_ownerEmployeeId: { cycleId, ownerEmployeeId: g.managerIdSnapshot as string },
        },
        create: {
          cycleId,
          ownerEmployeeId: g.managerIdSnapshot as string,
          poolMinor,
          note: 'Weighted by the payroll in this manager’s scope.',
        },
        update: { poolMinor, note: 'Weighted by the payroll in this manager’s scope.' },
      });
    }
  });

  await recordAudit(actor, {
    action: 'compensation.budget.split',
    entityType: 'compensation_cycle',
    entityId: cycleId,
    summary:
      `Divided the ${formatMoney(cycle.totalPoolMinor, { currency: cycle.currency, whole: true })} pool ` +
      `between ${groups.length} manager(s), weighted by payroll`,
    metadata: { managers: groups.length, totalPoolMinor: cycle.totalPoolMinor },
  });

  return { managers: groups.length, allocatedMinor: allocated };
}

// ---------------------------------------------------------------------------
// A person's own pay
// ---------------------------------------------------------------------------

/**
 * Somebody's own salary history, or an administrator's view of it.
 *
 * Deliberately not reachable by a manager. A manager sees current pay for the
 * people they are allocating, inside a live cycle, and nothing else — the
 * history of what somebody earned before they reported to you is not part of
 * deciding this year's increase.
 */
export async function getPayHistory(actor: Actor, employeeId: string) {
  const isSelf = canViewOwnCompensation(actor, employeeId);
  if (!isSelf && !canAdministerCompensation(actor)) throw new NotFoundError();

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      jobTitle: {
        select: {
          name: true,
          salaryBand: {
            select: { minMinor: true, midMinor: true, maxMinor: true, currency: true },
          },
        },
      },
    },
  });
  if (!employee) throw new NotFoundError();

  const records = await prisma.compensationRecord.findMany({
    where: { employeeId, orgId: actor.orgId },
    orderBy: { effectiveDate: 'desc' },
    select: {
      id: true,
      baseMinor: true,
      currency: true,
      effectiveDate: true,
      changeType: true,
      note: true,
      createdAt: true,
    },
  });

  return { employee, records, current: records[0] ?? null, isSelf };
}

// ---------------------------------------------------------------------------
// Salary bands
// ---------------------------------------------------------------------------

/**
 * Bands, listed against every job title so the gaps are visible.
 *
 * A title without a band is not an error — it means no range has been agreed
 * for that role, and the consequence is that nobody in it gets a position-in-
 * band input to their recommendation. Showing those titles is the point.
 */
export async function listSalaryBands(actor: Actor) {
  if (!canManageSalaryBands(actor)) throw new NotFoundError();

  const titles = await prisma.jobTitle.findMany({
    where: { orgId: actor.orgId, active: true },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      level: true,
      department: { select: { name: true } },
      salaryBand: {
        select: {
          id: true,
          currency: true,
          minMinor: true,
          midMinor: true,
          maxMinor: true,
          effectiveFrom: true,
        },
      },
      _count: { select: { employees: { where: { employmentStatus: 'active' } } } },
    },
  });

  return titles.map((t) => ({
    jobTitleId: t.id,
    name: t.name,
    level: t.level,
    department: t.department?.name ?? null,
    headcount: t._count.employees,
    band: t.salaryBand,
  }));
}

export interface SalaryBandInput {
  minMinor: number;
  midMinor?: number | null;
  maxMinor: number;
  currency?: string;
}

/**
 * Creates or replaces the band for a job title.
 *
 * A band revision does not reach back into an open cycle: participants carry
 * the band they were launched against, so changing a range today cannot alter
 * the basis of a decision a manager has already taken.
 */
export async function setSalaryBand(
  actor: Actor,
  jobTitleId: string,
  input: SalaryBandInput,
): Promise<void> {
  if (!canManageSalaryBands(actor)) {
    throw new ForbiddenError('Salary bands are salary configuration, so they need the compensation administrator role.');
  }

  if (!Number.isInteger(input.minMinor) || !Number.isInteger(input.maxMinor)) {
    throw new ValidationError('A band is stored in whole cents.');
  }
  if (input.minMinor < 0) throw new ValidationError('A band cannot start below zero.');
  if (input.maxMinor < input.minMinor) {
    throw new ValidationError('The top of the band cannot be below the bottom of it.');
  }
  if (
    input.midMinor !== null &&
    input.midMinor !== undefined &&
    (input.midMinor < input.minMinor || input.midMinor > input.maxMinor)
  ) {
    throw new ValidationError('The midpoint has to sit inside the band.');
  }

  const title = await prisma.jobTitle.findFirst({
    where: { id: jobTitleId, orgId: actor.orgId },
    select: { id: true, name: true, salaryBand: { select: { minMinor: true, maxMinor: true } } },
  });
  if (!title) throw new NotFoundError();

  const currency = input.currency ?? 'USD';
  const previous = title.salaryBand;

  await prisma.salaryBand.upsert({
    where: { jobTitleId },
    create: {
      orgId: actor.orgId,
      jobTitleId,
      currency,
      minMinor: input.minMinor,
      midMinor: input.midMinor ?? null,
      maxMinor: input.maxMinor,
    },
    update: {
      currency,
      minMinor: input.minMinor,
      midMinor: input.midMinor ?? null,
      maxMinor: input.maxMinor,
    },
  });

  await recordAudit(actor, {
    action: previous ? 'compensation.band.revised' : 'compensation.band.created',
    entityType: 'job_title',
    entityId: jobTitleId,
    summary:
      `${previous ? 'Revised' : 'Set'} the band for ${title.name} to ` +
      `${formatMoney(input.minMinor, { currency, whole: true })}–${formatMoney(input.maxMinor, { currency, whole: true })}` +
      (previous
        ? ` (was ${formatMoney(previous.minMinor, { currency, whole: true })}–${formatMoney(previous.maxMinor, { currency, whole: true })})`
        : ''),
    metadata: {
      minMinor: input.minMinor,
      midMinor: input.midMinor ?? null,
      maxMinor: input.maxMinor,
      previousMinMinor: previous?.minMinor ?? null,
      previousMaxMinor: previous?.maxMinor ?? null,
    },
  });
}

/** Removes a band. People in the title keep their pay; they lose the range. */
export async function removeSalaryBand(actor: Actor, jobTitleId: string): Promise<void> {
  if (!canManageSalaryBands(actor)) {
    throw new ForbiddenError('Salary bands need the compensation administrator role.');
  }
  const title = await prisma.jobTitle.findFirst({
    where: { id: jobTitleId, orgId: actor.orgId },
    select: { id: true, name: true, salaryBand: { select: { id: true } } },
  });
  if (!title?.salaryBand) throw new NotFoundError();

  await prisma.salaryBand.delete({ where: { jobTitleId } });

  await recordAudit(actor, {
    action: 'compensation.band.removed',
    entityType: 'job_title',
    entityId: jobTitleId,
    summary: `Removed the salary band for ${title.name}`,
  });
}
