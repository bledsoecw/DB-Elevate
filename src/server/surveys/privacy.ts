/**
 * Survey anonymity rules.
 *
 * The promise made to an employee answering an anonymous survey is specific,
 * and it has to be true everywhere — on screen, in a drill-down, and in a CSV
 * export. These pure functions are the single implementation of that promise;
 * the reporting service and the export route both call them, so there is no
 * path that reports numbers the UI would have hidden.
 *
 * The four mechanisms:
 *
 *  1. No identity on the answer. For an ANONYMOUS survey the response row
 *     carries no respondent id at all (enforced in the survey service, not
 *     here), and nothing in the request path logs one.
 *  2. A minimum response count. Nothing is shown until the survey as a whole
 *     has at least `threshold` responses.
 *  3. Small-group suppression. Any segment below `threshold` is withheld.
 *  4. Complement protection. If only one segment in a breakdown were withheld,
 *     its count could be recovered by subtracting the rest from the total, so
 *     the next-smallest segment is withheld as well.
 *
 * Prose version, including the limits of these guarantees: docs/PRIVACY.md.
 */

export const PRIVACY_RULE_VERSION = 'survey-privacy-v1';

export interface SegmentInput {
  key: string;
  label: string;
  n: number;
  /** Any aggregate payload. Dropped entirely when the segment is suppressed. */
  value?: unknown;
}

export interface SegmentResult {
  key: string;
  label: string
  /** Null when suppressed, so a caller cannot accidentally render the count. */
  n: number | null;
  value: unknown;
  suppressed: boolean;
  reason?: 'BELOW_THRESHOLD' | 'COMPLEMENT_PROTECTION';
}

export interface SuppressionOutcome {
  ruleVersion: string;
  threshold: number;
  totalResponses: number;
  /** False when the whole survey is below threshold; `segments` is then empty. */
  reportable: boolean;
  segments: SegmentResult[];
  /** Plain-English note to show beside the results. */
  notice: string | null;
}

export const SUPPRESSED_LABEL = 'Hidden to protect anonymity';

/**
 * Applies the minimum-count and complement rules to one breakdown dimension.
 *
 * `totalResponses` is the survey-wide response count, which gates everything:
 * a breakdown is never shown for a survey that is itself below threshold, even
 * if one segment happens to be large.
 */
export function applySuppression(
  segments: SegmentInput[],
  options: { threshold: number; totalResponses: number; suppressComplement?: boolean },
): SuppressionOutcome {
  const threshold = Math.max(1, Math.floor(options.threshold));
  const suppressComplement = options.suppressComplement !== false;
  const total = options.totalResponses;

  if (total < threshold) {
    return {
      ruleVersion: PRIVACY_RULE_VERSION,
      threshold,
      totalResponses: total,
      reportable: false,
      segments: [],
      notice: `Results are hidden until at least ${threshold} people have responded. ${total} ${
        total === 1 ? 'response has' : 'responses have'
      } been received so far.`,
    };
  }

  const suppressed = new Set<string>();
  const reasons = new Map<string, SegmentResult['reason']>();

  for (const s of segments) {
    if (s.n < threshold) {
      suppressed.add(s.key);
      reasons.set(s.key, 'BELOW_THRESHOLD');
    }
  }

  if (suppressComplement && suppressed.size === 1) {
    // Exactly one hidden segment is recoverable by subtraction. Hide the
    // smallest remaining segment too, so at least two are unknown.
    const visible = segments
      .filter((s) => !suppressed.has(s.key))
      .sort((a, b) => a.n - b.n);
    if (visible.length > 0) {
      const victim = visible[0]!;
      suppressed.add(victim.key);
      reasons.set(victim.key, 'COMPLEMENT_PROTECTION');
    }
  }

  // If hiding leaves a single visible segment it carries the whole remainder,
  // which is itself a near-identification. Hide the breakdown entirely.
  const visibleCount = segments.length - suppressed.size;
  const hideAll = segments.length > 1 && visibleCount === 1 && suppressed.size > 0;

  const results: SegmentResult[] = segments.map((s) => {
    const isSuppressed = hideAll || suppressed.has(s.key);
    return {
      key: s.key,
      label: s.label,
      n: isSuppressed ? null : s.n,
      value: isSuppressed ? null : (s.value ?? null),
      suppressed: isSuppressed,
      reason: isSuppressed ? (reasons.get(s.key) ?? 'COMPLEMENT_PROTECTION') : undefined,
    };
  });

  const hiddenCount = results.filter((r) => r.suppressed).length;
  const notice =
    hiddenCount > 0
      ? `${hiddenCount} ${hiddenCount === 1 ? 'group is' : 'groups are'} hidden because they have fewer than ${threshold} responses, or because showing them would let a hidden group be worked out by subtraction.`
      : null;

  return {
    ruleVersion: PRIVACY_RULE_VERSION,
    threshold,
    totalResponses: total,
    reportable: true,
    segments: results,
    notice,
  };
}

/**
 * Whether a *filtered* view of an anonymous survey may be shown at all.
 *
 * Cross-tabulating two dimensions (department AND tenure, say) narrows a group
 * far faster than either filter alone, so for an anonymous survey only one
 * dimension may be filtered at a time, and the resulting group must still meet
 * the threshold.
 */
export function canShowFilteredResults(params: {
  mode: string;
  activeFilterCount: number;
  filteredResponseCount: number;
  threshold: number;
}): { allowed: boolean; reason?: string } {
  if (params.mode !== 'ANONYMOUS') return { allowed: true };

  if (params.activeFilterCount > 1) {
    return {
      allowed: false,
      reason:
        'Anonymous survey results can be filtered on one dimension at a time. Combining filters could narrow the group enough to identify individual respondents.',
    };
  }
  if (params.filteredResponseCount < params.threshold) {
    return {
      allowed: false,
      reason: `This group has ${params.filteredResponseCount} ${
        params.filteredResponseCount === 1 ? 'response' : 'responses'
      }, below the minimum of ${params.threshold} needed to show results.`,
    };
  }
  return { allowed: true };
}

/**
 * Written answers to an anonymous survey are the easiest thing to deanonymize,
 * because wording identifies people. They are shown only when the survey as a
 * whole meets the threshold, only with no filter applied, and in a shuffled
 * order so position cannot be matched against the participation list.
 */
export function canShowVerbatims(params: {
  mode: string;
  activeFilterCount: number;
  totalResponses: number;
  threshold: number;
}): { allowed: boolean; reason?: string } {
  if (params.mode !== 'ANONYMOUS') return { allowed: true };
  if (params.totalResponses < params.threshold) {
    return {
      allowed: false,
      reason: `Written answers are hidden until at least ${params.threshold} people have responded.`,
    };
  }
  if (params.activeFilterCount > 0) {
    return {
      allowed: false,
      reason:
        'Written answers from an anonymous survey are only shown unfiltered. Filtering them by group could identify who wrote them.',
    };
  }
  return { allowed: true };
}

/** Deterministic shuffle so a page reload does not reveal ordering by chance. */
export function stableShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** eNPS: promoters (9-10) minus detractors (0-6), as a percentage. */
export function computeEnps(scores: number[]): {
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  n: number;
} {
  const valid = scores.filter((s) => Number.isFinite(s) && s >= 0 && s <= 10);
  if (valid.length === 0) {
    return { score: null, promoters: 0, passives: 0, detractors: 0, n: 0 };
  }
  const promoters = valid.filter((s) => s >= 9).length;
  const detractors = valid.filter((s) => s <= 6).length;
  const passives = valid.length - promoters - detractors;
  const score = Math.round(((promoters - detractors) / valid.length) * 100);
  return { score, promoters, passives, detractors, n: valid.length };
}

/** Tenure band from a hire date. Coarse by design — bands, never exact dates. */
export function tenureBand(hireDate: Date | null | undefined, now = new Date()): string {
  if (!hireDate) return 'Unknown';
  const months = (now.getTime() - hireDate.getTime()) / (30.44 * 86_400_000);
  if (months < 6) return '< 6 months';
  if (months < 12) return '6-12 months';
  if (months < 36) return '1-3 years';
  if (months < 60) return '3-5 years';
  return '5+ years';
}
