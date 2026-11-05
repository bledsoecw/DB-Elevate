# Extension plan

Work that was assessed and deliberately deferred, with the reasoning and what
each one would actually take. Deferred is not the same as forgotten, and it is
not the same as "nearly done".

## Compensation planning

**Status: built.** See `docs/COMPENSATION.md`.

This was deferred, assessed, and then asked for. It was built with the
safeguards the deferral said it needed, each of which is a constraint in the
code rather than a line in a document:

| What the deferral said it needed | Where it is |
| --- | --- |
| Integer minor units, no floating point | `src/lib/money.ts`, 34 unit tests |
| A separate role, not implied by `HR_ADMIN` | `COMPENSATION_ADMIN` in `src/server/authz/policy.ts`, pinned by tests |
| Append-only pay history | `CompensationRecord`; a correction is a new row |
| Recommendation always editable, override recorded with a reason | `recommendIncrease` populates, a person decides, the override is refused without a rationale |
| Budget pools with a ceiling | Enforced at submission, reported before it |
| Planning state separate from approved state | `DRAFT → PLANNING → IN_APPROVAL → APPROVED → APPLIED`, and approving is not applying |

Two things the deferral listed are still not built, and are listed below rather
than quietly dropped:

- **Printable statements.** No compensation statement for an employee to keep.
  The data is there; the document is not.
- **A defined export.** There is no compensation CSV export. The deferral said
  the audience should be defined before it is built, and it has not been.
  Nothing exports salary today, which is the safe default.

Also not built, and worth stating:

- **Proration for mid-year starters.** An increase is applied to the current
  base in full. Somebody who started in October gets the same percentage as
  somebody who started in January. If that is wrong for this company it is a
  policy decision to make before the first real cycle, not a bug.
- **Multi-currency.** The schema carries a currency per record and per cycle,
  and the arithmetic is currency-agnostic, but nothing converts between
  currencies and no screen mixes them. One currency per cycle.
- **Variable pay.** Bonus, commission and overtime are out of scope. This
  handles annual base salary only, which for a construction company leaves the
  Sales Manager's commission outside the application entirely.

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
