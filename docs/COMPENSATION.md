# Compensation

Merit cycles, salary bands and pay history. This module decides what people are
paid, so it is built more conservatively than the rest of the application, and
the conservatism is in the code rather than in this document.

Access rules are in [PERMISSIONS.md](PERMISSIONS.md#compensation). This page is
about how the module works and why it works that way.

## The shape of a cycle

```
DRAFT ──launch──> PLANNING ──close──> IN_APPROVAL ──approve all──> APPROVED ──apply──> APPLIED
                                                                                  │
                                                                      CANCELLED <─┘ (any state)
```

- **DRAFT** — created, participants and snapshots recorded, nobody notified.
- **PLANNING** — managers can allocate. Going over budget is reported, not
  blocked.
- **IN_APPROVAL** — allocation closed, the administrator reviews submissions.
- **APPROVED** — every figure has been approved. **Nothing has been paid.**
- **APPLIED** — approved increases written to pay history as new rows.

Approving and applying are separate endpoints with separate controls, because
approving says a number is right and applying changes what somebody is paid. A
cycle can sit at APPROVED indefinitely.

## Money

All compensation arithmetic lives in `src/lib/money.ts`. It is pure — no
database, no request context — so every rule in it can be checked against a
hand calculation. `tests/unit/compensation-money.test.ts` has 34 tests doing
exactly that.

**Everything is an integer.** Salary is in minor units: $72,500.00 is
`7250000`. Increases are in basis points: 3.25% is `325`. There is no `number`
in this module that represents a fraction of a cent.

Rounding happens **once**, in `increaseFromBasisPoints`, and the resulting
integer is what gets stored and what every later total adds up. The alternative
— keeping the percentage and deriving the amount at display time — lets a row
and a budget disagree by a cent, which is the kind of discrepancy nobody can
explain six months later. The dialog a manager types into computes its preview
with the same function the server stores with, so what they are shown and what
is saved cannot differ.

### Position in band

A compa-ratio is salary ÷ midpoint. The **agreed** midpoint is used when a band
has one, and halfway between the minimum and the maximum only when it does not
— and a screen that shows a derived midpoint says so.

This matters more than it sounds. A band is often skewed on purpose: a target
rate of $75,000 inside a $60,000–$95,000 range is not halfway. Somebody paid
$70,000 is at 0.875 of that target but 0.903 of halfway, which lands them in a
different row of the merit matrix — a 3.5% suggestion rather than 2.75%. The
`bandMidMinor` column exists for that reason, and it is snapshotted onto each
participant at launch alongside the minimum and maximum.

## The recommendation

`recommendIncrease` maps a released performance score and a position in band
onto a suggested increase, using `DEFAULT_MERIT_MATRIX`. It always returns an
explanation in words, because a number a manager cannot account for is one they
will either rubber-stamp or ignore.

Three things it deliberately does not do:

1. **A missing score is not a middling score.** No released review means
   `band: null` and `bp: null` — no recommendation at all, and the screen says
   so. Treating an unassessed person as "meets expectations" would hand them a
   figure nobody stands behind.
2. **A missing band is not assumed to be mid-band.** With no salary band the
   compa-ratio is `null`. The matrix then uses the mid bucket *and the
   explanation says the midpoint was assumed*, rather than implying a precision
   that is not there.
3. **It never writes anything.** The recommendation populates a field. A person
   sets the number. An allocation that differs from the recommendation is
   refused without a written reason, and both figures are kept, so an override
   stays visible as an override.

## Budgets

An org-wide pool is divided into per-manager pools. "Divide pool by payroll"
weights each manager's share by the payroll they are allocating over and gives
the last one the remainder, so the budgets sum to the pool exactly rather than
to the pool give or take a few cents. Any pool can then be set by hand.

The ceiling is checked **at submission**, not while a manager is deciding:
somebody part-way through allocating is legitimately over, and refusing the
keystroke would push the work into a spreadsheet, where there are no rules at
all. Going over is reported on screen the whole time, with the amount.

Three budget states, which are genuinely different:

| State | At submission | On screen |
| --- | --- | --- |
| **No budget row** | Nothing enforced | "No budget set for you, so nothing is enforced when you submit" |
| **A row of zero** | Every decision must be 0% | "Nothing to give", and the manager is told every decision has to be 0% |
| **A figure** | Enforced; the refusal names the overage | The remaining amount, and a progress bar |

Collapsing the first two is the obvious mistake, and it is the expensive one: a
manager told nothing is enforced, who then gets refused, has wasted an
afternoon. So a budget of zero is a real ceiling of zero, and the way to leave
a manager unconstrained is to **remove** the budget rather than zero it. The
interface offers both, and `tests/browser/compensation-budget-test.js` asserts
all three states on the screen and at the submission boundary.

The sum of the manager budgets and the cycle pool are allowed to differ, and
the panel says when they do. Handing out more than the pool is a decision, not
an error — but it should be a visible one.

## Pay history is append-only

`CompensationRecord` is only ever inserted into. A correction is a new row with
`changeType: 'CORRECTION'` and a note, not an edit of the row it corrects. The
consequence is that "what were we paying them in March" always has an answer,
including when March's figure was entered wrongly.

Applying a cycle writes one row per approved participant, with
`sourceCycleId` set, so every increase can be traced back to the cycle and the
decision that produced it.

## Snapshots

At creation, each participant records the current salary, the salary band
(minimum, midpoint, maximum), the manager, the job title, the department and
the released performance score **as they stand at that moment**. Everything
afterwards resolves against that record:

- A band revision does not re-write the compa-ratio a decision was made
  against.
- A reorganization does not move who is allocating somebody's pay mid-cycle.
- A promotion does not retroactively change the basis of a decided increase.

This is the same rule review cycles follow, for the same reason, and it is why
`managerIdSnapshot` rather than `employee.managerId` appears in every
compensation predicate.

## Who is included

Everyone active with a salary on record. Anybody **without** one is left out
and named on creation, because there is nothing to base an increase on. This is
reachable in the demonstration data: two job titles have no salary band, and
the people in them have no pay record, so the empty state is a real screen
rather than a paragraph.

## What is not built

Stated plainly, and also in [EXTENSION-PLAN.md](EXTENSION-PLAN.md):

- **No compensation export.** Nothing writes salary to a file. The audience for
  such an export has not been defined, and until it is, not existing is the
  safe default.
- **No printable statement** for an employee to keep.
- **No proration.** An increase applies to the current base in full; somebody
  who started in October gets the same percentage as somebody who started in
  January. If that is wrong for this company, it is a policy decision to settle
  before the first real cycle.
- **No currency conversion.** Each record and cycle carries a currency and the
  arithmetic is currency-agnostic, but nothing converts and no screen mixes
  currencies. One currency per cycle.
- **No variable pay.** Annual base salary only. Bonus, commission and overtime
  are outside the application — which for a construction company leaves the
  Sales Manager's commission out entirely.

## Verifying it

```bash
npm run test                 # 34 money tests, and the policy tests that pin the role split
npm run test:compensation    # 84 browser checks: permissions, the full flow, budget ceilings
```

`tests/browser/compensation-test.js` checks 37 access rules by calling the API,
not by looking for hidden buttons, and takes its targets from the database so a
refusal test cannot pass by failing to find anything to attack.

`tests/browser/compensation-flow-test.js` drives a manager deciding and
overriding, an administrator approving and applying, and then asserts that the
integer written to pay history is the same integer the dialog previewed.

`tests/browser/compensation-budget-test.js` covers the three budget states
above, including that a refusal names the overage and that a zero budget says
so rather than quoting one.

The last two mutate the seeded cycle, so the script re-seeds between them and
afterwards.
