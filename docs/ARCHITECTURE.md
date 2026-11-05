# Architecture

## Stack

| Choice | Version | Why |
|---|---|---|
| Next.js App Router | 15.5 | Server components mean permission checks run on the server by default; a page has to opt *in* to client-side rendering, not opt out of leaking |
| React | 19.3 | Comes with it |
| TypeScript (strict) | 5.9 | The permission model leans on exhaustive unions; `strict` is what makes a missing branch a build error |
| Prisma | 6.19 | Typed queries, and migrations that are reviewable SQL |
| SQLite (dev) / Postgres-ready | — | Runs with no database server to install; the schema uses no SQLite-specific features |
| Tailwind | 3.4 | Brand colours as CSS variables, so re-branding needs no rebuild |
| Vitest | 2.1 | Unit tests for the pure engines |
| Playwright | 1.64 | Real browser tests; the only way to catch a permission bug that a page redirect hides |

Scale as built: 56 models, 55 pages, 93 API routes, 20 services, 134 unit tests.

### Why not a separate API server

One deployable unit, one session mechanism, one place where authorization lives.
A separate API would have meant a second authentication path and two
implementations of the same permission rules — and divergence between those two
is the most likely way this application would develop a real security hole.

## Layering

```
  src/app/(app)/**           Pages. Server components. requireActor() then render.
  src/app/api/**             REST routes. Thin: parse, call a service, return.
         │
         ▼
  src/server/services/**     ← THE ENFORCEMENT LAYER. Everything goes through here.
         │
         ├── authz/policy.ts      Pure predicates. No database.
         ├── authz/actor.ts       Resolves the actor and the reporting graph.
         ├── authz/history.ts     Reporting line as it stood on a past date.
         ├── scoring/**           Pure. Review scores, goal progress.
         ├── surveys/privacy.ts   Pure. Suppression rules.
         ├── validation/**        Zod schemas at every write boundary.
         └── db.ts                Prisma singleton.
```

**The rule that matters: a page and an API route call the same service
function.** Neither contains a permission decision of its own. This is what
makes the claim "the rules hold for a direct API request" true rather than
aspirational — there is no second code path to keep in step.

The pure modules (`policy`, `scoring`, `privacy`) take plain data and return
plain data. That is what lets 134 unit tests cover the parts that would
otherwise need a database and a fixture per case, and it is why a scoring rule
can be checked against hand arithmetic (see [SCORING.md](SCORING.md)).

### Three-layer authorization, one boundary

| Layer | Purpose | Boundary? |
|---|---|---|
| `src/middleware.ts` | Redirect visitors with no session cookie | No — Edge runtime, cannot reach the database, only checks a cookie exists |
| Pages | Redirect or `notFound()` for the wrong role | No — cosmetic; stops a click, not a request |
| Services | Policy predicates before every read and write | **Yes** |

Treating the first two as the boundary is how the `canManageOrgSettings` bug
survived until a test called the route instead of clicking the button. See
[PERMISSIONS.md](PERMISSIONS.md).

## Data model decisions

### No Prisma enums

SQLite does not support them. Enumerated values are string columns, with the
single source of truth in `src/lib/enums.ts` as `as const` arrays plus derived
TypeScript unions, validated by Zod at every write boundary.

The cost is real: a wrong string is caught at the write boundary rather than by
the database. The benefit is that the database, the API contracts and the UI
labels cannot drift apart, and the application runs on SQLite with nothing to
install.

Where a value is used in a query filter rather than written, the array should be
typed as the union — `readonly ParticipantStatus[]` — so a non-existent state
fails the build. One bug found exactly here: a calibration filter listed
`SUBMITTED` and `IN_APPROVAL`, which are *assignment* statuses, not participant
ones. Nothing errored; the query silently matched only `APPROVED` and left half
the eligible cohort out of every session. Typing the constant fixed it and makes
a repeat a compile error.

### Append-only history

`ManagerAssignment` records every reporting-line change with
`effectiveFrom`/`effectiveTo` and is never overwritten. `AuditEvent` is never
updated or deleted by application code. Both exist so that "what was true then"
is a question with an answer.

### Launch-time snapshots

`CycleParticipant` stores the manager, manager name, job title and department as
they were when the cycle launched, plus `snapshotTakenAt`. Access to a
historical review resolves against that snapshot, not today's org chart.

Snapshotting the *names* as well as the ids is deliberate: a report on a
three-year-old review should show the job title the person held then, not the one
they hold now.

### Template versioning

A `ReviewCycle` references a `ReviewTemplateVersion`, never a `ReviewTemplate`.
Publishing a version sets `publishedAt` and freezes it; editing a published
version forks a new one by copy. A completed review therefore shows exactly the
questions, scales and weights it was answered against, however much the template
has changed since.

The weights used to compute a final score live on the version too, so adjusting
weights for next year cannot move last year's numbers.

### Scores stored with their inputs

`CycleParticipant.finalScoreJson` holds the full breakdown, not just the number,
along with `SCORING_RULE_VERSION`. A score can be explained line by line years
later even if the rules have changed since, and a rule change does not silently
re-derive old scores.

A calibrated score is stored *alongside* the computed one rather than replacing
it, so a human adjustment is always distinguishable from arithmetic.

## Request lifecycle

1. `middleware` checks for a session cookie; no cookie means redirect (or 401
   for an API path).
2. The page or route calls `requireActor()`, which resolves the session from the
   database, loads the user, roles and employee record, and builds the reporting
   graph in one query.
3. A service function is called with the actor. It applies policy predicates,
   builds a `where` clause that reflects them, and reads or writes.
4. Mutations record an audit event and, where relevant, queue a notification.
5. Pages render from the result; client components call REST routes and then
   `router.refresh()`, so the page re-renders from the database and on-screen
   counts always match stored data.

### Session handling

Cookie sessions. The cookie holds an opaque random token; only its SHA-256 is
stored, so a database leak does not yield usable sessions. Passwords use `scrypt`
(N=32768, r=8, p=1) with a per-password salt. Suspending an account or changing a
password revokes sessions immediately rather than waiting for expiry.

`SESSION_SECRET` is reserved for signed artefacts; sessions themselves need no
secret because the token is random and compared by hash.

## Scaling the reporting graph

`loadReportingGraph` fetches every `(id, managerId)` pair for the organization
and walks it in memory. At the scale this targets — one company, hundreds of
employees — that is a single indexed query and far cheaper than repeated
recursive ones.

At tens of thousands of employees it should become a recursive CTE
(`WITH RECURSIVE`) or a materialized closure table. The call sites are
`loadReportingGraph`, `collectDescendants` and `collectManagerChain`; nothing
else touches the structure, so the change is contained.

Cycle protection is already present: both walks keep a `seen` set, so bad data
with a reporting loop cannot hang a request.

## Charts

Hand-built SVG in `src/components/charts`, with a validated palette in
`palette.ts`: three categorical slots, an ordinal blue ramp, a fixed status
palette where every colour is paired with an icon and a label, stated
denominators, direct labels, a data-table view of every chart, and no dual axes.

No charting library, because the constraints that matter here — legibility in
both themes, accessible colour pairing, honest axes, a table fallback — are
easier to guarantee in a few hundred lines than to configure around.

Chart props are serializable (`valueFormat: 'percent'`, not a formatter
function), because a function cannot cross the server/client boundary.

## Testing strategy

**Unit tests (134)** cover the pure engines: review scoring, goal progress,
survey suppression, the permission matrix, the AI provider boundary. No database,
so every branch is cheap to assert and the documented worked examples are
verified against the real functions.

**Browser tests** drive a real browser against a running server. They exist
because the bugs that matter here are the ones a unit test cannot see:

- A permission hole behind a page redirect. Every access test calls the API
  route as well as visiting the page.
- A hydration mismatch from clock-derived defaults or invalid HTML nesting.
  Three real mismatches and one invalid `<table>` nesting were found this way.
- A control that renders but does nothing.
- An assertion that passes for the wrong reason. Several did: a URL predicate
  that also matched `/development/new`, and a text match that found the textarea
  it had just typed into rather than the saved record. Both are fixed; the
  lesson is to assert on what the server re-rendered, not on what is on screen.

The app shell carries `data-hydrated` so tests never interact before hydration.

## Extension seams

| Want to change | Touch |
|---|---|
| E-mail delivery | `src/server/email/transport.ts` — one `send` function |
| File storage | `src/server/storage/files.ts` — four functions |
| AI provider | `src/server/ai/provider.ts` — one `suggest` function |
| Identity / SSO | `User.externalIdpSubject` plus a sign-in path |
| HR system import | `src/server/services/employee-import.ts` already does the hard part (mapping, validation, duplicate detection, preview) |
| Postgres | Change the datasource, regenerate migrations |

Each is deliberately a narrow interface with the policy and audit work already
done around it.
