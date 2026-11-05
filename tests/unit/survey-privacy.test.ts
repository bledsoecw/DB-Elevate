import { describe, it, expect } from 'vitest';
import {
  applySuppression,
  canShowFilteredResults,
  canShowVerbatims,
  computeEnps,
  stableShuffle,
  tenureBand,
} from '@/server/surveys/privacy';

/**
 * These tests are the specification for the anonymity promise. If one of them
 * fails, the promise printed on the survey intro page has stopped being true.
 */

describe('applySuppression', () => {
  const base = { threshold: 5, totalResponses: 40 };

  it('shows every segment when all are above the threshold', () => {
    const r = applySuppression(
      [
        { key: 'a', label: 'Field', n: 12, value: 4.1 },
        { key: 'b', label: 'Office', n: 10, value: 3.8 },
        { key: 'c', label: 'PM', n: 18, value: 3.2 },
      ],
      base,
    );
    expect(r.reportable).toBe(true);
    expect(r.segments.every((s) => !s.suppressed)).toBe(true);
    expect(r.notice).toBeNull();
  });

  it('hides a segment below the threshold', () => {
    const r = applySuppression(
      [
        { key: 'a', label: 'Field', n: 20, value: 4.1 },
        { key: 'b', label: 'Office', n: 17, value: 3.8 },
        { key: 'c', label: 'Leadership', n: 3, value: 2.0 },
      ],
      base,
    );
    const hidden = r.segments.find((s) => s.key === 'c');
    expect(hidden?.suppressed).toBe(true);
    expect(hidden?.n).toBeNull();
    expect(hidden?.value).toBeNull();
    expect(hidden?.reason).toBe('BELOW_THRESHOLD');
  });

  it('hides a second segment so the first cannot be recovered by subtraction', () => {
    // With only "Leadership" hidden, its count is total minus the rest.
    const r = applySuppression(
      [
        { key: 'a', label: 'Field', n: 20, value: 4.1 },
        { key: 'b', label: 'Office', n: 17, value: 3.8 },
        { key: 'c', label: 'Leadership', n: 3, value: 2.0 },
      ],
      base,
    );
    const suppressed = r.segments.filter((s) => s.suppressed);
    expect(suppressed.length).toBeGreaterThanOrEqual(2);
    // The smallest visible segment is the one additionally withheld.
    expect(r.segments.find((s) => s.key === 'b')?.suppressed).toBe(true);
    expect(r.segments.find((s) => s.key === 'b')?.reason).toBe('COMPLEMENT_PROTECTION');
  });

  it('can be configured not to apply complement protection', () => {
    const r = applySuppression(
      [
        { key: 'a', label: 'Field', n: 20, value: 4.1 },
        { key: 'b', label: 'Office', n: 17, value: 3.8 },
        { key: 'c', label: 'Leadership', n: 3, value: 2.0 },
      ],
      { ...base, suppressComplement: false },
    );
    expect(r.segments.filter((s) => s.suppressed)).toHaveLength(1);
  });

  it('hides the whole breakdown rather than leaving one visible segment', () => {
    const r = applySuppression(
      [
        { key: 'a', label: 'Field', n: 30, value: 4.1 },
        { key: 'b', label: 'Office', n: 4, value: 3.8 },
      ],
      base,
    );
    expect(r.segments.every((s) => s.suppressed)).toBe(true);
  });

  it('withholds everything when the survey itself is below the threshold', () => {
    const r = applySuppression([{ key: 'a', label: 'Field', n: 3, value: 4 }], {
      threshold: 5,
      totalResponses: 3,
    });
    expect(r.reportable).toBe(false);
    expect(r.segments).toHaveLength(0);
    expect(r.notice).toContain('at least 5');
    expect(r.notice).toContain('3 responses');
  });

  it('never returns a count or a value for a suppressed segment', () => {
    const r = applySuppression(
      [
        { key: 'a', label: 'Big', n: 30, value: 4 },
        { key: 'b', label: 'Small', n: 2, value: 1 },
        { key: 'c', label: 'Medium', n: 8, value: 3 },
      ],
      base,
    );
    for (const s of r.segments.filter((x) => x.suppressed)) {
      expect(s.n).toBeNull();
      expect(s.value).toBeNull();
    }
  });
});

describe('canShowFilteredResults', () => {
  it('allows anything for a named survey', () => {
    expect(
      canShowFilteredResults({ mode: 'NAMED', activeFilterCount: 3, filteredResponseCount: 1, threshold: 5 })
        .allowed,
    ).toBe(true);
  });

  it('refuses to cross-tabulate an anonymous survey', () => {
    const r = canShowFilteredResults({
      mode: 'ANONYMOUS',
      activeFilterCount: 2,
      filteredResponseCount: 40,
      threshold: 5,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('one dimension at a time');
  });

  it('refuses a filtered group below the threshold', () => {
    const r = canShowFilteredResults({
      mode: 'ANONYMOUS',
      activeFilterCount: 1,
      filteredResponseCount: 4,
      threshold: 5,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('4 responses');
  });

  it('allows a single filter over a large enough group', () => {
    expect(
      canShowFilteredResults({
        mode: 'ANONYMOUS',
        activeFilterCount: 1,
        filteredResponseCount: 11,
        threshold: 5,
      }).allowed,
    ).toBe(true);
  });
});

describe('canShowVerbatims', () => {
  it('never shows filtered written answers from an anonymous survey', () => {
    const r = canShowVerbatims({
      mode: 'ANONYMOUS',
      activeFilterCount: 1,
      totalResponses: 100,
      threshold: 5,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('only shown unfiltered');
  });

  it('hides written answers below the threshold', () => {
    expect(
      canShowVerbatims({ mode: 'ANONYMOUS', activeFilterCount: 0, totalResponses: 4, threshold: 5 })
        .allowed,
    ).toBe(false);
  });

  it('shows unfiltered written answers above the threshold', () => {
    expect(
      canShowVerbatims({ mode: 'ANONYMOUS', activeFilterCount: 0, totalResponses: 22, threshold: 5 })
        .allowed,
    ).toBe(true);
  });

  it('places no restriction on a named survey', () => {
    expect(
      canShowVerbatims({ mode: 'NAMED', activeFilterCount: 2, totalResponses: 1, threshold: 5 }).allowed,
    ).toBe(true);
  });
});

describe('stableShuffle', () => {
  it('changes the order', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(stableShuffle(input, 'seed')).not.toEqual(input);
  });

  it('is stable for the same seed, so a reload does not reveal ordering', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(stableShuffle(input, 'survey-1')).toEqual(stableShuffle(input, 'survey-1'));
  });

  it('keeps every item', () => {
    const input = ['a', 'b', 'c', 'd'];
    expect([...stableShuffle(input, 'x')].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('computeEnps', () => {
  it('computes promoters minus detractors as a percentage', () => {
    // 2 promoters (9,10), 1 passive (8), 2 detractors (6,3) of 5 => (2-2)/5 = 0
    expect(computeEnps([9, 10, 8, 6, 3]).score).toBe(0);
  });

  it('classifies the bands correctly', () => {
    const r = computeEnps([10, 9, 8, 7, 6, 0]);
    expect(r.promoters).toBe(2);
    expect(r.passives).toBe(2);
    expect(r.detractors).toBe(2);
  });

  it('returns null for no responses rather than zero', () => {
    expect(computeEnps([]).score).toBeNull();
  });

  it('ignores values outside 0-10', () => {
    expect(computeEnps([9, 11, -1]).n).toBe(1);
  });
});

describe('tenureBand', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('places a hire date in a coarse band', () => {
    expect(tenureBand(new Date('2026-04-01'), now)).toBe('< 6 months');
    expect(tenureBand(new Date('2025-10-01'), now)).toBe('6-12 months');
    expect(tenureBand(new Date('2024-06-01'), now)).toBe('1-3 years');
    expect(tenureBand(new Date('2022-06-01'), now)).toBe('3-5 years');
    expect(tenureBand(new Date('2015-01-01'), now)).toBe('5+ years');
  });

  it('handles a missing hire date without guessing', () => {
    expect(tenureBand(null, now)).toBe('Unknown');
  });
});
