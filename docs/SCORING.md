# Scoring

The rules below are implemented in `src/server/scoring/review-score.ts` and
`src/server/scoring/goal-progress.ts`. Both are pure functions with no database
access, which is why they can be verified against hand calculations — 45 of the
134 unit tests are scoring tests.

Rule version: **`score-v1`**, stored on every computed score. If the rules ever
change, old scores keep the version they were computed under rather than
silently acquiring new arithmetic.

## The principle

**Missing information is not a zero.**

A question nobody answered, or one marked not applicable, is excluded from the
numerator *and* the denominator. The share of weight that was excluded is
reported as `coverage`, so a reader can judge how complete the score is instead
of being handed a confident-looking number built from two answers out of twenty.

Treating a blank as zero is the single most common way a performance score lies.
A manager who skipped eight questions would hand their report a catastrophic
rating they never gave.

## Which questions score at all

Only `RATING` and `COMPETENCY_RATING` produce numbers. Written responses,
multiple choice and goal questions carry meaning but no score — they are marked
`NOT_SCOREABLE` and excluded from both parts of the fraction. They are not
counted against coverage either, because a template full of written questions is
not an incomplete template.

A rating question is excluded, with the reason recorded and shown, when:

| Reason | Meaning |
|---|---|
| `NOT_APPLICABLE` | The reviewer marked it N/A — a deliberate statement, not a gap |
| `UNANSWERED` | Left blank. If the question was required, `hasUnansweredRequired` is set and submission is refused |
| `NOT_SCOREABLE` | Not a rating question |
| `NO_SCALE` | No rating scale attached, or the scale has no numeric levels |
| `SCALE_NOT_NUMERIC` | The scale is marked directional only |
| `DEGENERATE_SCALE` | Every level has the same value, so there is no range to measure against |

Every one of these appears in the score breakdown shown on screen. A reader can
always see why a question did not contribute.

## Normalizing a rating

A raw rating is mapped onto 0–100 using the scale's own minimum and maximum:

```
normalized = (clamp(raw, min, max) - min) / (max - min) * 100
```

So a 3 on a 1–5 scale is **50**. A 3 on a 1–3 scale is **100**. The same raw
number means different things on different scales, which is exactly why reports
must never pool two scales — see *Comparability* below.

A value outside the scale is clamped rather than rejected, so bad imported data
cannot push a score above 100.

## Section score

Weighted mean of the included questions in that section:

```
section score = Σ(normalized × question weight) / Σ(question weight)   [included only]
coverage      = Σ(included weight) / Σ(all scoreable weight)
```

A section where nothing could be scored has `score: null`, not 0.

### Worked example

A section with three questions on a 1–5 scale:

| Question | Weight | Answer | Normalized |
|---|---|---|---|
| Safety | 2 | 5 | 100 |
| Craftsmanship | 1 | 3 | 50 |
| Client service | 1 | *not applicable* | excluded |

```
score    = (100 × 2 + 50 × 1) / (2 + 1) = 250 / 3 = 83.33
coverage = 3 / 4 = 0.75
```

The excluded question removes its weight from the denominator. Had it been
counted as zero, the score would have been 62.5 — a 21-point penalty for a
question the reviewer explicitly said did not apply.

## Overall review score

Weighted mean across sections that produced a score. Section weights are
renormalized over the included sections, and `coverage` reports the share of
total section weight that contributed.

```
overall  = Σ(section score × section weight) / Σ(section weight)   [scored sections only]
coverage = Σ(weight of scored sections) / Σ(weight of sections with any scoreable content)
```

A section with no scoreable questions at all is left out of the coverage
denominator — a written-responses-only section is not a hole.

## Final participant score

`computeFinalScore` combines the submitted assignments using the weights on the
**template version** the cycle was launched against, not on the template as it
stands today.

Three weighted components:

| Component | Reviewer kinds included |
|---|---|
| Self | `SELF` |
| Manager | `MANAGER` |
| Peer | `PEER`, `SKIP_LEVEL`, `UPWARD` |

Rules:

1. **Only `SUBMITTED` assignments count.** Draft work never reaches a final
   score, in keeping with drafts being private to their author.
2. **Peers are averaged first.** Three peers are averaged into one peer score
   before weighting, so a crowd of peers cannot outvote a single manager. Skip-
   level and upward reviews are averaged into the same component.
3. **A missing component is dropped and the rest renormalized.** If peer weight
   is 0.2 but no peer review was submitted, the remaining weights are scaled up
   over the components that exist. `coverage` reports the share of configured
   weight that actually contributed.
4. **No component, no score.** `null`, never 0.

### Worked example

Weights self 0.2, manager 0.6, peer 0.2. Submitted: self 70, manager 80, and
two peers at 90 and 70.

```
peer component = (90 + 70) / 2 = 80
final = (70 × 0.2 + 80 × 0.6 + 80 × 0.2) / (0.2 + 0.6 + 0.2)
      = (14 + 48 + 16) / 1.0 = 78.00
coverage = 1.0
```

Now suppose no peer review was submitted:

```
final = (70 × 0.2 + 80 × 0.6) / (0.2 + 0.6) = 62 / 0.8 = 77.50
coverage = 0.8
```

The score moves slightly and coverage drops to 0.8, which is shown. The peer
weight is not quietly absorbed as a zero, and the number is not presented as
though every configured input arrived.

## Calibration adjustments

A calibrated score **never replaces** the calculated one. Both are stored —
`CycleParticipant.finalScore` and `calibratedScore` — and the released review
shows both figures plus the recorded reason and the person who decided.

The employee therefore sees that a human changed the number, rather than finding
a score that silently disagrees with its own arithmetic. Every adjustment
requires a written reason of at least ten characters, and leaving a score
unchanged is also recorded as a decision. See
[PERMISSIONS.md](PERMISSIONS.md) and `src/server/services/calibration.ts`.

A calibration session freezes `originalScore` when it opens, so the baseline
survives however many times the figure is later adjusted.

## Goal progress

`computeGoalProgress` returns a `source` alongside the number, because *who
said so* matters as much as the value:

| `source` | Meaning |
|---|---|
| `COMPUTED` | Derived from a measurable target: `(current - start) / (target - start)` |
| `REPORTED` | The owner's own percentage, used when there is no measurable target |
| `NONE` | Neither available — shown as "no progress recorded", not 0% |

When a goal has both a measurable target and a reported percentage and they
disagree by more than a threshold, `divergent` is set and **both are shown**.
The application does not pick a winner: a target saying 40% and an owner saying
90% is a conversation, not an averaging problem.

Milestone goals compute progress as completed milestones over total, excluding
cancelled milestones from the denominator rather than counting them as
incomplete.

`goalRisk` flags overdue and blocked goals from stored dates and status, not from
a heuristic about how progress "should" be tracking.

## Comparability

Two guards, because misleading comparison is the main way a correct number tells
a lie.

**Different scales are never pooled.** A 3 on a 1–3 scale normalizes to 100 and a
3 on a 1–5 scale to 50. Rating distributions are drawn per scale, and a
distribution chart states which scale it is drawn on.

**Different templates are flagged.** A trend across cycles that used different
templates is still drawn — direction over time is useful — but it carries a
caveat naming the templates that differed and stating that a score is a position
on its own template's rating scale, so the periods are not strictly comparable.
The caveat is shown prominently in amber, not as a footnote.

**Denominators are always stated.** Every completion figure, participation rate
and distribution says what it is out of. "70%" with no denominator is not a
statistic.

## Drafts and official reporting

Draft scores exist — a reviewer sees their own running score as they work — but
they are never aggregated. Reports count submitted assignments only, and a
participant's final score is computed at submission and recomputed on release
from stored answers rather than from a cached figure.
