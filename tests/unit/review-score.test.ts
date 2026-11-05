import { describe, it, expect } from 'vitest';
import {
  computeFinalScore,
  describeScoreOnScale,
  normalizeRating,
  scoreReview,
  type ScoringScale,
  type ScoringSection,
} from '@/server/scoring/review-score';

/**
 * Scoring is checked against hand calculations, written out in each test, so a
 * change to the rules shows up as a disagreement with arithmetic rather than
 * with a previously recorded snapshot.
 */

const fivePoint: ScoringScale = {
  id: 'five',
  name: '5-point',
  numeric: true,
  levels: [
    { value: 1, label: 'Not yet meeting' },
    { value: 2, label: 'Developing' },
    { value: 3, label: 'Meets the standard' },
    { value: 4, label: 'Exceeds' },
    { value: 5, label: 'Outstanding' },
  ],
};

const threePoint: ScoringScale = {
  id: 'three',
  name: '3-point',
  numeric: true,
  levels: [
    { value: 1, label: 'Needs attention' },
    { value: 2, label: 'On track' },
    { value: 3, label: 'Going very well' },
  ],
};

function section(id: string, weight: number, questions: ScoringSection['questions']): ScoringSection {
  return { id, title: id, weight, questions };
}

function rating(id: string, weight = 1, scale: ScoringScale = fivePoint, required = true) {
  return { id, type: 'RATING', prompt: id, weight, required, scale };
}

describe('normalizeRating', () => {
  it('places a rating on 0-100 using its own scale endpoints', () => {
    expect(normalizeRating(3, 1, 5)).toBe(50);
    expect(normalizeRating(1, 1, 5)).toBe(0);
    expect(normalizeRating(5, 1, 5)).toBe(100);
    expect(normalizeRating(4, 1, 5)).toBe(75);
  });

  it('gives the same raw number a different meaning on a different scale', () => {
    // This is exactly why reports must not pool two scales.
    expect(normalizeRating(3, 1, 5)).toBe(50);
    expect(normalizeRating(3, 1, 3)).toBe(100);
  });

  it('returns null rather than dividing by zero on a degenerate scale', () => {
    expect(normalizeRating(2, 2, 2)).toBeNull();
  });

  it('clamps a value outside the scale instead of extrapolating', () => {
    expect(normalizeRating(9, 1, 5)).toBe(100);
    expect(normalizeRating(-4, 1, 5)).toBe(0);
  });
});

describe('scoreReview', () => {
  it('computes a weighted mean within a section', () => {
    // 4 -> 75, 2 -> 25, equal weights => (75 + 25) / 2 = 50
    const sections = [section('s1', 1, [rating('q1'), rating('q2')])];
    const result = scoreReview(sections, [
      { questionId: 'q1', numericValue: 4, answered: true },
      { questionId: 'q2', numericValue: 2, answered: true },
    ]);
    expect(result.sections[0]?.score).toBe(50);
    expect(result.score).toBe(50);
  });

  it('respects question weights', () => {
    // 5 -> 100 weight 3, 1 -> 0 weight 1 => (100*3 + 0*1) / 4 = 75
    const sections = [section('s1', 1, [rating('q1', 3), rating('q2', 1)])];
    const result = scoreReview(sections, [
      { questionId: 'q1', numericValue: 5, answered: true },
      { questionId: 'q2', numericValue: 1, answered: true },
    ]);
    expect(result.sections[0]?.score).toBe(75);
  });

  it('respects section weights in the overall score', () => {
    // s1 = 100 weight 3, s2 = 0 weight 1 => (100*3 + 0*1) / 4 = 75
    const sections = [
      section('s1', 3, [rating('q1')]),
      section('s2', 1, [rating('q2')]),
    ];
    const result = scoreReview(sections, [
      { questionId: 'q1', numericValue: 5, answered: true },
      { questionId: 'q2', numericValue: 1, answered: true },
    ]);
    expect(result.score).toBe(75);
  });

  describe('missing information is not a zero', () => {
    it('excludes a "not applicable" answer from both sides of the calculation', () => {
      // Only q1 counts: 4 -> 75. If N/A were a zero the answer would be 37.5.
      const sections = [section('s1', 1, [rating('q1'), rating('q2', 1, fivePoint, false)])];
      const result = scoreReview(sections, [
        { questionId: 'q1', numericValue: 4, answered: true },
        { questionId: 'q2', numericValue: null, notApplicable: true, answered: false },
      ]);
      expect(result.sections[0]?.score).toBe(75);
      expect(result.sections[0]?.questions.find((q) => q.questionId === 'q2')?.exclusionReason).toBe(
        'NOT_APPLICABLE',
      );
    });

    it('excludes an unanswered optional question', () => {
      const sections = [section('s1', 1, [rating('q1'), rating('q2', 1, fivePoint, false)])];
      const result = scoreReview(sections, [{ questionId: 'q1', numericValue: 2, answered: true }]);
      expect(result.sections[0]?.score).toBe(25);
      expect(result.hasUnansweredRequired).toBe(false);
    });

    it('flags an unanswered REQUIRED question while still excluding it from the score', () => {
      const sections = [section('s1', 1, [rating('q1'), rating('q2', 1, fivePoint, true)])];
      const result = scoreReview(sections, [{ questionId: 'q1', numericValue: 5, answered: true }]);
      expect(result.hasUnansweredRequired).toBe(true);
      expect(result.sections[0]?.score).toBe(100);
    });

    it('reports a section with no usable answers as null, not as zero', () => {
      const sections = [section('s1', 1, [rating('q1', 1, fivePoint, false)])];
      const result = scoreReview(sections, []);
      expect(result.sections[0]?.score).toBeNull();
      expect(result.score).toBeNull();
    });
  });

  it('reports coverage so a partly answered review is visibly partial', () => {
    const sections = [
      section('s1', 1, [rating('q1')]),
      section('s2', 1, [rating('q2', 1, fivePoint, false)]),
    ];
    const result = scoreReview(sections, [{ questionId: 'q1', numericValue: 3, answered: true }]);
    // One of two weighted sections contributed.
    expect(result.coverage).toBe(0.5);
    expect(result.score).toBe(50);
  });

  it('ignores question types that carry no number', () => {
    const sections = [
      section('s1', 1, [
        rating('q1'),
        { id: 'q2', type: 'TEXT', prompt: 'Tell me more', weight: 1, required: true },
      ]),
    ];
    const result = scoreReview(sections, [
      { questionId: 'q1', numericValue: 4, answered: true },
      { questionId: 'q2', numericValue: null, answered: true },
    ]);
    expect(result.sections[0]?.score).toBe(75);
    expect(result.sections[0]?.questions.find((q) => q.questionId === 'q2')?.exclusionReason).toBe(
      'NOT_SCOREABLE',
    );
  });

  it('scores a question repeated per goal independently', () => {
    const sections = [
      section('goals', 1, [
        { ...rating('g'), subjectKey: 'goal-a', subjectLabel: 'Goal A' },
        { ...rating('g'), subjectKey: 'goal-b', subjectLabel: 'Goal B' },
      ]),
    ];
    // 5 -> 100 and 1 -> 0, mean 50
    const result = scoreReview(sections, [
      { questionId: 'g', subjectKey: 'goal-a', numericValue: 5, answered: true },
      { questionId: 'g', subjectKey: 'goal-b', numericValue: 1, answered: true },
    ]);
    expect(result.sections[0]?.score).toBe(50);
    expect(result.includedQuestionCount).toBe(2);
  });

  it('handles a section whose weight is zero without discarding its answers', () => {
    // A zero-weight section cannot move the overall score.
    const sections = [
      section('written', 0, [rating('q1')]),
      section('scored', 1, [rating('q2')]),
    ];
    const result = scoreReview(sections, [
      { questionId: 'q1', numericValue: 1, answered: true },
      { questionId: 'q2', numericValue: 5, answered: true },
    ]);
    expect(result.score).toBe(100);
  });

  it('records the raw value and its label alongside the normalized figure', () => {
    const sections = [section('s1', 1, [rating('q1')])];
    const result = scoreReview(sections, [{ questionId: 'q1', numericValue: 4, answered: true }]);
    const q = result.sections[0]?.questions[0];
    expect(q?.rawValue).toBe(4);
    expect(q?.rawLabel).toBe('Exceeds');
    expect(q?.normalized).toBe(75);
    expect(q?.scaleMin).toBe(1);
    expect(q?.scaleMax).toBe(5);
  });
});

describe('computeFinalScore', () => {
  it('uses the manager score alone under the default weighting', () => {
    const result = computeFinalScore(
      [
        { kind: 'SELF', status: 'SUBMITTED', score: 90 },
        { kind: 'MANAGER', status: 'SUBMITTED', score: 60 },
      ],
      { selfWeight: 0, managerWeight: 1, peerWeight: 0 },
    );
    expect(result.score).toBe(60);
    expect(result.components.find((c) => c.kind === 'SELF')?.included).toBe(false);
  });

  it('blends weighted components', () => {
    // 0.2*80 + 0.6*60 + 0.2*70 = 16 + 36 + 14 = 66
    const result = computeFinalScore(
      [
        { kind: 'SELF', status: 'SUBMITTED', score: 80 },
        { kind: 'MANAGER', status: 'SUBMITTED', score: 60 },
        { kind: 'PEER', status: 'SUBMITTED', score: 70 },
      ],
      { selfWeight: 0.2, managerWeight: 0.6, peerWeight: 0.2 },
    );
    expect(result.score).toBe(66);
    expect(result.coverage).toBe(1);
  });

  it('averages several peers before weighting, so peers cannot outvote the manager', () => {
    // peers average (90 + 70 + 80) / 3 = 80
    // 0.6*60 + 0.2*80 = 36 + 16 = 52, over weight 0.8 => 65
    const result = computeFinalScore(
      [
        { kind: 'MANAGER', status: 'SUBMITTED', score: 60 },
        { kind: 'PEER', status: 'SUBMITTED', score: 90 },
        { kind: 'PEER', status: 'SUBMITTED', score: 70 },
        { kind: 'PEER', status: 'SUBMITTED', score: 80 },
      ],
      { selfWeight: 0.2, managerWeight: 0.6, peerWeight: 0.2 },
    );
    expect(result.components.find((c) => c.kind === 'PEER')?.score).toBe(80);
    expect(result.components.find((c) => c.kind === 'PEER')?.contributing).toBe(3);
    expect(result.score).toBe(65);
    expect(result.coverage).toBe(0.8);
  });

  it('never counts a draft review', () => {
    const result = computeFinalScore(
      [
        { kind: 'MANAGER', status: 'DRAFT', score: 100 },
        { kind: 'SELF', status: 'SUBMITTED', score: 50 },
      ],
      { selfWeight: 0.5, managerWeight: 0.5, peerWeight: 0 },
    );
    expect(result.score).toBe(50);
    expect(result.components.find((c) => c.kind === 'MANAGER')?.included).toBe(false);
    expect(result.coverage).toBe(0.5);
  });

  it('returns null when nothing submitted carried a rating', () => {
    const result = computeFinalScore(
      [{ kind: 'MANAGER', status: 'SUBMITTED', score: null }],
      { selfWeight: 0, managerWeight: 1, peerWeight: 0 },
    );
    expect(result.score).toBeNull();
    expect(result.note).toContain('No score could be calculated');
  });

  it('renormalizes and says so when a weighted component is missing', () => {
    const result = computeFinalScore(
      [{ kind: 'MANAGER', status: 'SUBMITTED', score: 70 }],
      { selfWeight: 0.5, managerWeight: 0.5, peerWeight: 0 },
    );
    expect(result.score).toBe(70);
    expect(result.coverage).toBe(0.5);
    expect(result.note).toContain('50%');
  });
});

describe('describeScoreOnScale', () => {
  it('maps a percentage back to the nearest level label', () => {
    expect(describeScoreOnScale(50, fivePoint)).toContain('Meets the standard');
    expect(describeScoreOnScale(100, threePoint)).toContain('Going very well');
  });

  it('returns null when there is nothing to describe', () => {
    expect(describeScoreOnScale(null, fivePoint)).toBeNull();
    expect(describeScoreOnScale(50, null)).toBeNull();
  });
});
