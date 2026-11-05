import { describe, it, expect } from 'vitest';
import { computeGoalProgress, goalRisk } from '@/server/scoring/goal-progress';

describe('computeGoalProgress', () => {
  describe('PERCENT goals', () => {
    it('uses the reported figure and labels it as reported', () => {
      const r = computeGoalProgress({ measurementType: 'PERCENT', reportedProgressPct: 65 });
      expect(r.displayPct).toBe(65);
      expect(r.source).toBe('REPORTED');
      expect(r.computedPct).toBeNull();
      expect(r.explanation).toContain('reported by the goal owner');
    });

    it('reports nothing rather than zero when no progress has been entered', () => {
      const r = computeGoalProgress({ measurementType: 'PERCENT' });
      expect(r.displayPct).toBeNull();
      expect(r.source).toBe('NONE');
    });

    it('clamps an out-of-range reported value', () => {
      expect(computeGoalProgress({ measurementType: 'PERCENT', reportedProgressPct: 140 }).displayPct).toBe(100);
      expect(computeGoalProgress({ measurementType: 'PERCENT', reportedProgressPct: -20 }).displayPct).toBe(0);
    });
  });

  describe('NUMERIC goals', () => {
    it('computes progress from start, target and current', () => {
      // (30 - 0) / (100 - 0) = 30%
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 0,
        targetValue: 100,
        currentValue: 30,
      });
      expect(r.computedPct).toBe(30);
      expect(r.source).toBe('COMPUTED');
    });

    it('handles a goal where the number should go down', () => {
      // Lost-time incidents: start 3, target 0, now 1 => (1-3)/(0-3) = 66.67%
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 3,
        targetValue: 0,
        currentValue: 1,
        higherIsBetter: false,
      });
      expect(r.computedPct).toBeCloseTo(66.67, 1);
    });

    it('clamps progress past the target to 100 rather than reporting 140%', () => {
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 0,
        targetValue: 10,
        currentValue: 14,
      });
      expect(r.computedPct).toBe(100);
    });

    it('clamps movement in the wrong direction to 0 rather than a negative', () => {
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 10,
        targetValue: 20,
        currentValue: 5,
      });
      expect(r.computedPct).toBe(0);
    });

    it('refuses to compute when start equals target', () => {
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 5,
        targetValue: 5,
        currentValue: 5,
      });
      expect(r.computedPct).toBeNull();
      expect(r.explanation).toContain('same start and target');
    });

    it('refuses to compute when a value is missing', () => {
      const r = computeGoalProgress({ measurementType: 'NUMERIC', targetValue: 10, currentValue: 5 });
      expect(r.computedPct).toBeNull();
      expect(r.explanation).toContain('missing');
    });
  });

  describe('MILESTONE goals', () => {
    it('computes from completed milestone weight', () => {
      const r = computeGoalProgress({
        measurementType: 'MILESTONE',
        milestones: [
          { completedAt: new Date(), weight: 1 },
          { completedAt: new Date(), weight: 1 },
          { completedAt: null, weight: 1 },
          { completedAt: null, weight: 1 },
        ],
      });
      expect(r.computedPct).toBe(50);
      expect(r.source).toBe('COMPUTED');
    });

    it('respects milestone weights', () => {
      // completed weight 3 of total 4 => 75%
      const r = computeGoalProgress({
        measurementType: 'MILESTONE',
        milestones: [
          { completedAt: new Date(), weight: 3 },
          { completedAt: null, weight: 1 },
        ],
      });
      expect(r.computedPct).toBe(75);
    });

    it('reports null for a milestone goal with no milestones', () => {
      const r = computeGoalProgress({ measurementType: 'MILESTONE', milestones: [] });
      expect(r.computedPct).toBeNull();
      expect(r.explanation).toContain('no milestones');
    });
  });

  describe('BINARY goals', () => {
    it('is 0 until complete and 100 once complete', () => {
      expect(computeGoalProgress({ measurementType: 'BINARY', status: 'IN_PROGRESS' }).computedPct).toBe(0);
      expect(computeGoalProgress({ measurementType: 'BINARY', status: 'COMPLETED' }).displayPct).toBe(100);
    });
  });

  describe('reported versus computed', () => {
    it('keeps both and flags a meaningful disagreement', () => {
      // Computed 30%, owner reports 80%.
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 0,
        targetValue: 100,
        currentValue: 30,
        reportedProgressPct: 80,
      });
      expect(r.computedPct).toBe(30);
      expect(r.reportedPct).toBe(80);
      expect(r.displayPct).toBe(30); // the computed figure is what is shown
      expect(r.divergent).toBe(true);
    });

    it('does not flag a small difference', () => {
      const r = computeGoalProgress({
        measurementType: 'NUMERIC',
        startValue: 0,
        targetValue: 100,
        currentValue: 48,
        reportedProgressPct: 50,
      });
      expect(r.divergent).toBe(false);
    });
  });

  it('shows a completed goal as 100% whatever the measurement says', () => {
    const r = computeGoalProgress({
      measurementType: 'NUMERIC',
      startValue: 0,
      targetValue: 100,
      currentValue: 40,
      status: 'COMPLETED',
    });
    expect(r.displayPct).toBe(100);
    expect(r.explanation).toContain('marked complete');
  });
});

describe('goalRisk', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('ignores goals that are finished or cancelled', () => {
    expect(goalRisk({ status: 'COMPLETED', dueDate: new Date('2020-01-01'), now })).toBe('NONE');
    expect(goalRisk({ status: 'CANCELLED', health: 'BLOCKED', now })).toBe('NONE');
  });

  it('puts a blocked goal above an overdue one', () => {
    expect(goalRisk({ status: 'IN_PROGRESS', health: 'BLOCKED', dueDate: new Date('2020-01-01'), now })).toBe(
      'BLOCKED',
    );
  });

  it('flags an overdue goal', () => {
    expect(goalRisk({ status: 'IN_PROGRESS', health: 'ON_TRACK', dueDate: new Date('2026-06-01'), now })).toBe(
      'OVERDUE',
    );
  });

  it('flags a goal due within a fortnight', () => {
    expect(goalRisk({ status: 'IN_PROGRESS', health: 'ON_TRACK', dueDate: new Date('2026-06-22'), now })).toBe(
      'DUE_SOON',
    );
  });

  it('reports nothing for a healthy goal with time left', () => {
    expect(goalRisk({ status: 'IN_PROGRESS', health: 'ON_TRACK', dueDate: new Date('2026-12-31'), now })).toBe(
      'NONE',
    );
  });
});
