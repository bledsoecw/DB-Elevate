# Permissions

This document describes what the code does. Every rule below is a function in
`src/server/authz/policy.ts`, and most are asserted in
`tests/unit/policy.test.ts` (51 tests). Where this document and the code
disagree, the code is right and this document is a bug.

## Where enforcement happens

Three layers, and only one of them is the security boundary.

| Layer | What it does | Is it the boundary? |
|---|---|---|
| `src/middleware.ts` | Redirects visitors with no session cookie | **No.** The Edge runtime cannot reach the database, so it only checks that a cookie exists. |
| Pages | `requireActor()`, then redirect or `notFound()` | **No.** A page redirect is cosmetic; it stops a click, not a request. |
| Services | Pure predicates from `policy.ts`, called before any read or write | **Yes.** |

Every REST route calls the same service function the page calls. There is no
endpoint that trusts a client-supplied role, and no screen that fetches more
than it shows and hides the rest in the view. This matters because a page
redirect is trivially bypassed by typing a URL into `fetch`, and a filtered-in-
the-view result has already left the database.

One bug found by testing exactly this distinction: `canManageOrgSettings`
returned true for `HR_ADMIN` as well as `SYS_ADMIN`. Every screen correctly
refused an HR administrator, but a direct `PATCH /api/admin/settings` succeeded
— letting them rewrite branding, lower a survey privacy threshold, change the
mail provider or enable a metered AI service. It is fixed, and six unit tests
now pin the whole administrative matrix. The lesson is in the method: test by
calling the route, not by clicking the button.

## Roles

Four granted roles, stored in `UserRole` and additive. Every grant and
revocation is audited.

### System administrator (`SYS_ADMIN`)

Runs the application. Accounts, roles, branding, organization settings, mail
configuration, AI configuration, the audit log, demonstration-data removal.

**Grants no access to review content, private notes, HR-restricted records or
anybody else's performance data.** `reportScope()` returns `SELF` for a system
administrator who manages nobody, exactly as it would for any other employee.
This is the single most load-bearing decision in the model: the person who can
reset passwords is not thereby entitled to read what their colleagues wrote
about each other.

### HR / program administrator (`HR_ADMIN`)

Runs the performance programme. People records, templates, cycles, surveys,
calibration, competencies, scales, recognition values, HR-restricted records,
the exceptions worklist, organization-wide reporting.

**Grants no application administration.** No accounts, no roles, no branding,
no mail or AI settings.

### Leadership (`LEADERSHIP`)

Organization-wide aggregate reporting, and may be named as a review approver.
No individual drafts, no private notes, no improvement plans.

### Employee (`EMPLOYEE`)

Own records plus whatever is explicitly shared. Held by every account, and
cannot be revoked — removing it would leave an account that can sign in and see
nothing. To stop someone signing in, suspend the account.

### Manager — not a role

Someone is a manager because people report to them. There is no checkbox.
`Actor.directReportIds` and `Actor.descendantIds` are computed per request from
the reporting graph.

### Both administrative roles

Granted explicitly to one person when genuinely needed. The grant is audited,
which is the point of requiring it to be deliberate.

## The history rule

**Changes to today's reporting structure must not alter historical review
records or grant inappropriate access.** Two mechanisms:

1. **`ManagerAssignment` is append-only.** Every reporting-line change writes a
   row with `effectiveFrom` / `effectiveTo`. Nothing is overwritten, so the
   structure on any past date is recoverable.

2. **Launching a cycle snapshots it.** `CycleParticipant` stores
   `managerIdSnapshot`, `managerNameSnapshot`, `jobTitleNameSnapshot`,
   `departmentNameSnapshot` and `snapshotTakenAt`.

Historical review access is then resolved against the snapshot, never against
today's org chart. `participantAccess(actor, participant, snapshotChainIds)`
returns:

| Result | When |
|---|---|
| `SUBJECT` | The actor is the employee being reviewed |
| `HR` | The actor is an HR administrator |
| `MANAGER_OF_RECORD` | The actor is `participant.managerIdSnapshot` |
| `UPPER_CHAIN_OF_RECORD` | The actor was in the chain above at launch |
| `NONE` | Everyone else |

So: if Rosa managed Jamal during the 2025 cycle and Grant manages him now,
Rosa keeps access to the 2025 review she wrote and Grant does not get it. If
Grant later becomes Jamal's manager, he gets access to *future* cycles, not past
ones. Transfers, promotions and reorganizations all behave this way, and so does
deactivation — a deactivated manager's past reviews remain attributed to them.

## Review content

`canViewAssignmentContent(actor, cycle, participant, assignment, access)`.

**Draft content belongs to its author alone.** Nobody — not the manager, not
HR, not leadership, not a system administrator — reads an unsubmitted form.
Administrators see *that* a review is in progress and whether it is late; the
words inside are not theirs until submitted. There is no override, no "HR may
view in exceptional circumstances" branch.

Once submitted:

| Reviewer kind | Author | Manager of record / upper chain | HR | The employee |
|---|---|---|---|---|
| Self | Always | If `cycle.shareSelfWithManager` | Yes | After release |
| Manager | Always | Yes | Yes | After release |
| Peer, `NAMED` | Always | Yes, with the name | Yes, with the name | After release if `sharePeerWithEmployee`, with the name |
| Peer, `CONFIDENTIAL` | Always | Yes, without the name | Yes, name visible to HR | After release if shared, without the name |
| Peer, `ANONYMOUS_AGGREGATE` | Always | **Never item by item** | **Never item by item** | **Never item by item** |
| Skip-level, upward | Always | Yes | Yes | After release |

`ANONYMOUS_AGGREGATE` is withheld even from HR. The promise made to the peer
reviewer was that their input would only ever be shown combined with others', and
a role that can read it individually breaks that promise regardless of who holds
the role. Aggregation additionally requires at least
`Organization.peerReviewMinForAggregate` responses (default 3) — two peers
averaged is two peers identified.

The employee sees nothing until release. Release is a separate, deliberate step
so the conversation can happen before the record appears.

### Editing and lifecycle

- Only the assigned reviewer edits their own assignment, and only in
  `NOT_STARTED`, `DRAFT` or `REOPENED`.
- Submission is guarded against double-submit by a conditional `updateMany`.
- A released review cannot be edited. Reopening is an HR action, is audited, and
  moves the assignment back to `REOPENED` rather than silently unlocking it.
- Acknowledgement is available to the subject only, only in `RELEASED`, and
  **records receipt, not agreement.** The interface says so where it is
  captured.

## Private notes

`canViewMeetingNote` — a note with visibility `PRIVATE` is visible to its author
and to nobody else. There is no role override. HR cannot read it. A system
administrator cannot read it. It is excluded from AI context assembly by the
query, not by filtering a result.

Feedback with visibility `PRIVATE_NOTE_SELF` behaves the same way.

## Feedback audiences

| Visibility | Who can read it |
|---|---|
| `PRIVATE_NOTE_SELF` | The author only |
| `RECIPIENT_ONLY` | The subject, and HR |
| `RECIPIENT_AND_MANAGER` | The subject, their management chain, HR |
| `MANAGER_ONLY` | The management chain, HR — not the subject |
| `DEPARTMENT` | The subject, their chain, their department, HR |
| `ORGANIZATION` | Everyone |
| `HR_ONLY` | HR administrators only |

Authors can always read what they wrote. `MANAGER_ONLY` is restricted to the
management chain and HR when *writing*, so it cannot be used to snipe at
somebody behind their back from outside their line.

### Confidential is not anonymous

These are different things and the interface says which is which before
submission.

| Mode | Author stored? | Name shown to |
|---|---|---|
| `NAMED` | Yes | Anyone who can see the item |
| `CONFIDENTIAL` | **Yes** | HR administrators only |
| `ANONYMOUS` | **No** | Nobody — there is nothing to reveal |

Confidential means *we know and we are not telling*. Anonymous means *we did not
record it*. `ANONYMOUS` is restricted to the `HR_ONLY` audience, because an
unattributable comment delivered to a manager about a named person is a weapon,
not feedback.

## Goals

`canViewGoal` resolves against the goal's visibility, the owner's current
management chain, the actor's department, and collaborator membership. Company
goals are readable organization-wide; a private goal is the owner's and their
chain's. Creating a company goal requires HR or leadership.

Goals use the owner's **current** chain, not a snapshot. A goal is a live
object — if someone's manager changes, the new manager should see the goal they
are now accountable for. This differs deliberately from reviews, which are a
record of a past assessment.

## Development and improvement plans

`canViewPlan`:

| | Development plan | Improvement plan (`PERFORMANCE_IMPROVEMENT`, or `hrRestricted`) |
|---|---|---|
| The employee | Yes | Yes |
| Direct manager | Yes | Yes |
| Wider chain | Yes | **No** |
| Leadership | Via the chain only | **No** |
| HR | Yes | Yes |
| System administrator | **No** | **No** |

`hrRestricted` is forced true on creation for an improvement plan regardless of
what the client posted, and relaxing it afterwards is refused with 409 — the
plan was written on that understanding.

On an improvement plan the employee has `canRecordProgress` but not `canEdit`:
they can mark an action complete, which is how they demonstrate they met the
plan, but they cannot add, reword, remove or cancel one. Cancelling an action is
treated as a change to the terms.

## Surveys

See [PRIVACY.md](PRIVACY.md) for the anonymity model, which is the substantial
part. In permission terms: HR and leadership can view results, HR can view
participation, and nobody can view an anonymous respondent's identity because it
is not stored.

## Reporting and exports

`reportScope(actor)`:

| Scope | Who | Covers |
|---|---|---|
| `ORGANIZATION` | HR, leadership | Everyone |
| `TEAM` | Anyone with direct reports | Themselves and their whole downward chain |
| `SELF` | Everyone else | Themselves |
| `NONE` | An account with no employee record | Nothing |

**Exports use the same scope as the screens**, because the export routes call
the same service functions. A CSV cannot contain a row the requester could not
see on a page, and survey exports go through the same suppression as the charts.

## Attachments

An attachment has no visibility of its own. It inherits the record it hangs off,
re-resolved on every single read — no cached grant, no signed URL, no path that
returns bytes without first loading the owning record and asking the same policy
function the screen asks. Files live outside `./public` under opaque generated
keys, so there is no URL that maps to the filesystem.

Write access is stricter than read in one place: a reviewer may attach evidence
to their own draft, but nobody attaches anything to a submitted review.

Owner types are a closed set (`review_assignment`, `goal`, `development_plan`,
`meeting`, `employee`). Adding one means adding a branch that fails the build
until handled, rather than defaulting to allowed for a record nobody considered.

## Deactivation

Deactivating an employee:

- Ends their sessions and prevents sign-in.
- Keeps every record: their reviews, the reviews they wrote, their goals, their
  feedback. History is not rewritten because somebody left.
- Leaves their past reviews attributed to them.
- Surfaces their open review assignments in the exceptions worklist for
  reassignment, rather than silently reassigning or dropping them.
- Stops all notification and e-mail queueing to them.

Suspending an *account* is separate from deactivating an *employee*. The first
is an access decision by a system administrator; the second is a personnel
decision by HR.

## Deliberate non-features

Things that could have been built and were not, because they would undermine the
model:

- **No "view as" / impersonation.** It would make the audit log a record of who
  pretended to be whom.
- **No break-glass override for private notes or drafts.** A protection with an
  exception is a protection nobody relies on.
- **No role that implies another.** `SYS_ADMIN` does not imply `HR_ADMIN`. Both
  are granted explicitly or not at all.
- **No client-side permission decisions.** The browser is told what to render;
  it is never asked what is allowed.
