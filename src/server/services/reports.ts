import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { loadManagerHistory } from '../authz/history';
import { participantAccess, reportScope, type ReportScope } from '../authz/policy';
import { ForbiddenError } from '../errors';
import { computeGoalProgress, goalRisk } from '../scoring/goal-progress';
import { safeJsonParse } from '@/lib/utils';
import type { ReviewScoreResult } from '../scoring/review-score';

/**
 * Reporting.
 *
 * Three rules shape everything here:
 *
 *  1. Scope. Every query is intersected with `reportScope(actor)`, so a
 *     manager's report covers their reporting line and nobody else's, and an
 *     export cannot widen that.
 *  2. Denominators. Every proportion is returned with the counts it came from.
 *     A completion percentage without "of how many" is not a fact.
 *  3. Comparability. Scores from different rating scales are not pooled. Where
 *     a figure spans templates, the report says which scales are involved so a
 *     reader can see whether the comparison is sound.
 */

function scopeIds(scope: ReportScope): string[] | null {
  if (scope.kind === 'ORGANIZATION') return null; // no restriction
  if (scope.kind === 'NONE') return [];
  return scope.employeeIds;
}

function employeeFilter(scope: ReportScope): Record<string, unknown> {
  const ids = scopeIds(scope);
  return ids === null ? {} : { employeeId: { in: ids } };
}

// ---------------------------------------------------------------------------
// Review completion
// ---------------------------------------------------------------------------

export interface CompletionRow {
  cycleId: string;
  cycleName: string;
  cycleStatus: string;
  periodLabel: string;
  participants: number;
  selfTotal: number;
  selfSubmitted: number;
  managerTotal: number;
  managerSubmitted: number;
  peerTotal: number;
  peerSubmitted: number;
  overdue: number;
  released: number;
  acknowledged: number;
  templateName: string;
}

export interface OverdueRow {
  assignmentId: string;
  reviewerName: string;
  reviewerId: string;
  subjectName: string;
  participantId: string;
  kind: string;
  cycleName: string;
  dueAt: Date | null;
  daysOverdue: number;
  status: string;
}

export async function reviewCompletionReport(
  actor: Actor,
  options: { cycleId?: string } = {},
): Promise<{ scope: ReportScope; cycles: CompletionRow[]; overdue: OverdueRow[]; note: string }> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');

  const ids = scopeIds(scope);
  const now = new Date();

  const cycles = await prisma.reviewCycle.findMany({
    where: {
      orgId: actor.orgId,
      status: { in: ['ACTIVE', 'CLOSED'] },
      ...(options.cycleId ? { id: options.cycleId } : {}),
    },
    orderBy: { periodEnd: 'desc' },
    take: 12,
    include: {
      templateVersion: { include: { template: { select: { name: true } } } },
      participants: {
        where: ids === null ? {} : { employeeId: { in: ids } },
        include: {
          assignments: {
            select: { id: true, kind: true, status: true, dueAt: true, reviewerEmployeeId: true },
          },
          employee: { select: { firstName: true, lastName: true, preferredName: true } },
        },
      },
    },
  });

  const rows: CompletionRow[] = [];
  const overdue: OverdueRow[] = [];

  for (const c of cycles) {
    if (c.participants.length === 0) continue;
    const all = c.participants.flatMap((p) => p.assignments);
    const count = (kind: string, submitted: boolean) =>
      all.filter((a) => a.kind === kind && (submitted ? a.status === 'SUBMITTED' : true)).length;

    rows.push({
      cycleId: c.id,
      cycleName: c.name,
      cycleStatus: c.status,
      periodLabel: `${c.periodStart.getFullYear()}`,
      participants: c.participants.length,
      selfTotal: count('SELF', false),
      selfSubmitted: count('SELF', true),
      managerTotal: count('MANAGER', false),
      managerSubmitted: count('MANAGER', true),
      peerTotal: count('PEER', false),
      peerSubmitted: count('PEER', true),
      overdue: all.filter(
        (a) => ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status) && a.dueAt && a.dueAt < now,
      ).length,
      released: c.participants.filter((p) =>
        ['RELEASED', 'ACKNOWLEDGED', 'CLOSED'].includes(p.status),
      ).length,
      acknowledged: c.participants.filter((p) => ['ACKNOWLEDGED', 'CLOSED'].includes(p.status)).length,
      templateName: c.templateVersion.template.name,
    });

    if (c.status === 'ACTIVE') {
      const reviewerIds = [...new Set(all.map((a) => a.reviewerEmployeeId))];
      const reviewers = await prisma.employee.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, firstName: true, lastName: true, preferredName: true },
      });
      const byId = new Map(reviewers.map((r) => [r.id, r]));

      for (const p of c.participants) {
        for (const a of p.assignments) {
          if (!['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status)) continue;
          if (!a.dueAt || a.dueAt >= now) continue;
          const reviewer = byId.get(a.reviewerEmployeeId);
          overdue.push({
            assignmentId: a.id,
            reviewerId: a.reviewerEmployeeId,
            reviewerName: reviewer
              ? `${reviewer.preferredName || reviewer.firstName} ${reviewer.lastName}`
              : 'Unknown',
            subjectName: `${p.employee.preferredName || p.employee.firstName} ${p.employee.lastName}`,
            participantId: p.id,
            kind: a.kind,
            cycleName: c.name,
            dueAt: a.dueAt,
            daysOverdue: Math.floor((now.getTime() - a.dueAt.getTime()) / 86_400_000),
            status: a.status,
          });
        }
      }
    }
  }

  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    scope,
    cycles: rows,
    overdue,
    note:
      scope.kind === 'ORGANIZATION'
        ? 'Covering every employee in the organization.'
        : scope.kind === 'TEAM'
          ? `Covering you and the ${scope.employeeIds.length - 1} people in your reporting line.`
          : 'Covering your own records only.',
  };
}

// ---------------------------------------------------------------------------
// Rating distribution
// ---------------------------------------------------------------------------

export interface DistributionBucket {
  label: string;
  value: number;
  count: number;
}

export interface RatingDistribution {
  cycleId: string;
  cycleName: string;
  scaleName: string | null;
  scaleMax: number | null;
  buckets: DistributionBucket[];
  mean: number | null;
  scored: number;
  notScored: number;
  participants: number;
  /** True when the cycle mixes templates, so the comparison needs care. */
  mixedTemplates: boolean;
  templateNames: string[];
}

/**
 * Distribution of overall ratings for a cycle.
 *
 * Built from the stored per-assignment score breakdown rather than recomputed,
 * and bucketed by the *scale's own levels* so the chart reads in the language
 * the reviewers used rather than as an abstract percentage.
 */
export async function ratingDistributionReport(
  actor: Actor,
  cycleId: string,
): Promise<RatingDistribution | null> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');
  const ids = scopeIds(scope);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: {
      participants: {
        where: ids === null ? {} : { employeeId: { in: ids } },
        include: {
          templateVersion: { include: { template: { select: { name: true } } } },
          assignments: {
            where: { kind: 'MANAGER', status: 'SUBMITTED' },
            select: { scoreJson: true, score: true },
          },
        },
      },
    },
  });
  if (!cycle) return null;

  // Find the scale used by the "overall" rating questions in this cycle, so the
  // buckets can carry the words reviewers actually chose.
  const scale = await prisma.ratingScale.findFirst({
    where: {
      orgId: actor.orgId,
      questions: { some: { section: { versionId: cycle.templateVersionId }, type: 'RATING' } },
    },
    include: { levels: { orderBy: { value: 'asc' } } },
  });

  const templateNames = [
    ...new Set(cycle.participants.map((p) => p.templateVersion.template.name)),
  ];

  const scores: number[] = [];
  let notScored = 0;
  for (const p of cycle.participants) {
    const assignment = p.assignments[0];
    const value = p.calibratedScore ?? p.finalScore ?? assignment?.score ?? null;
    if (value === null) notScored += 1;
    else scores.push(value);
  }

  const levels = scale?.levels ?? [];
  const max = levels.length > 0 ? Math.max(...levels.map((l) => l.value)) : null;
  const min = levels.length > 0 ? Math.min(...levels.map((l) => l.value)) : null;

  const buckets: DistributionBucket[] =
    levels.length > 0 && max !== null && min !== null
      ? levels.map((l, i) => {
          // Each level owns the band of 0-100 nearest to it.
          const span = 100 / (levels.length - 1 || 1);
          const centre = (i / (levels.length - 1 || 1)) * 100;
          const lower = i === 0 ? -1 : centre - span / 2;
          const upper = i === levels.length - 1 ? 101 : centre + span / 2;
          return {
            label: `${l.value} — ${l.label}`,
            value: l.value,
            count: scores.filter((s) => s > lower && s <= upper).length,
          };
        })
      : [];

  return {
    cycleId: cycle.id,
    cycleName: cycle.name,
    scaleName: scale?.name ?? null,
    scaleMax: max,
    buckets,
    mean:
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null,
    scored: scores.length,
    notScored,
    participants: cycle.participants.length,
    mixedTemplates: templateNames.length > 1,
    templateNames,
  };
}

// ---------------------------------------------------------------------------
// Cross-cycle trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  cycleId: string;
  cycleName: string;
  periodEnd: Date;
  mean: number | null;
  scored: number;
  participants: number;
  templateNames: string[];
  scaleName: string | null;
}

/**
 * Mean score across comparable cycles.
 *
 * "Comparable" is doing real work here: a cycle whose template or rating scale
 * differs from the most recent one is returned with a flag so the chart can
 * break the line rather than imply a continuous measure.
 */
export async function scoreTrendReport(
  actor: Actor,
  options: { category?: string } = {},
): Promise<{ points: TrendPoint[]; comparable: boolean; caveat: string | null }> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');
  const ids = scopeIds(scope);

  const cycles = await prisma.reviewCycle.findMany({
    where: {
      orgId: actor.orgId,
      status: { in: ['ACTIVE', 'CLOSED'] },
      ...(options.category
        ? { templateVersion: { template: { category: options.category } } }
        : {}),
    },
    orderBy: { periodEnd: 'asc' },
    take: 10,
    include: {
      templateVersion: { include: { template: { select: { name: true, category: true } } } },
      participants: {
        where: ids === null ? {} : { employeeId: { in: ids } },
        select: {
          finalScore: true,
          calibratedScore: true,
          templateVersion: { include: { template: { select: { name: true } } } },
        },
      },
    },
  });

  const points: TrendPoint[] = [];
  for (const c of cycles) {
    if (c.participants.length === 0) continue;
    const scores = c.participants
      .map((p) => p.calibratedScore ?? p.finalScore)
      .filter((s): s is number => s !== null);
    points.push({
      cycleId: c.id,
      cycleName: c.name,
      periodEnd: c.periodEnd,
      mean:
        scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null,
      scored: scores.length,
      participants: c.participants.length,
      templateNames: [...new Set(c.participants.map((p) => p.templateVersion.template.name))],
      scaleName: null,
    });
  }

  const allTemplates = new Set(points.flatMap((p) => p.templateNames));
  const comparable = allTemplates.size <= 1;

  return {
    points,
    comparable,
    caveat: comparable
      ? null
      : `These cycles used ${allTemplates.size} different templates (${[...allTemplates].join(', ')}). A score is a position on that template's own rating scale, so the periods are not strictly comparable. Treat the direction as indicative and read the per-cycle distributions before drawing a conclusion.`,
  };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalReport {
  total: number;
  byStatus: { status: string; count: number }[];
  byHealth: { health: string; count: number }[];
  needsAttention: number;
  averageProgress: number | null;
  withProgress: number;
  completedOnTime: number;
  completedLate: number;
  byDepartment: { department: string; total: number; averageProgress: number | null; withProgress: number }[];
}

export async function goalReport(actor: Actor): Promise<GoalReport> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');
  const ids = scopeIds(scope);

  const goals = await prisma.goal.findMany({
    where: {
      orgId: actor.orgId,
      ...(ids === null ? {} : { ownerEmployeeId: { in: ids } }),
    },
    include: {
      milestones: { select: { completedAt: true, weight: true } },
      owner: { select: { department: { select: { name: true } } } },
    },
  });

  const shaped = goals.map((g) => ({
    status: g.status,
    health: g.health,
    department: g.owner?.department?.name ?? 'Not set',
    dueDate: g.dueDate,
    completedAt: g.completedAt,
    risk: goalRisk({ status: g.status, health: g.health, dueDate: g.dueDate }),
    progress: computeGoalProgress({
      measurementType: g.measurementType,
      startValue: g.startValue,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      higherIsBetter: g.higherIsBetter,
      reportedProgressPct: g.reportedProgressPct,
      status: g.status,
      milestones: g.milestones,
    }).displayPct,
  }));

  const withProgress = shaped.filter((g) => g.progress !== null);
  const byDeptMap = new Map<string, { total: number; sum: number; withProgress: number }>();
  for (const g of shaped) {
    const entry = byDeptMap.get(g.department) ?? { total: 0, sum: 0, withProgress: 0 };
    entry.total += 1;
    if (g.progress !== null) {
      entry.sum += g.progress;
      entry.withProgress += 1;
    }
    byDeptMap.set(g.department, entry);
  }

  const countBy = <K extends 'status' | 'health'>(key: K) => {
    const map = new Map<string, number>();
    for (const g of shaped) map.set(g[key], (map.get(g[key]) ?? 0) + 1);
    return [...map.entries()].map(([k, count]) => ({ [key]: k, count }) as never);
  };

  return {
    total: shaped.length,
    byStatus: countBy('status'),
    byHealth: countBy('health'),
    needsAttention: shaped.filter((g) => g.risk !== 'NONE' && g.risk !== 'DUE_SOON').length,
    averageProgress:
      withProgress.length > 0
        ? Math.round(withProgress.reduce((s, g) => s + (g.progress as number), 0) / withProgress.length)
        : null,
    withProgress: withProgress.length,
    completedOnTime: shaped.filter(
      (g) => g.status === 'COMPLETED' && g.completedAt && g.dueDate && g.completedAt <= g.dueDate,
    ).length,
    completedLate: shaped.filter(
      (g) => g.status === 'COMPLETED' && g.completedAt && g.dueDate && g.completedAt > g.dueDate,
    ).length,
    byDepartment: [...byDeptMap.entries()]
      .map(([department, e]) => ({
        department,
        total: e.total,
        averageProgress: e.withProgress > 0 ? Math.round(e.sum / e.withProgress) : null,
        withProgress: e.withProgress,
      }))
      .sort((a, b) => b.total - a.total),
  };
}

// ---------------------------------------------------------------------------
// Action items / meetings
// ---------------------------------------------------------------------------

export interface ActionReport {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
  overdue: number;
  completedOnTime: number;
  completedLate: number;
  meetingsHeld: number;
  meetingsScheduled: number;
  byOwner: { name: string; open: number; overdue: number; completed: number }[];
}

export async function actionReport(actor: Actor): Promise<ActionReport> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');
  const ids = scopeIds(scope);
  const now = new Date();

  const [items, meetingsHeld, meetingsScheduled] = await Promise.all([
    prisma.actionItem.findMany({
      where: {
        orgId: actor.orgId,
        ...(ids === null ? {} : { ownerEmployeeId: { in: ids } }),
        // HR-restricted actions are excluded from aggregate reporting.
        visibility: { not: 'HR_RESTRICTED' },
      },
      include: { owner: { select: { firstName: true, lastName: true, preferredName: true } } },
    }),
    prisma.meeting.count({
      where: {
        orgId: actor.orgId,
        status: 'COMPLETED',
        ...(ids === null ? {} : { participants: { some: { employeeId: { in: ids } } } }),
      },
    }),
    prisma.meeting.count({
      where: {
        orgId: actor.orgId,
        status: 'SCHEDULED',
        ...(ids === null ? {} : { participants: { some: { employeeId: { in: ids } } } }),
      },
    }),
  ]);

  const byOwnerMap = new Map<string, { open: number; overdue: number; completed: number }>();
  for (const a of items) {
    const name = `${a.owner.preferredName || a.owner.firstName} ${a.owner.lastName}`;
    const entry = byOwnerMap.get(name) ?? { open: 0, overdue: 0, completed: 0 };
    if (a.status === 'COMPLETED') entry.completed += 1;
    else {
      entry.open += 1;
      if (a.dueDate && a.dueDate < now) entry.overdue += 1;
    }
    byOwnerMap.set(name, entry);
  }

  return {
    total: items.length,
    open: items.filter((a) => a.status === 'OPEN').length,
    inProgress: items.filter((a) => a.status === 'IN_PROGRESS').length,
    completed: items.filter((a) => a.status === 'COMPLETED').length,
    overdue: items.filter((a) => a.status !== 'COMPLETED' && a.dueDate && a.dueDate < now).length,
    completedOnTime: items.filter(
      (a) => a.status === 'COMPLETED' && a.completedAt && a.dueDate && a.completedAt <= a.dueDate,
    ).length,
    completedLate: items.filter(
      (a) => a.status === 'COMPLETED' && a.completedAt && a.dueDate && a.completedAt > a.dueDate,
    ).length,
    meetingsHeld,
    meetingsScheduled,
    byOwner: [...byOwnerMap.entries()]
      .map(([name, e]) => ({ name, ...e }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open),
  };
}

// ---------------------------------------------------------------------------
// Nine-box: performance against readiness
// ---------------------------------------------------------------------------

export interface NineBoxResult {
  cycleId: string;
  cycleName: string;
  rowLabels: string[];
  colLabels: string[];
  cells: { row: number; col: number; count: number; names?: string[] }[];
  placed: number;
  unplaced: number;
  note: string;
}

const READINESS_ORDER = [
  'Needs to consolidate the current role first',
  'Developing in the current role',
  'Ready within a year with development',
  'Ready now',
];

/**
 * A nine-box style view: the overall score on one axis and the recorded
 * readiness answer on the other.
 *
 * Both axes come from answers people actually gave — there is no hidden
 * "potential" rating invented by the system. Anyone missing either answer is
 * reported as unplaced rather than being quietly dropped into a corner.
 */
export async function nineBoxReport(actor: Actor, cycleId: string): Promise<NineBoxResult | null> {
  if (!actor.isHrAdmin && !actor.isLeadership) {
    throw new ForbiddenError('The nine-box view is available to HR administrators and leadership.');
  }
  const scope = reportScope(actor);
  const ids = scopeIds(scope);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: {
      participants: {
        where: ids === null ? {} : { employeeId: { in: ids } },
        include: {
          employee: { select: { firstName: true, lastName: true, preferredName: true } },
          assignments: {
            where: { kind: 'MANAGER', status: 'SUBMITTED' },
            include: {
              responses: {
                include: { question: { select: { type: true, prompt: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!cycle) return null;

  const performanceBands = ['Below the standard', 'Meets the standard', 'Above the standard'];
  const cells = new Map<string, { count: number; names: string[] }>();
  let placed = 0;
  let unplaced = 0;

  for (const p of cycle.participants) {
    const score = p.calibratedScore ?? p.finalScore;
    const readinessResponse = p.assignments
      .flatMap((a) => a.responses)
      .find(
        (r) =>
          r.question.type === 'MULTIPLE_CHOICE' &&
          /readiness|more responsibility/i.test(r.question.prompt),
      );
    const readiness = readinessResponse?.textValue ?? null;

    if (score === null || !readiness) {
      unplaced += 1;
      continue;
    }

    const row = score < 45 ? 0 : score < 72 ? 1 : 2;
    const colIndex = READINESS_ORDER.indexOf(readiness);
    if (colIndex < 0) {
      unplaced += 1;
      continue;
    }

    const key = `${row}:${colIndex}`;
    const entry = cells.get(key) ?? { count: 0, names: [] };
    entry.count += 1;
    entry.names.push(`${p.employee.preferredName || p.employee.firstName} ${p.employee.lastName}`);
    cells.set(key, entry);
    placed += 1;
  }

  return {
    cycleId: cycle.id,
    cycleName: cycle.name,
    rowLabels: performanceBands,
    colLabels: ['Consolidating', 'Developing', 'Ready in a year', 'Ready now'],
    cells: [...cells.entries()].map(([key, v]) => {
      const [row, col] = key.split(':').map(Number);
      return { row: row as number, col: col as number, count: v.count, names: v.names };
    }),
    placed,
    unplaced,
    note: `Placed from ${placed} of ${cycle.participants.length} participants. The horizontal axis is the readiness answer the manager selected; the vertical axis bands the overall score (below 45, 45–72, above 72 of 100). ${unplaced > 0 ? `${unplaced} could not be placed because they have no score, no readiness answer, or both.` : ''}`,
  };
}

// ---------------------------------------------------------------------------
// Competency strengths and gaps
// ---------------------------------------------------------------------------

export interface CompetencyReportRow {
  competency: string;
  mean: number;
  scaleMax: number;
  responses: number;
  notApplicable: number;
}

export async function competencyReport(
  actor: Actor,
  cycleId: string,
): Promise<{ rows: CompetencyReportRow[]; note: string }> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');
  const ids = scopeIds(scope);

  const responses = await prisma.reviewResponse.findMany({
    where: {
      assignment: {
        kind: 'MANAGER',
        status: 'SUBMITTED',
        participant: {
          cycleId,
          ...(ids === null ? {} : { employeeId: { in: ids } }),
        },
      },
      question: { type: 'COMPETENCY_RATING' },
    },
    include: {
      question: {
        include: {
          competency: { select: { name: true } },
          ratingScale: { include: { levels: { select: { value: true } } } },
        },
      },
    },
  });

  const map = new Map<string, { sum: number; n: number; na: number; max: number }>();
  for (const r of responses) {
    const name = r.question.competency?.name ?? r.question.prompt;
    const max = r.question.ratingScale
      ? Math.max(...r.question.ratingScale.levels.map((l) => l.value))
      : 4;
    const entry = map.get(name) ?? { sum: 0, n: 0, na: 0, max };
    if (r.notApplicable) entry.na += 1;
    else if (r.numericValue !== null) {
      entry.sum += r.numericValue;
      entry.n += 1;
    }
    map.set(name, entry);
  }

  const rows = [...map.entries()]
    .filter(([, e]) => e.n > 0)
    .map(([competency, e]) => ({
      competency,
      mean: Math.round((e.sum / e.n) * 100) / 100,
      scaleMax: e.max,
      responses: e.n,
      notApplicable: e.na,
    }))
    .sort((a, b) => a.mean - b.mean);

  return {
    rows,
    note: 'Each figure is the mean of the manager ratings given for that competency in this cycle. Ratings marked "not applicable" are excluded from the mean and counted separately — they are not treated as low scores.',
  };
}

// ---------------------------------------------------------------------------
// Participation by group
// ---------------------------------------------------------------------------

export interface ParticipationRow {
  group: string;
  people: number;
  selfSubmitted: number;
  selfTotal: number;
  managerSubmitted: number;
  managerTotal: number;
  acknowledged: number;
  released: number;
}

export async function participationByGroup(
  actor: Actor,
  cycleId: string,
  dimension: 'department' | 'jobTitle' | 'manager',
): Promise<{ rows: ParticipationRow[]; note: string }> {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') throw new ForbiddenError('You do not have access to reporting.');
  const ids = scopeIds(scope);

  const participants = await prisma.cycleParticipant.findMany({
    where: {
      cycleId,
      cycle: { orgId: actor.orgId },
      ...(ids === null ? {} : { employeeId: { in: ids } }),
    },
    include: {
      employee: {
        select: {
          department: { select: { name: true } },
          jobTitle: { select: { name: true } },
        },
      },
      assignments: { select: { kind: true, status: true } },
    },
  });

  const map = new Map<string, ParticipationRow>();
  for (const p of participants) {
    const key =
      dimension === 'department'
        ? (p.departmentNameSnapshot ?? p.employee.department?.name ?? 'Not set')
        : dimension === 'jobTitle'
          ? (p.jobTitleNameSnapshot ?? p.employee.jobTitle?.name ?? 'Not set')
          : (p.managerNameSnapshot ?? 'No manager');

    const row =
      map.get(key) ??
      ({
        group: key,
        people: 0,
        selfSubmitted: 0,
        selfTotal: 0,
        managerSubmitted: 0,
        managerTotal: 0,
        acknowledged: 0,
        released: 0,
      } satisfies ParticipationRow);

    row.people += 1;
    for (const a of p.assignments) {
      if (a.kind === 'SELF') {
        row.selfTotal += 1;
        if (a.status === 'SUBMITTED') row.selfSubmitted += 1;
      } else if (a.kind === 'MANAGER') {
        row.managerTotal += 1;
        if (a.status === 'SUBMITTED') row.managerSubmitted += 1;
      }
    }
    if (['RELEASED', 'ACKNOWLEDGED', 'CLOSED'].includes(p.status)) row.released += 1;
    if (['ACKNOWLEDGED', 'CLOSED'].includes(p.status)) row.acknowledged += 1;
    map.set(key, row);
  }

  return {
    rows: [...map.values()].sort((a, b) => b.people - a.people),
    note: `Grouped by the ${dimension === 'manager' ? 'manager of record at launch' : dimension === 'department' ? 'department recorded at launch' : 'job title recorded at launch'}, not by today's organization, so the figures still make sense after a reorganization.`,
  };
}

/** Cycles the actor may report on. */
export async function listReportableCycles(actor: Actor) {
  const scope = reportScope(actor);
  if (scope.kind === 'NONE') return [];
  const ids = scopeIds(scope);
  const cycles = await prisma.reviewCycle.findMany({
    where: {
      orgId: actor.orgId,
      status: { in: ['ACTIVE', 'CLOSED'] },
      ...(ids === null ? {} : { participants: { some: { employeeId: { in: ids } } } }),
    },
    orderBy: { periodEnd: 'desc' },
    select: { id: true, name: true, status: true, periodStart: true, periodEnd: true },
  });
  return cycles;
}

/** Shared helper used by the CSV exports to confirm a participant is in scope. */
export async function assertParticipantsInScope(actor: Actor, cycleId: string): Promise<string[]> {
  const history = await loadManagerHistory(actor.orgId);
  const participants = await prisma.cycleParticipant.findMany({
    where: { cycleId, cycle: { orgId: actor.orgId } },
    select: { id: true, employeeId: true, managerIdSnapshot: true, status: true, snapshotTakenAt: true, cycle: { select: { launchedAt: true } } },
  });
  return participants
    .filter((p) => {
      const at = p.snapshotTakenAt ?? p.cycle.launchedAt ?? new Date();
      return participantAccess(actor, p, history.chainAt(p.employeeId, at)) !== 'NONE';
    })
    .map((p) => p.id);
}

export { safeJsonParse, type ReviewScoreResult };
