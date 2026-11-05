import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { collectManagerChain, loadReportingGraph } from '../authz/actor';
import { canViewEmployeePerformanceRecord } from '../authz/policy';
import { ForbiddenError, NotFoundError } from '../errors';
import { normalizeRating } from '../scoring/review-score';
import { COMPETENCY_LEVELS } from '@/lib/enums';

/**
 * The employee-facing side of competencies.
 *
 * The admin catalogue (competencies, behavioural descriptors by level,
 * libraries attached to job titles) already exists in catalog.ts. This is what
 * a person and their manager actually read: which competencies the role is
 * assessed on, what good looks like at their level, and how they have been
 * rated over time.
 *
 * Two rules decide what appears:
 *
 *  1. **Only released reviews contribute a rating.** A competency score is
 *     review content, so it follows the same rule as the review it came from —
 *     an employee does not learn their rating early by visiting a different
 *     screen, and a draft never contributes.
 *
 *  2. **Access follows the performance record, not the directory.** Seeing
 *     that someone exists is not the same as seeing how they were rated.
 */

/** A rating normalized to 0–100 alongside the raw value, so both can be shown. */
export interface CompetencyRating {
  cycleId: string;
  cycleName: string;
  periodEnd: Date;
  releasedAt: Date | null;
  reviewerKind: string;
  /** Raw value on the scale the reviewer actually used. */
  rawValue: number;
  rawLabel: string | null;
  scaleName: string;
  scaleMin: number;
  scaleMax: number;
  /** 0–100, for comparing across scales. Null when the scale cannot be normalized. */
  normalized: number | null;
}

export interface CompetencyProfileItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  active: boolean;
  /** Whether the role's library expects this competency. */
  expectedForRole: boolean;
  /** What good looks like at this person's own level, when defined. */
  levelDescriptor: string | null;
  /** Every defined rung, so a person can see where the role leads. */
  ladder: { level: string; descriptor: string; isMine: boolean }[];
  ratings: CompetencyRating[];
  latest: CompetencyRating | null;
  /** Change in normalized score from the previous rating; null when there is no previous. */
  movement: number | null;
}

export async function getCompetencyProfile(actor: Actor, employeeId: string) {
  if (!canViewEmployeePerformanceRecord(actor, employeeId)) {
    // 404 rather than 403 — how someone was rated is not information to
    // confirm the existence of.
    throw new NotFoundError();
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: actor.orgId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      jobTitle: {
        select: {
          id: true,
          name: true,
          level: true,
          competencyLibrary: {
            select: {
              id: true,
              name: true,
              description: true,
              items: {
                orderBy: { sortOrder: 'asc' },
                select: { competencyId: true, weight: true },
              },
            },
          },
        },
      },
      department: { select: { name: true } },
    },
  });
  if (!employee) throw new NotFoundError();

  const library = employee.jobTitle?.competencyLibrary ?? null;
  const expectedIds = new Set((library?.items ?? []).map((i) => i.competencyId));

  // Ratings come only from released participations. `releasedAt` being set is
  // the gate, not the participant status string, because that is the field the
  // release step actually writes.
  const responses = await prisma.reviewResponse.findMany({
    where: {
      notApplicable: false,
      numericValue: { not: null },
      question: { competencyId: { not: null } },
      assignment: {
        status: 'SUBMITTED',
        participant: {
          employeeId,
          releasedAt: { not: null },
          cycle: { orgId: actor.orgId },
        },
      },
    },
    select: {
      numericValue: true,
      question: {
        select: {
          competencyId: true,
          ratingScale: {
            select: { name: true, levels: { select: { value: true, label: true } } },
          },
        },
      },
      assignment: {
        select: {
          kind: true,
          participant: {
            select: {
              releasedAt: true,
              cycle: { select: { id: true, name: true, periodEnd: true } },
            },
          },
        },
      },
    },
  });

  const byCompetency = new Map<string, CompetencyRating[]>();
  for (const r of responses) {
    const competencyId = r.question.competencyId;
    const scale = r.question.ratingScale;
    if (!competencyId || !scale || r.numericValue === null) continue;

    const values = scale.levels.map((l) => l.value).filter((v) => Number.isFinite(v));
    if (values.length === 0) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);

    const rating: CompetencyRating = {
      cycleId: r.assignment.participant.cycle.id,
      cycleName: r.assignment.participant.cycle.name,
      periodEnd: r.assignment.participant.cycle.periodEnd,
      releasedAt: r.assignment.participant.releasedAt,
      reviewerKind: r.assignment.kind,
      rawValue: r.numericValue,
      rawLabel: scale.levels.find((l) => l.value === r.numericValue)?.label ?? null,
      scaleName: scale.name,
      scaleMin: min,
      scaleMax: max,
      normalized: normalizeRating(r.numericValue, min, max),
    };
    const list = byCompetency.get(competencyId) ?? [];
    list.push(rating);
    byCompetency.set(competencyId, list);
  }

  // Everything the role expects, plus anything they have actually been rated
  // on — a competency dropped from the library should not erase its history.
  const relevantIds = new Set<string>([...expectedIds, ...byCompetency.keys()]);
  if (relevantIds.size === 0) {
    return { employee, library, items: [] as CompetencyProfileItem[], level: employee.jobTitle?.level ?? null };
  }

  const competencies = await prisma.competency.findMany({
    where: { id: { in: [...relevantIds] }, orgId: actor.orgId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { behaviors: { orderBy: { sortOrder: 'asc' } } },
  });

  const myLevel = employee.jobTitle?.level ?? null;

  const items: CompetencyProfileItem[] = competencies.map((c) => {
    const ratings = (byCompetency.get(c.id) ?? []).sort(
      (a, b) => a.periodEnd.getTime() - b.periodEnd.getTime(),
    );
    const latest = ratings.length > 0 ? (ratings[ratings.length - 1] as CompetencyRating) : null;
    const previous = ratings.length > 1 ? (ratings[ratings.length - 2] as CompetencyRating) : null;

    // Movement is only meaningful between two normalized figures; a change of
    // rating scale between cycles makes the comparison meaningless, so it is
    // withheld rather than shown as a misleading delta.
    const comparable =
      latest !== null &&
      previous !== null &&
      latest.normalized !== null &&
      previous.normalized !== null &&
      latest.scaleName === previous.scaleName;

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      active: c.active,
      expectedForRole: expectedIds.has(c.id),
      levelDescriptor:
        myLevel !== null
          ? (c.behaviors.find((b) => b.level === myLevel)?.descriptor ?? null)
          : null,
      ladder: COMPETENCY_LEVELS.filter((level) => c.behaviors.some((b) => b.level === level)).map(
        (level) => ({
          level,
          descriptor: c.behaviors.find((b) => b.level === level)?.descriptor ?? '',
          isMine: level === myLevel,
        }),
      ),
      ratings,
      latest,
      movement:
        comparable && latest?.normalized != null && previous?.normalized != null
          ? Math.round((latest.normalized - previous.normalized) * 10) / 10
          : null,
    };
  });

  return { employee, library, items, level: myLevel };
}

/**
 * The team matrix: one row per person, one column per competency, each cell
 * the most recent released rating.
 *
 * Deliberately shows the raw value and its scale rather than only a
 * normalized number. A 3 means something to the manager who gave it; "60" does
 * not, and pooling two different scales into one column would be the kind of
 * tidy-looking comparison that is quietly wrong.
 */
export async function getTeamCompetencyMatrix(actor: Actor, scope: 'team' | 'org' = 'team') {
  if (!actor.employeeId && !actor.isHrAdmin) throw new ForbiddenError();

  const wantsOrg = scope === 'org';
  if (wantsOrg && !actor.isHrAdmin && !actor.isLeadership) {
    throw new ForbiddenError('Organization-wide competency reporting is for HR and leadership.');
  }

  const employeeIds = wantsOrg
    ? undefined
    : [...new Set(actor.descendantIds)].filter((id) => id !== actor.employeeId);

  if (!wantsOrg && (!employeeIds || employeeIds.length === 0)) {
    return { people: [], competencies: [], cells: new Map<string, CompetencyRating>() };
  }

  const people = await prisma.employee.findMany({
    where: {
      orgId: actor.orgId,
      employmentStatus: { not: 'terminated' },
      ...(employeeIds ? { id: { in: employeeIds } } : {}),
    },
    orderBy: [{ lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      jobTitle: { select: { name: true, level: true } },
    },
  });

  const responses = await prisma.reviewResponse.findMany({
    where: {
      notApplicable: false,
      numericValue: { not: null },
      question: { competencyId: { not: null } },
      assignment: {
        status: 'SUBMITTED',
        kind: 'MANAGER',
        participant: {
          employeeId: { in: people.map((p) => p.id) },
          releasedAt: { not: null },
          cycle: { orgId: actor.orgId },
        },
      },
    },
    select: {
      numericValue: true,
      question: {
        select: {
          competencyId: true,
          competency: { select: { id: true, name: true, category: true } },
          ratingScale: { select: { name: true, levels: { select: { value: true, label: true } } } },
        },
      },
      assignment: {
        select: {
          kind: true,
          participant: {
            select: {
              employeeId: true,
              releasedAt: true,
              cycle: { select: { id: true, name: true, periodEnd: true } },
            },
          },
        },
      },
    },
  });

  const competencyMap = new Map<string, { id: string; name: string; category: string | null }>();
  const cells = new Map<string, CompetencyRating>();

  for (const r of responses) {
    const c = r.question.competency;
    const scale = r.question.ratingScale;
    if (!c || !scale || r.numericValue === null) continue;
    competencyMap.set(c.id, { id: c.id, name: c.name, category: c.category });

    const values = scale.levels.map((l) => l.value).filter((v) => Number.isFinite(v));
    if (values.length === 0) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const key = `${r.assignment.participant.employeeId}::${c.id}`;
    const candidate: CompetencyRating = {
      cycleId: r.assignment.participant.cycle.id,
      cycleName: r.assignment.participant.cycle.name,
      periodEnd: r.assignment.participant.cycle.periodEnd,
      releasedAt: r.assignment.participant.releasedAt,
      reviewerKind: r.assignment.kind,
      rawValue: r.numericValue,
      rawLabel: scale.levels.find((l) => l.value === r.numericValue)?.label ?? null,
      scaleName: scale.name,
      scaleMin: min,
      scaleMax: max,
      normalized: normalizeRating(r.numericValue, min, max),
    };
    // Keep the most recent period per person and competency.
    const existing = cells.get(key);
    if (!existing || candidate.periodEnd > existing.periodEnd) cells.set(key, candidate);
  }

  const competencies = [...competencyMap.values()].sort(
    (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name),
  );

  return { people, competencies, cells };
}

/** People whose competency profile the actor may open, for the picker. */
export async function competencySubjects(actor: Actor) {
  const ids = new Set<string>();
  if (actor.employeeId) ids.add(actor.employeeId);
  for (const id of actor.descendantIds) ids.add(id);

  const employees = await prisma.employee.findMany({
    where: {
      orgId: actor.orgId,
      employmentStatus: { not: 'terminated' },
      ...(actor.isHrAdmin ? {} : { id: { in: [...ids] } }),
    },
    orderBy: [{ lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: { select: { name: true } } },
  });
  return employees;
}

/** Kept for symmetry with other services that need the subject's chain. */
export async function managerChainOf(orgId: string, employeeId: string): Promise<string[]> {
  const { managerOf } = await loadReportingGraph(orgId);
  return collectManagerChain(employeeId, managerOf);
}
