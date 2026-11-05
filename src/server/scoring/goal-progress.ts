/**
 * Goal progress.
 *
 * Two numbers are deliberately kept apart:
 *
 *   reported  - what the owner says, typed in by a person.
 *   computed  - what the goal's own measurements imply.
 *
 * They are never silently merged. The UI shows the computed figure as the
 * progress bar where one can be derived, labels it as computed, and shows the
 * reported figure alongside it whenever the two disagree by more than a small
 * margin. For PERCENT goals there is nothing to compute, so the reported figure
 * is the only figure and is labelled as reported.
 *
 * Prose version: docs/SCORING.md ("Goal progress").
 */

export const GOAL_PROGRESS_RULE_VERSION = 'goal-progress-v1';

export type ProgressSource = 'REPORTED' | 'COMPUTED' | 'NONE';

export interface GoalProgressInput {
  measurementType: string;
  startValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  higherIsBetter?: boolean;
  reportedProgressPct?: number | null;
  status?: string;
  milestones?: { completedAt: Date | null; weight: number }[];
}

export interface GoalProgressResult {
  ruleVersion: string;
  /** The figure to display, 0-100, or null when none can be established. */
  displayPct: number | null;
  /** Which of the two the display figure came from. */
  source: ProgressSource;
  computedPct: number | null;
  reportedPct: number | null;
  /** True when both exist and differ by more than 5 points. */
  divergent: boolean;
  /** Plain-English account of how displayPct was arrived at. */
  explanation: string;
}

function clampPct(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 100) * 100) / 100;
}

export function computeGoalProgress(goal: GoalProgressInput): GoalProgressResult {
  const reportedRaw = goal.reportedProgressPct;
  const reportedPct =
    reportedRaw !== null && reportedRaw !== undefined && Number.isFinite(reportedRaw)
      ? clampPct(reportedRaw)
      : null;

  let computedPct: number | null = null;
  let explanation = '';

  switch (goal.measurementType) {
    case 'BINARY': {
      computedPct = goal.status === 'COMPLETED' ? 100 : 0;
      explanation =
        goal.status === 'COMPLETED'
          ? 'Done / not done goal, marked complete.'
          : 'Done / not done goal, not yet complete.';
      break;
    }

    case 'MILESTONE': {
      const milestones = goal.milestones ?? [];
      const usable = milestones.filter((m) => Number.isFinite(m.weight) && m.weight > 0);
      const totalWeight = usable.reduce((sum, m) => sum + m.weight, 0);
      if (totalWeight <= 0) {
        computedPct = null;
        explanation = 'Milestone goal with no milestones yet, so no progress can be calculated.';
      } else {
        const done = usable
          .filter((m) => m.completedAt !== null)
          .reduce((sum, m) => sum + m.weight, 0);
        computedPct = clampPct((done / totalWeight) * 100);
        const doneCount = usable.filter((m) => m.completedAt !== null).length;
        explanation = `${doneCount} of ${usable.length} milestones complete, weighted: ${done} of ${totalWeight}.`;
      }
      break;
    }

    case 'NUMERIC': {
      const start = goal.startValue;
      const target = goal.targetValue;
      const current = goal.currentValue;
      const haveAll =
        [start, target, current].every((v) => v !== null && v !== undefined && Number.isFinite(v));
      if (!haveAll) {
        computedPct = null;
        explanation =
          'Numeric goal is missing a start, target or current value, so no progress can be calculated.';
      } else if (start === target) {
        computedPct = null;
        explanation =
          'Numeric goal has the same start and target value, so progress cannot be expressed as a percentage.';
      } else {
        const s = start as number;
        const t = target as number;
        const c = current as number;
        const fraction = (c - s) / (t - s);
        computedPct = clampPct(fraction * 100);
        const direction = goal.higherIsBetter === false ? 'down to' : 'up to';
        explanation = `Moved from ${s} ${direction} a target of ${t}; currently ${c}. Progress is (current − start) ÷ (target − start), clamped to 0–100%.`;
      }
      break;
    }

    case 'PERCENT':
    default: {
      computedPct = null;
      explanation =
        reportedPct !== null
          ? 'Percent-complete goal: the figure is reported by the goal owner, not calculated.'
          : 'Percent-complete goal with no progress reported yet.';
      break;
    }
  }

  // A completed goal reads as 100% regardless of measurement, so a finished
  // goal never shows a stale partial bar.
  if (goal.status === 'COMPLETED') {
    const source: ProgressSource = computedPct !== null ? 'COMPUTED' : 'REPORTED';
    return {
      ruleVersion: GOAL_PROGRESS_RULE_VERSION,
      displayPct: 100,
      source,
      computedPct: computedPct !== null ? 100 : null,
      reportedPct,
      divergent: false,
      explanation: 'Goal is marked complete, so progress shows as 100%.',
    };
  }

  const displayPct = computedPct !== null ? computedPct : reportedPct;
  const source: ProgressSource =
    computedPct !== null ? 'COMPUTED' : reportedPct !== null ? 'REPORTED' : 'NONE';
  const divergent =
    computedPct !== null && reportedPct !== null && Math.abs(computedPct - reportedPct) > 5;

  return {
    ruleVersion: GOAL_PROGRESS_RULE_VERSION,
    displayPct,
    source,
    computedPct,
    reportedPct,
    divergent,
    explanation,
  };
}

export interface GoalRiskInput {
  status?: string;
  health?: string;
  dueDate?: Date | null;
  now?: Date;
}

export type GoalRisk = 'OVERDUE' | 'BLOCKED' | 'DUE_SOON' | 'OFF_TRACK' | 'AT_RISK' | 'NONE';

/** Single place that decides whether a goal needs attention. */
export function goalRisk(goal: GoalRiskInput): GoalRisk {
  const now = goal.now ?? new Date();
  if (goal.status === 'COMPLETED' || goal.status === 'CANCELLED') return 'NONE';
  if (goal.health === 'BLOCKED') return 'BLOCKED';
  if (goal.dueDate && goal.dueDate.getTime() < now.getTime()) return 'OVERDUE';
  if (goal.health === 'OFF_TRACK') return 'OFF_TRACK';
  if (goal.health === 'AT_RISK') return 'AT_RISK';
  if (goal.dueDate) {
    const days = (goal.dueDate.getTime() - now.getTime()) / 86_400_000;
    if (days <= 14) return 'DUE_SOON';
  }
  return 'NONE';
}
