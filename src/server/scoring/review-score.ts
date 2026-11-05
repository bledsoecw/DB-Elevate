/**
 * Review scoring.
 *
 * The rules are deliberately explicit and side-effect free so they can be
 * verified against hand calculations (tests/unit/review-score.test.ts) and so a
 * score shown to an employee can always be explained line by line.
 *
 * Prose version: docs/SCORING.md. The two must agree.
 *
 * Key principle: *missing information is not a zero*. A question that was not
 * answered, or was marked "not applicable", is excluded from both the numerator
 * and the denominator, and the share of weight that was excluded is reported so
 * a reader can judge how complete the score is.
 */

export const SCORING_RULE_VERSION = 'score-v1';

export type ExclusionReason =
  | 'NOT_APPLICABLE'
  | 'UNANSWERED'
  | 'NOT_SCOREABLE'
  | 'NO_SCALE'
  | 'SCALE_NOT_NUMERIC'
  | 'DEGENERATE_SCALE';

export interface ScoringScale {
  id: string;
  name: string;
  numeric: boolean;
  /** Numeric anchors, in any order. */
  levels: { value: number; label: string }[];
}

export interface ScoringQuestion {
  id: string;
  type: string;
  prompt: string;
  weight: number;
  required: boolean;
  scale?: ScoringScale | null;
  /** Discriminator for questions repeated per goal/competency. */
  subjectKey?: string;
  subjectLabel?: string;
}

export interface ScoringSection {
  id: string;
  title: string;
  weight: number;
  questions: ScoringQuestion[];
}

export interface ScoringAnswer {
  questionId: string;
  subjectKey?: string;
  numericValue?: number | null;
  notApplicable?: boolean;
  answered: boolean;
}

export interface QuestionScore {
  questionId: string;
  subjectKey: string;
  prompt: string;
  subjectLabel?: string;
  weight: number;
  included: boolean;
  exclusionReason?: ExclusionReason;
  /** The raw value the reviewer picked, e.g. 4 on a 1-5 scale. */
  rawValue?: number;
  rawLabel?: string;
  scaleMin?: number;
  scaleMax?: number;
  /** Raw value mapped onto 0-100. */
  normalized?: number;
}

export interface SectionScore {
  sectionId: string;
  title: string;
  weight: number;
  /** 0-100, or null when nothing in the section could be scored. */
  score: number | null;
  includedWeight: number;
  totalScoreableWeight: number;
  /** Share of scoreable weight that produced a value, 0-1. */
  coverage: number;
  questions: QuestionScore[];
}

export interface ReviewScoreResult {
  ruleVersion: string;
  /** 0-100, or null when no section could be scored. */
  score: number | null;
  sections: SectionScore[];
  includedQuestionCount: number;
  excludedQuestionCount: number;
  /** Share of total section weight that contributed, 0-1. */
  coverage: number;
  /** True when at least one required scoreable question was left unanswered. */
  hasUnansweredRequired: boolean;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const SCOREABLE_TYPES = new Set(['RATING', 'COMPETENCY_RATING']);

function answerKey(questionId: string, subjectKey: string | undefined): string {
  return `${questionId}::${subjectKey ?? ''}`;
}

/**
 * Maps a raw rating onto 0-100 using the scale's own minimum and maximum
 * anchors. A 3 on a 1-5 scale is 50; a 3 on a 1-3 scale is 100. This is why
 * reports must never pool two different scales — see `docs/SCORING.md`.
 */
export function normalizeRating(raw: number, min: number, max: number): number | null {
  if (!Number.isFinite(raw) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max === min) return null;
  const clamped = Math.min(Math.max(raw, min), max);
  return ((clamped - min) / (max - min)) * 100;
}

export function scoreReview(
  sections: ScoringSection[],
  answers: ScoringAnswer[],
): ReviewScoreResult {
  const byKey = new Map<string, ScoringAnswer>();
  for (const a of answers) byKey.set(answerKey(a.questionId, a.subjectKey), a);

  const sectionScores: SectionScore[] = [];
  let includedQuestionCount = 0;
  let excludedQuestionCount = 0;
  let hasUnansweredRequired = false;

  for (const section of sections) {
    const questionScores: QuestionScore[] = [];
    let weightedSum = 0;
    let includedWeight = 0;
    let totalScoreableWeight = 0;

    for (const q of section.questions) {
      const weight = Number.isFinite(q.weight) && q.weight > 0 ? q.weight : 0;
      const base: QuestionScore = {
        questionId: q.id,
        subjectKey: q.subjectKey ?? '',
        prompt: q.prompt,
        subjectLabel: q.subjectLabel,
        weight,
        included: false,
      };

      if (!SCOREABLE_TYPES.has(q.type)) {
        // Written answers and multiple choice carry meaning but no number.
        questionScores.push({ ...base, exclusionReason: 'NOT_SCOREABLE' });
        continue;
      }

      totalScoreableWeight += weight;

      if (!q.scale) {
        questionScores.push({ ...base, exclusionReason: 'NO_SCALE' });
        excludedQuestionCount += 1;
        continue;
      }
      if (!q.scale.numeric) {
        questionScores.push({ ...base, exclusionReason: 'SCALE_NOT_NUMERIC' });
        excludedQuestionCount += 1;
        continue;
      }

      const values = q.scale.levels.map((l) => l.value).filter((v) => Number.isFinite(v));
      if (values.length === 0) {
        questionScores.push({ ...base, exclusionReason: 'NO_SCALE' });
        excludedQuestionCount += 1;
        continue;
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (min === max) {
        questionScores.push({
          ...base,
          scaleMin: min,
          scaleMax: max,
          exclusionReason: 'DEGENERATE_SCALE',
        });
        excludedQuestionCount += 1;
        continue;
      }

      const answer = byKey.get(answerKey(q.id, q.subjectKey));

      if (answer?.notApplicable) {
        questionScores.push({
          ...base,
          scaleMin: min,
          scaleMax: max,
          exclusionReason: 'NOT_APPLICABLE',
        });
        excludedQuestionCount += 1;
        continue;
      }

      const raw = answer?.numericValue;
      if (!answer || !answer.answered || raw === null || raw === undefined || !Number.isFinite(raw)) {
        if (q.required) hasUnansweredRequired = true;
        questionScores.push({
          ...base,
          scaleMin: min,
          scaleMax: max,
          exclusionReason: 'UNANSWERED',
        });
        excludedQuestionCount += 1;
        continue;
      }

      const normalized = normalizeRating(raw, min, max);
      if (normalized === null) {
        questionScores.push({
          ...base,
          scaleMin: min,
          scaleMax: max,
          exclusionReason: 'DEGENERATE_SCALE',
        });
        excludedQuestionCount += 1;
        continue;
      }

      const matchedLevel = q.scale.levels.find((l) => l.value === raw);
      questionScores.push({
        ...base,
        included: true,
        rawValue: raw,
        rawLabel: matchedLevel?.label,
        scaleMin: min,
        scaleMax: max,
        normalized: round(normalized),
      });
      includedQuestionCount += 1;
      weightedSum += normalized * weight;
      includedWeight += weight;
    }

    const sectionWeight = Number.isFinite(section.weight) && section.weight > 0 ? section.weight : 0;
    sectionScores.push({
      sectionId: section.id,
      title: section.title,
      weight: sectionWeight,
      score: includedWeight > 0 ? round(weightedSum / includedWeight) : null,
      includedWeight: round(includedWeight, 4),
      totalScoreableWeight: round(totalScoreableWeight, 4),
      coverage: totalScoreableWeight > 0 ? round(includedWeight / totalScoreableWeight, 4) : 0,
      questions: questionScores,
    });
  }

  // Overall: weighted mean across sections that produced a score. Weights are
  // renormalized over the included sections, and the share of total section
  // weight that contributed is reported as `coverage`.
  let overallSum = 0;
  let overallWeight = 0;
  let totalSectionWeight = 0;
  for (const s of sectionScores) {
    if (s.totalScoreableWeight > 0) totalSectionWeight += s.weight;
    if (s.score !== null) {
      overallSum += s.score * s.weight;
      overallWeight += s.weight;
    }
  }

  return {
    ruleVersion: SCORING_RULE_VERSION,
    score: overallWeight > 0 ? round(overallSum / overallWeight) : null,
    sections: sectionScores,
    includedQuestionCount,
    excludedQuestionCount,
    coverage: totalSectionWeight > 0 ? round(overallWeight / totalSectionWeight, 4) : 0,
    hasUnansweredRequired,
  };
}

// ---------------------------------------------------------------------------
// Rolling assignment scores into a participant's final score
// ---------------------------------------------------------------------------

export interface AssignmentScoreInput {
  kind: string;
  status: string;
  score: number | null;
}

export interface FinalScoreResult {
  ruleVersion: string;
  score: number | null;
  components: {
    kind: string;
    weight: number;
    /** Mean of the submitted assignment scores for this reviewer kind. */
    score: number | null;
    contributing: number;
    included: boolean;
    note?: string;
  }[];
  /** Share of configured weight that contributed, 0-1. */
  coverage: number;
  note: string;
}

/**
 * Combines submitted assignment scores into one number using the weights
 * configured on the template version.
 *
 * Only SUBMITTED assignments count. Draft work never reaches a final score.
 * Peer scores are averaged first so that three peers do not outvote one
 * manager. If a weighted component has no submitted scores, its weight is
 * dropped and the remainder renormalized, with `coverage` reporting the gap.
 */
export function computeFinalScore(
  assignments: AssignmentScoreInput[],
  weights: { selfWeight: number; managerWeight: number; peerWeight: number },
): FinalScoreResult {
  const groups: { kind: string; weight: number; matches: string[] }[] = [
    { kind: 'SELF', weight: weights.selfWeight, matches: ['SELF'] },
    { kind: 'MANAGER', weight: weights.managerWeight, matches: ['MANAGER'] },
    { kind: 'PEER', weight: weights.peerWeight, matches: ['PEER', 'SKIP_LEVEL', 'UPWARD'] },
  ];

  const components: FinalScoreResult['components'] = [];
  let sum = 0;
  let usedWeight = 0;
  let configuredWeight = 0;

  for (const group of groups) {
    const weight = Number.isFinite(group.weight) && group.weight > 0 ? group.weight : 0;
    if (weight > 0) configuredWeight += weight;

    const scores = assignments
      .filter((a) => group.matches.includes(a.kind) && a.status === 'SUBMITTED')
      .map((a) => a.score)
      .filter((s): s is number => s !== null && Number.isFinite(s));

    if (weight === 0) {
      components.push({
        kind: group.kind,
        weight: 0,
        score: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        contributing: scores.length,
        included: false,
        note: 'Not weighted in this template.',
      });
      continue;
    }

    if (scores.length === 0) {
      components.push({
        kind: group.kind,
        weight,
        score: null,
        contributing: 0,
        included: false,
        note: 'No submitted, scoreable review of this type.',
      });
      continue;
    }

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    components.push({
      kind: group.kind,
      weight,
      score: round(mean),
      contributing: scores.length,
      included: true,
    });
    sum += mean * weight;
    usedWeight += weight;
  }

  const score = usedWeight > 0 ? round(sum / usedWeight) : null;
  const coverage = configuredWeight > 0 ? round(usedWeight / configuredWeight, 4) : 0;

  let note: string;
  if (score === null) {
    note = 'No score could be calculated: no submitted review contained a rating.';
  } else if (coverage < 1) {
    note = `Calculated from ${Math.round(coverage * 100)}% of the configured weight. Components with no submitted score were excluded and the remaining weights renormalized.`;
  } else {
    note = 'Calculated from all configured review types.';
  }

  return { ruleVersion: SCORING_RULE_VERSION, score, components, coverage, note };
}

/** Maps a 0-100 score back onto a scale's labels, for display only. */
export function describeScoreOnScale(
  score: number | null,
  scale: ScoringScale | null | undefined,
): string | null {
  if (score === null || !scale || scale.levels.length === 0) return null;
  const values = scale.levels.map((l) => l.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return null;
  const raw = min + (score / 100) * (max - min);
  let closest = scale.levels[0]!;
  for (const level of scale.levels) {
    if (Math.abs(level.value - raw) < Math.abs(closest.value - raw)) closest = level;
  }
  return `${round(raw, 1)} of ${max} — closest to "${closest.label}"`;
}
