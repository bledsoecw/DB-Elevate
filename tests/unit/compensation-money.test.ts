import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MERIT_MATRIX,
  bandForScore,
  basisPointsFromIncrease,
  budgetState,
  bandMidpoint,
  compaRatio,
  formatBasisPoints,
  formatMoney,
  increaseFromBasisPoints,
  newBaseFrom,
  parseMoneyToMinor,
  parsePercentToBasisPoints,
  recommendIncrease,
  totalAllocated,
} from '@/lib/money';

/**
 * Compensation arithmetic.
 *
 * This is the one module in the application where a rounding error is
 * somebody's pay. The tests therefore assert exact integers, not approximate
 * equality, and cover the cases that actually bite: a half-cent, a missing
 * performance score, a zero budget, and a salary with no band configured.
 */

describe('money representation', () => {
  it('keeps everything in integer minor units', () => {
    expect(parseMoneyToMinor('72500')).toBe(7_250_000);
    expect(parseMoneyToMinor('$72,500.00')).toBe(7_250_000);
    expect(parseMoneyToMinor('72500.55')).toBe(7_250_055);
    expect(parseMoneyToMinor(' 1,234.56 ')).toBe(123_456);
  });

  it('treats a blank or malformed amount as undecided, not zero', () => {
    // The same principle as review scoring: missing is not the same as nil.
    expect(parseMoneyToMinor('')).toBeNull();
    expect(parseMoneyToMinor(null)).toBeNull();
    expect(parseMoneyToMinor(undefined)).toBeNull();
    expect(parseMoneyToMinor('not a number')).toBeNull();
  });

  it('formats minor units without floating-point drift', () => {
    expect(formatMoney(7_250_000)).toBe('$72,500.00');
    expect(formatMoney(7_250_000, { whole: true })).toBe('$72,500');
    expect(formatMoney(123_456)).toBe('$1,234.56');
    expect(formatMoney(null)).toBe('—');
  });

  it('survives the classic float case exactly', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in minor units it is just 10 + 20.
    expect(totalAllocated([10, 20])).toBe(30);
    const cents = Array.from({ length: 1000 }, () => 1);
    expect(totalAllocated(cents)).toBe(1000);
  });
});

describe('percentages as basis points', () => {
  it('parses and formats without losing precision', () => {
    expect(parsePercentToBasisPoints('3.25')).toBe(325);
    expect(parsePercentToBasisPoints('3.25%')).toBe(325);
    expect(parsePercentToBasisPoints(0)).toBe(0);
    expect(formatBasisPoints(325)).toBe('3.25%');
    expect(formatBasisPoints(300)).toBe('3%');
    expect(formatBasisPoints(0)).toBe('0%');
  });

  it('distinguishes zero from undecided', () => {
    // A 0% increase is a real decision. A blank field is not.
    expect(parsePercentToBasisPoints(0)).toBe(0);
    expect(parsePercentToBasisPoints('')).toBeNull();
    expect(parsePercentToBasisPoints(null)).toBeNull();
  });
});

describe('increase arithmetic', () => {
  it('computes an increase and rounds half-up, once', () => {
    // $72,500 at 3.25% = $2,356.25 exactly.
    expect(increaseFromBasisPoints(7_250_000, 325)).toBe(235_625);
    expect(newBaseFrom(7_250_000, 235_625)).toBe(7_485_625);
  });

  it('rounds a half-cent deterministically rather than drifting', () => {
    // $1,000.01 at 1% is 1000.01 minor units -> rounds to 1000.
    expect(increaseFromBasisPoints(100_001, 100)).toBe(1000);
    // $333.33 at 3.33% = 1109.98... -> 1110
    expect(increaseFromBasisPoints(33_333, 333)).toBe(1110);
  });

  it('round-trips a percentage and an amount consistently', () => {
    const base = 6_600_000;
    const bp = 1082;
    const amount = increaseFromBasisPoints(base, bp);
    expect(amount).toBe(714_120);
    // Back again lands on the same basis points.
    expect(basisPointsFromIncrease(base, amount)).toBe(bp);
  });

  it('returns null rather than zero for an undecided increase', () => {
    expect(increaseFromBasisPoints(7_250_000, null)).toBeNull();
    expect(newBaseFrom(7_250_000, null)).toBeNull();
    expect(basisPointsFromIncrease(7_250_000, null)).toBeNull();
  });

  it('refuses to compute a percentage against a zero base', () => {
    expect(basisPointsFromIncrease(0, 1000)).toBeNull();
  });
});

describe('compa-ratio', () => {
  it('places a salary against its band midpoint', () => {
    // Band 60k-90k, midpoint 75k. A 75k salary is exactly 1.0.
    expect(compaRatio(7_500_000, 6_000_000, 9_000_000)).toBe(1);
    expect(compaRatio(6_000_000, 6_000_000, 9_000_000)).toBe(0.8);
    expect(compaRatio(9_000_000, 6_000_000, 9_000_000)).toBe(1.2);
  });

  it('is null when the band is missing or degenerate', () => {
    // A compa-ratio against an unknown band is a made-up number.
    expect(compaRatio(7_500_000, null, 9_000_000)).toBeNull();
    expect(compaRatio(7_500_000, 6_000_000, null)).toBeNull();
    expect(compaRatio(7_500_000, 9_000_000, 9_000_000)).toBeNull();
    expect(compaRatio(7_500_000, 9_000_000, 6_000_000)).toBeNull();
  });
});

describe('performance bands', () => {
  it('maps scores onto bands at the stated boundaries', () => {
    expect(bandForScore(95)).toBe('OUTSTANDING');
    expect(bandForScore(90)).toBe('OUTSTANDING');
    expect(bandForScore(89.9)).toBe('EXCEEDS');
    expect(bandForScore(78)).toBe('EXCEEDS');
    expect(bandForScore(60)).toBe('MEETS');
    expect(bandForScore(45)).toBe('DEVELOPING');
    expect(bandForScore(44)).toBe('BELOW');
    expect(bandForScore(0)).toBe('BELOW');
  });

  it('returns null for a missing score instead of defaulting to the middle', () => {
    // Someone with no released review has not been assessed. Treating that as
    // "meets" would hand them a recommendation nobody stands behind.
    expect(bandForScore(null)).toBeNull();
    expect(bandForScore(undefined)).toBeNull();
    expect(bandForScore(Number.NaN)).toBeNull();
  });
});

describe('merit recommendation', () => {
  it('recommends more for a high performer paid below midpoint', () => {
    const r = recommendIncrease({
      score: 94,
      baseMinor: 6_000_000,
      rangeMinMinor: 6_000_000,
      rangeMaxMinor: 9_000_000,
    });
    expect(r.band).toBe('OUTSTANDING');
    expect(r.compa).toBe(0.8);
    expect(r.bp).toBe(700);
    expect(r.explanation).toMatch(/below the band midpoint/i);
  });

  it('recommends less for the same performance paid above midpoint', () => {
    const low = recommendIncrease({
      score: 94, baseMinor: 6_000_000, rangeMinMinor: 6_000_000, rangeMaxMinor: 9_000_000,
    });
    const high = recommendIncrease({
      score: 94, baseMinor: 9_000_000, rangeMinMinor: 6_000_000, rangeMaxMinor: 9_000_000,
    });
    expect(high.bp).toBeLessThan(low.bp as number);
    expect(high.explanation).toMatch(/above the band midpoint/i);
  });

  it('gives no recommendation at all without a released score', () => {
    const r = recommendIncrease({ score: null, baseMinor: 7_000_000 });
    expect(r.bp).toBeNull();
    expect(r.band).toBeNull();
    expect(r.explanation).toMatch(/no released review score/i);
    expect(r.explanation).toMatch(/record why/i);
  });

  it('says so when no salary band is configured rather than inventing precision', () => {
    const r = recommendIncrease({ score: 70, baseMinor: 7_000_000 });
    expect(r.compa).toBeNull();
    expect(r.bp).toBe(275); // mid bucket assumed
    expect(r.explanation).toMatch(/no salary band is configured/i);
  });

  it('always returns an explanation a manager could repeat out loud', () => {
    for (const score of [95, 80, 65, 50, 20, null]) {
      const r = recommendIncrease({ score, baseMinor: 7_000_000 });
      expect(r.explanation.length).toBeGreaterThan(20);
    }
  });

  it('never recommends an increase for the lowest band', () => {
    const r = recommendIncrease({ score: 10, baseMinor: 7_000_000 });
    expect(r.band).toBe('BELOW');
    expect(r.bp).toBe(0);
  });

  it('has a matrix row for every band', () => {
    for (const band of ['OUTSTANDING', 'EXCEEDS', 'MEETS', 'DEVELOPING', 'BELOW'] as const) {
      expect(DEFAULT_MERIT_MATRIX.some((c) => c.band === band)).toBe(true);
    }
  });
});

describe('budgets', () => {
  it('reports usage against the pool', () => {
    const s = budgetState(4_445_646, 4_445_642);
    expect(s.remainingMinor).toBe(4);
    expect(s.over).toBe(false);
    expect(s.usedRatio).toBeCloseTo(1, 4);
  });

  it('reports being over budget rather than clamping it', () => {
    // A manager part-way through allocating is legitimately over; the ceiling
    // is enforced at submission, where it is a decision not an obstruction.
    const s = budgetState(1_000_000, 1_250_000);
    expect(s.over).toBe(true);
    expect(s.overBy).toBe(250_000);
    expect(s.remainingMinor).toBe(-250_000);
  });

  it('does not divide by a zero pool', () => {
    const s = budgetState(0, 0);
    expect(s.usedRatio).toBeNull();
    expect(s.over).toBe(false);
  });

  it('ignores undecided allocations when totalling', () => {
    expect(totalAllocated([100_000, null, 50_000, undefined])).toBe(150_000);
  });
});

describe('an agreed band midpoint', () => {
  // A band skewed on purpose: the target rate for the role is $75,000 inside a
  // $60,000–$95,000 range. Halfway is $77,500, which is not the agreed
  // reference, and using it would understate everybody's position in band.
  const MIN = 6_000_000;
  const MID = 7_500_000;
  const MAX = 9_500_000;
  const HALFWAY = 7_750_000;

  it('is the denominator of the compa-ratio when one is agreed', () => {
    expect(compaRatio(MID, MIN, MAX, MID)).toBe(1);
    expect(compaRatio(6_700_000, MIN, MAX, MID)).toBe(0.893);
  });

  it('falls back to halfway when no midpoint is agreed', () => {
    expect(compaRatio(HALFWAY, MIN, MAX, null)).toBe(1);
    expect(compaRatio(MID, MIN, MAX, null)).toBe(0.968);
    expect(compaRatio(6_700_000, MIN, MAX, null)).toBe(0.865);
  });

  it('treats a midpoint outside its own band as absent, not as agreed', () => {
    // Nonsense input must not silently become the denominator.
    expect(compaRatio(HALFWAY, MIN, MAX, 100)).toBe(1);
    expect(compaRatio(HALFWAY, MIN, MAX, 99_999_999)).toBe(1);
  });

  it('changes which matrix row a person lands in', () => {
    // $70,000 against a target rate of $80,000 is 0.875 — below the 0.9
    // boundary, so the 350bp row. Measured against halfway ($77,500) the same
    // person is 0.903, which is the 275bp row. The agreed midpoint is the
    // difference between a 3.5% and a 2.75% suggestion.
    const agreed = recommendIncrease({
      score: 70,
      baseMinor: 7_000_000,
      rangeMinMinor: MIN,
      rangeMaxMinor: MAX,
      rangeMidMinor: 8_000_000,
    });
    const halfway = recommendIncrease({
      score: 70,
      baseMinor: 7_000_000,
      rangeMinMinor: MIN,
      rangeMaxMinor: MAX,
    });

    expect(agreed.band).toBe('MEETS');
    expect(agreed.compa).toBe(0.875);
    expect(agreed.bp).toBe(350);

    expect(halfway.band).toBe('MEETS');
    expect(halfway.compa).toBe(0.903);
    expect(halfway.bp).toBe(275);
  });

  it('still reports no recommendation without a score, midpoint or not', () => {
    const rec = recommendIncrease({
      score: null,
      baseMinor: 7_000_000,
      rangeMinMinor: MIN,
      rangeMaxMinor: MAX,
      rangeMidMinor: MID,
    });
    expect(rec.bp).toBe(null);
    expect(rec.band).toBe(null);
    // The position in band is still reported — it is known, the score is not.
    expect(rec.compa).toBe(0.933);
  });

  it('reports whether a midpoint was agreed or derived', () => {
    expect(bandMidpoint(MIN, MAX, MID)).toEqual({ minor: MID, agreed: true });
    expect(bandMidpoint(MIN, MAX, null)).toEqual({ minor: HALFWAY, agreed: false });
    // Out of range is derived, not agreed, so a screen cannot label it as set.
    expect(bandMidpoint(MIN, MAX, 100)).toEqual({ minor: HALFWAY, agreed: false });
    expect(bandMidpoint(MIN, MAX, 99_999_999)).toEqual({ minor: HALFWAY, agreed: false });
    expect(bandMidpoint(null, MAX, MID)).toBe(null);
    expect(bandMidpoint(MIN, null, MID)).toBe(null);
    expect(bandMidpoint(MAX, MIN, null)).toBe(null);
  });

  it('rounds a derived midpoint to a whole minor unit', () => {
    // An odd-cent span must not produce a half-cent midpoint.
    const mid = bandMidpoint(1, 2, null);
    expect(mid?.minor).toBe(2);
    expect(Number.isInteger(mid?.minor)).toBe(true);
  });

  it('accepts a midpoint sitting exactly on either edge', () => {
    expect(bandMidpoint(MIN, MAX, MIN)).toEqual({ minor: MIN, agreed: true });
    expect(bandMidpoint(MIN, MAX, MAX)).toEqual({ minor: MAX, agreed: true });
  });
});
