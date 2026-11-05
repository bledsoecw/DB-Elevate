/**
 * Money and merit arithmetic.
 *
 * Pure functions, no database, so every rule here can be checked against hand
 * calculations. Compensation is the one place in this application where an
 * arithmetic error is somebody's pay packet, so the rules are explicit and
 * tested rather than inferred from how a number happens to render.
 *
 * **Everything is integer minor units.** A salary of $72,500.00 is 7250000.
 * Floating point is not used for money anywhere: 0.1 + 0.2 is famously not 0.3,
 * and a cent lost per row across a merit cycle is a budget that does not
 * reconcile and an employee who was shorted.
 *
 * **Percentages are integer basis points.** 3.25% is 325. Same reason: a
 * merit matrix in decimals accumulates error the moment it is multiplied.
 */

/** 3.25% === 325 basis points. */
export type BasisPoints = number;
/** $72,500.00 === 7250000 minor units. */
export type MinorUnits = number;

export const BASIS_POINTS_PER_PERCENT = 100;
export const BASIS_POINTS_WHOLE = 10_000;

export interface MoneyFormatOptions {
  currency?: string;
  /** Drop the cents, which is how salaries are normally read. */
  whole?: boolean;
  locale?: string;
}

/**
 * Formats minor units for display. Uses Intl so a currency other than USD
 * still renders correctly, and never does its own division-and-round dance.
 */
export function formatMoney(
  minor: MinorUnits | null | undefined,
  options: MoneyFormatOptions = {},
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  const { currency = 'USD', whole = false, locale = 'en-US' } = options;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

/** Formats basis points as a percentage: 325 -> "3.25%". */
export function formatBasisPoints(bp: BasisPoints | null | undefined, places = 2): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return '—';
  const pct = bp / BASIS_POINTS_PER_PERCENT;
  const fixed = pct.toFixed(places);
  // Trim a trailing ".00" so a flat 3% does not read as 3.00%.
  return `${fixed.replace(/\.?0+$/, '')}%`;
}

/**
 * Parses a user-typed percentage into basis points.
 *
 * Returns null for anything that is not a number, so a blank or malformed
 * field is "not decided" rather than silently zero — the same principle as
 * review scoring, where a missing answer is never a zero.
 */
export function parsePercentToBasisPoints(value: string | number | null | undefined): BasisPoints | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[%\s,]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * BASIS_POINTS_PER_PERCENT);
}

/** Parses a user-typed money amount into minor units. */
export function parseMoneyToMinor(value: string | number | null | undefined): MinorUnits | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$\s,]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * The increase implied by a percentage, rounded half-up to the nearest minor
 * unit.
 *
 * Rounding is applied once, here, and the resulting integer is what is stored
 * and what every later total adds up. Deriving the amount again from the
 * percentage at display time would let the row and the budget disagree by a
 * cent, which is exactly the sort of discrepancy nobody can explain later.
 */
export function increaseFromBasisPoints(
  baseMinor: MinorUnits,
  bp: BasisPoints | null,
): MinorUnits | null {
  if (bp === null || !Number.isFinite(bp) || !Number.isFinite(baseMinor)) return null;
  return Math.round((baseMinor * bp) / BASIS_POINTS_WHOLE);
}

/** The percentage an explicit amount represents, in basis points. */
export function basisPointsFromIncrease(
  baseMinor: MinorUnits,
  increaseMinor: MinorUnits | null,
): BasisPoints | null {
  if (increaseMinor === null || !Number.isFinite(increaseMinor)) return null;
  if (!Number.isFinite(baseMinor) || baseMinor <= 0) return null;
  return Math.round((increaseMinor * BASIS_POINTS_WHOLE) / baseMinor);
}

export function newBaseFrom(
  baseMinor: MinorUnits,
  increaseMinor: MinorUnits | null,
): MinorUnits | null {
  if (increaseMinor === null) return null;
  return baseMinor + increaseMinor;
}

// ---------------------------------------------------------------------------
// Merit matrix
// ---------------------------------------------------------------------------

/**
 * Where a salary sits in its band, as a ratio. 1.0 is the midpoint.
 * Null when the range is missing or degenerate — a compa-ratio against an
 * unknown band is a made-up number.
 *
 * The midpoint is the denominator, and an explicitly agreed one is used when
 * there is one. Bands are often deliberately skewed — a target rate of
 * $75,000 inside a $60,000–$95,000 range is not halfway — and taking the
 * halfway point in that case would understate everybody's position in band by
 * a couple of points and quietly shift which matrix row they land in. Halfway
 * is the fallback for a band with no agreed midpoint, not the definition.
 */
export function compaRatio(
  baseMinor: MinorUnits,
  rangeMinMinor: MinorUnits | null,
  rangeMaxMinor: MinorUnits | null,
  rangeMidMinor: MinorUnits | null = null,
): number | null {
  if (rangeMinMinor === null || rangeMaxMinor === null) return null;
  if (!Number.isFinite(rangeMinMinor) || !Number.isFinite(rangeMaxMinor)) return null;
  if (rangeMaxMinor <= rangeMinMinor) return null;

  const usable =
    rangeMidMinor !== null &&
    Number.isFinite(rangeMidMinor) &&
    rangeMidMinor >= rangeMinMinor &&
    rangeMidMinor <= rangeMaxMinor;

  const mid = usable ? (rangeMidMinor as number) : (rangeMinMinor + rangeMaxMinor) / 2;
  if (mid <= 0) return null;
  return Math.round((baseMinor / mid) * 1000) / 1000;
}

/**
 * The midpoint a band actually uses, and whether it was agreed or derived.
 *
 * Shared so a screen never computes the halfway point itself and label it as
 * though it had been set by somebody.
 */
export function bandMidpoint(
  rangeMinMinor: MinorUnits | null,
  rangeMaxMinor: MinorUnits | null,
  rangeMidMinor: MinorUnits | null,
): { minor: MinorUnits; agreed: boolean } | null {
  if (rangeMinMinor === null || rangeMaxMinor === null) return null;
  if (rangeMaxMinor < rangeMinMinor) return null;
  if (
    rangeMidMinor !== null &&
    rangeMidMinor >= rangeMinMinor &&
    rangeMidMinor <= rangeMaxMinor
  ) {
    return { minor: rangeMidMinor, agreed: true };
  }
  return { minor: Math.round((rangeMinMinor + rangeMaxMinor) / 2), agreed: false };
}

export type PerformanceBand = 'OUTSTANDING' | 'EXCEEDS' | 'MEETS' | 'DEVELOPING' | 'BELOW';

export const PERFORMANCE_BANDS: PerformanceBand[] = [
  'OUTSTANDING',
  'EXCEEDS',
  'MEETS',
  'DEVELOPING',
  'BELOW',
];

export const PERFORMANCE_BAND_LABELS: Record<PerformanceBand, string> = {
  OUTSTANDING: 'Outstanding',
  EXCEEDS: 'Exceeds expectations',
  MEETS: 'Meets expectations',
  DEVELOPING: 'Developing',
  BELOW: 'Below expectations',
};

/**
 * Maps a released review score (0–100) onto a band.
 *
 * Returns null for a missing score rather than defaulting to the middle. A
 * person with no released review has not been assessed, and quietly treating
 * that as "meets" would hand them a recommendation nobody stands behind.
 */
export function bandForScore(score: number | null | undefined): PerformanceBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 90) return 'OUTSTANDING';
  if (score >= 78) return 'EXCEEDS';
  if (score >= 60) return 'MEETS';
  if (score >= 45) return 'DEVELOPING';
  return 'BELOW';
}

/** One cell of the matrix: a recommended increase in basis points. */
export interface MeritMatrixCell {
  band: PerformanceBand;
  /** Inclusive lower bound of the compa-ratio bucket. */
  compaFrom: number;
  /** Exclusive upper bound. */
  compaTo: number;
  bp: BasisPoints;
}

/**
 * A default matrix, deliberately conservative.
 *
 * Higher performers get more, and people already paid above their band
 * midpoint get less for the same performance, which is the standard shape:
 * the budget moves people toward where their pay should be as well as
 * rewarding the year. These numbers are a starting point for a human to
 * change, not a policy this application is asserting.
 */
export const DEFAULT_MERIT_MATRIX: MeritMatrixCell[] = [
  { band: 'OUTSTANDING', compaFrom: 0, compaTo: 0.9, bp: 700 },
  { band: 'OUTSTANDING', compaFrom: 0.9, compaTo: 1.1, bp: 550 },
  { band: 'OUTSTANDING', compaFrom: 1.1, compaTo: Infinity, bp: 400 },
  { band: 'EXCEEDS', compaFrom: 0, compaTo: 0.9, bp: 500 },
  { band: 'EXCEEDS', compaFrom: 0.9, compaTo: 1.1, bp: 400 },
  { band: 'EXCEEDS', compaFrom: 1.1, compaTo: Infinity, bp: 275 },
  { band: 'MEETS', compaFrom: 0, compaTo: 0.9, bp: 350 },
  { band: 'MEETS', compaFrom: 0.9, compaTo: 1.1, bp: 275 },
  { band: 'MEETS', compaFrom: 1.1, compaTo: Infinity, bp: 175 },
  { band: 'DEVELOPING', compaFrom: 0, compaTo: 1.1, bp: 150 },
  { band: 'DEVELOPING', compaFrom: 1.1, compaTo: Infinity, bp: 0 },
  { band: 'BELOW', compaFrom: 0, compaTo: Infinity, bp: 0 },
];

export interface Recommendation {
  bp: BasisPoints | null;
  /** Plain-English reason, shown beside the number. */
  explanation: string;
  band: PerformanceBand | null;
  compa: number | null;
}

/**
 * The recommended increase for one person.
 *
 * Always returns an explanation, because a number a manager cannot account
 * for is one they will either rubber-stamp or ignore. A recommendation is
 * never applied automatically — it populates a field a person then edits or
 * accepts, and the decision is what gets stored.
 */
export function recommendIncrease(params: {
  score: number | null;
  baseMinor: MinorUnits;
  rangeMinMinor?: MinorUnits | null;
  rangeMaxMinor?: MinorUnits | null;
  rangeMidMinor?: MinorUnits | null;
  matrix?: MeritMatrixCell[];
}): Recommendation {
  const matrix = params.matrix ?? DEFAULT_MERIT_MATRIX;
  const band = bandForScore(params.score);
  const compa = compaRatio(
    params.baseMinor,
    params.rangeMinMinor ?? null,
    params.rangeMaxMinor ?? null,
    params.rangeMidMinor ?? null,
  );

  if (band === null) {
    return {
      bp: null,
      band: null,
      compa,
      explanation:
        'No released review score, so there is no recommendation. Decide this one on its own merits and record why.',
    };
  }

  // With no salary band we cannot place the person in it, so fall back to the
  // mid compa bucket and say so rather than pretending to a precision we lack.
  const effectiveCompa = compa ?? 1.0;
  const cell = matrix.find(
    (c) => c.band === band && effectiveCompa >= c.compaFrom && effectiveCompa < c.compaTo,
  );

  if (!cell) {
    return {
      bp: null,
      band,
      compa,
      explanation: `No matrix row covers ${PERFORMANCE_BAND_LABELS[band]} at this position in band.`,
    };
  }

  const where =
    compa === null
      ? 'no salary band is configured for this role, so the midpoint was assumed'
      : compa < 0.9
        ? 'paid below the band midpoint'
        : compa < 1.1
          ? 'paid around the band midpoint'
          : 'paid above the band midpoint';

  return {
    bp: cell.bp,
    band,
    compa,
    explanation: `${PERFORMANCE_BAND_LABELS[band]}, ${where}.`,
  };
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetState {
  poolMinor: MinorUnits;
  allocatedMinor: MinorUnits;
  remainingMinor: MinorUnits;
  /** Share of the pool allocated, 0–1. Null when the pool is zero. */
  usedRatio: number | null;
  over: boolean;
  overBy: MinorUnits;
}

/**
 * Budget arithmetic in one place.
 *
 * Being over budget is reported, never silently prevented — a manager part-way
 * through allocating is legitimately over, and blocking the keystroke would
 * force them to plan in a spreadsheet instead. The ceiling is enforced at
 * submission, where it is a decision rather than an obstruction.
 */
export function budgetState(poolMinor: MinorUnits, allocatedMinor: MinorUnits): BudgetState {
  const remaining = poolMinor - allocatedMinor;
  return {
    poolMinor,
    allocatedMinor,
    remainingMinor: remaining,
    usedRatio: poolMinor > 0 ? Math.round((allocatedMinor / poolMinor) * 10000) / 10000 : null,
    over: remaining < 0,
    overBy: remaining < 0 ? -remaining : 0,
  };
}

/** Sums allocations without ever leaving integer arithmetic. */
export function totalAllocated(amounts: (MinorUnits | null | undefined)[]): MinorUnits {
  let total = 0;
  for (const a of amounts) {
    if (a === null || a === undefined || !Number.isFinite(a)) continue;
    total += Math.round(a);
  }
  return total;
}
