# Extension plan

Work that was assessed and deliberately deferred, with the reasoning and what
each one would actually take. Deferred is not the same as forgotten, and it is
not the same as "nearly done".

## Compensation planning

**Status: assessed, not built. Deliberate.**

The brief asked for compensation planning to be assessed and kept in a
documented extension plan unless it could be completed without compromising the
core. It cannot, and the reason is not effort.

Compensation planning is not another module that happens to sit next to reviews.
It changes what the application *is*:

1. **A different confidentiality class.** Salary is more sensitive than a review
   and has a different audience — finance and senior leadership, often
   explicitly *not* the direct manager who writes the review. The permission
   model here is built around the reporting line; compensation needs a second,
   orthogonal access model that does not inherit from it. Bolting salary onto
   `canViewEmployeePerformanceRecord` would hand every manager their reports'
   pay, which is wrong in most organizations and unlawful disclosure in some.

2. **It makes the score consequential in a new way.** The moment a rating feeds
   a merit matrix, calibration stops being a quality conversation and becomes a
   budget negotiation. That is a real organizational change, and shipping the
   mechanism before anyone has decided the policy would be the application
   making the decision.

3. **It needs money handling.** Currency, rounding, proration for mid-year
   starters, effective dates, multi-currency if there is more than one entity.
   Floating point is not acceptable; this needs integer minor units throughout,
   which is a schema decision rather than a feature.

4. **Audit requirements are stricter.** A compensation change is often legally
   discoverable. The existing audit log is append-only and would serve, but
   retention, export and legal-hold requirements would need to be stated rather
   than assumed.

Half-built compensation planning is worse than none: a screen showing salaries
to the wrong audience is a serious incident, and a merit recommendation nobody
can explain is worse than no recommendation.

### What it would need

- A `CompensationRecord` model with integer minor units, currency, effective
  date, and an append-only change history.
- A **separate** role (`COMPENSATION_ADMIN`) and a separate policy section that
  does not inherit from the reporting line. Explicitly not implied by
  `HR_ADMIN`.
- A merit matrix mapping performance bands and position-in-range to a
  recommended increase, with the recommendation always editable and the override
  recorded with a reason — the same pattern calibration already uses.
- Budget pools with a hard ceiling, and a planning state separate from an
  approved state.
- Printable statements, and an export whose audience is defined before it is
  built.

The calibration module is the honest precedent: adjustments recorded with a
reason, an author and a timestamp, and the computed figure kept beside the
decided one. Compensation should follow it exactly.

## Advanced talent views

**Status: partially present.**

Built: competency libraries by role with behavioural descriptors per level,
competency-level reporting, goal progress roll-ups, and the calibration
distribution view.

Not built: nine-box grids, succession planning, flight-risk scoring.

The first is a presentation layer over data that already exists — performance
score against a potential rating — but **there is no potential rating**, and
inventing one by deriving it from performance history would be the application
asserting a judgement nobody made. A nine-box needs a human-entered potential
assessment with its own definition and its own calibration, or it is a
scatterplot of one variable against itself.

Flight-risk scoring is deliberately excluded rather than deferred. A model
telling a manager that a named person is likely to leave, based on survey
responses and engagement data, is exactly the use that makes employees stop
answering surveys honestly — and it would need anonymous survey data per person,
which does not exist here by design.

## External HR integrations

**Status: seam built, no provider wired.**

`src/server/services/employee-import.ts` already does the genuinely hard part of
any HR integration: field mapping, validation, duplicate detection against
employee number and e-mail, and a preview that is the contract the commit
honours. A scheduled integration is that pipeline with a different source.

What each would need:

| Integration | Work |
|---|---|
| HRIS employee sync | A fetch and a mapping into the existing import pipeline; decide whether the HRIS or DB Elevate owns the reporting line, because two owners means a loop |
| SSO / SAML / OIDC | `User.externalIdpSubject` exists; needs a sign-in path and a decision on just-in-time provisioning |
| SCIM provisioning | Deprovisioning must *deactivate* rather than delete, or history is lost |
| Calendar for one-on-ones | Outbound only; writing meetings into personal calendars needs consent |
| Payroll | Do not, until compensation planning exists |

The integration decision that matters most is which system owns the reporting
structure. Everything about historical review access depends on
`ManagerAssignment` being an accurate append-only record, so a sync that
overwrites it, or that races the application's own writes, would quietly corrupt
the thing the permission model relies on.

## Live AI

**Status: scaffolded, mock provider complete, no live provider.**

Built: the provider interface, a deterministic mock, the four-condition gate,
permission-respecting context assembly, the suggested/accepted/edited/discarded
record, context digests, the budget ceiling, and the configuration screen.

To add a live provider:

1. Implement `suggest` for that provider in `src/server/ai/provider.ts`. It is
   one HTTP call; the surrounding gate, audit and record keeping are done.
2. Set the credential and `AI_BILLING_APPROVED=true` in the server environment.
3. Set a monthly budget and select the provider in Administration.

Constraints that must survive any such change, because they are the reason the
feature is acceptable at all:

- Suggestions stay editable drafts with a visible source, never applied
  automatically.
- No model output becomes a rating, score, compensation figure, promotion or
  employment decision.
- Private notes and anonymous survey data stay excluded at the context layer.
- The context digest keeps being stored, so an audit can show what was sent.

**Survey summarisation is specifically not scaffolded.** Sending verbatim
comments from a promised-anonymous survey to a third-party service would break
that promise in the most direct way available. If it is ever wanted it needs its
own design, its own consent language shown before people answer, and probably a
local model. It is not a matter of adding another context assembler.

## Smaller gaps worth naming

| Gap | Note |
|---|---|
| **Surveys cannot be edited** | No edit path exists at all. If added, it must refuse to change `mode` on a launched survey, and refuse to change questions once any response exists — same reason a published template version is frozen. |
| Multi-organization UI | Records are scoped by `orgId` throughout, but there is no tenant selector and the path is untested. |
| Object storage for attachments | Four functions in `src/server/storage/files.ts`. |
| Recursive CTE for the reporting graph | Needed around tens of thousands of employees; three call sites. |
| Review cycle templates per cohort | A cycle uses one template version. Different templates for field and office staff means two cycles, which works but duplicates the admin. |
| Mobile push notifications | In-app notifications exist; push needs a service and a device registry. |
| Localisation | Strings are inline English. Extracting them is mechanical but large. |
| Bulk reviewer reassignment | The exceptions worklist surfaces reviews assigned to deactivated people one at a time. |

## Things deliberately excluded

Not deferred — judged to be the wrong thing to build:

- **Impersonation / "view as".** It would make the audit log a record of who
  pretended to be whom.
- **Break-glass access to private notes or drafts.** A protection with an
  exception is a protection nobody relies on, and a manager who suspects a note
  might be read will keep a document the application never sees.
- **Automatic curve fitting in calibration.** A distribution target is an input
  to a human conversation, not a transformation to apply to people's records.
- **Sentiment analysis of review text.** It would produce a number nobody can
  explain and that the subject cannot contest.
- **Automated cycle launch.** Creating assignments for real people with real
  deadlines stays a decision somebody takes and can see the consequences of
  first.
