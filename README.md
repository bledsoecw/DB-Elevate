# DB Elevate

An employee performance management platform: reviews, goals, continuous
feedback, one-on-ones, engagement surveys, development plans and reporting.
Built for a construction and remodeling company as its first rollout, but
nothing about that is hard-coded — departments, job titles, competencies,
rating scales, templates and reporting lines are all configuration.

## Running it

Needs Node 20 or later (built and tested on 22). From a fresh clone:

```bash
npm run setup
```

That creates `.env` from `.env.example` with a generated `SESSION_SECRET`,
installs dependencies, applies migrations, generates the Prisma client and
seeds a demonstration organization. An existing `.env` is never overwritten.

```bash
npm run dev
```

The application is then at **http://localhost:3000 on the machine running that
command**. If you started it somewhere else — a container, a remote box, a
cloud session — `localhost` on your own computer will not reach it; use that
host's address, or run the two commands above locally.

### Signing in

The seed creates a synthetic company, *Dreambuilder Construction & Remodeling*,
with 27 employees. Every demonstration account uses the same password:

```
ElevateDemo!2026
```

Override it with `SEED_PASSWORD` before seeding if you prefer. Five accounts
worth starting from, because they see genuinely different things:

| Sign in as | Role | What it shows |
|---|---|---|
| `priya.raghunathan@dreambuilder.example` | HR / program administrator | Templates, cycles, surveys, calibration, everyone's records |
| `terrence.okafor@dreambuilder.example` | System administrator | Accounts, roles, branding, audit log — and *no* review content |
| `rosa.delgado@dreambuilder.example` | Manager, 5 direct reports | Team reviews, team goals, one-on-ones |
| `marcus.villanueva@dreambuilder.example` | Leadership + approver | Aggregate reporting, review approvals |
| `yuki.tanabe@dreambuilder.example` | Employee, no reports | Own reviews, own goals, feedback received |

Signing in as two of these in turn is the quickest way to see the permission
model working, because it is the part of this application that most of the
design effort went into.

The sign-in page also offers one-click demo buttons when `ENABLE_DEV_LOGIN` is
`true`. They perform a **real password sign-in** against the same endpoint as
the form — they do not bypass authentication, and they are ignored entirely
when `NODE_ENV=production`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (134) — scoring, goal progress, survey privacy, permissions, AI provider |
| `npm run test:e2e` | Browser tests against a running server, after a fresh seed |
| `npm run test:all` | Both |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations without generating one (production) |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run db:seed` | Seed the demonstration data |
| `npm run jobs:run` | Reminders, survey transitions, e-mail delivery |
| `npm run jobs:dry-run` | The same without delivering e-mail |

## What is here

Everything in this list is built and works against stored data. Known
limitations are in their own section below, not hidden in this one.

**Reviews.** A template builder with sections, instructions, written responses,
rating scales, multiple choice, competency assessments and goal questions, each
required or optional and individually weighted. Templates carry version history
and publishing freezes a version — editing a published version creates a new one
by copy, so a review completed last year still shows exactly the questions it
was answered against. Cycles run Draft → scheduled → collecting → submitted →
approval → released → acknowledged → closed, with self, manager, peer,
skip-level and upward reviewers, draft autosave with a visible save state,
required-field validation, submission confirmation, progress tracking,
reminders, controlled reopening, release and acknowledgement. Launching a cycle
snapshots the template version, the reporting line, the job title and the
department onto each participant.

**Scoring.** Explicit, testable rules. A question nobody answered is excluded
and lowers reported coverage; it is never counted as zero. Peer scores are
averaged before being weighted. A missing component drops out and the remaining
weights renormalize. Drafts never contribute. Every score can be expanded to
show how it was calculated, and a human adjustment is shown beside the
arithmetic rather than replacing it. See [docs/SCORING.md](docs/SCORING.md).

**Goals.** Individual, team and company goals with collaborators, measurable
targets or milestones, a progress history, and explicit rules distinguishing
progress a person reported from progress computed from a target. Where the two
disagree, both are shown.

**Feedback and recognition.** Request, give and review feedback, with the
audience stated before submission. *Confidential* and *anonymous* are treated as
genuinely different things: a confidential author is stored and visible to HR,
an anonymous author is not stored at all.

**One-on-ones.** Shared agendas, shared notes, separately protected private
notes, action items and carry-forward of unfinished items.

**Surveys.** Named or anonymous, declared before launch and not changeable
afterwards. For anonymous surveys no respondent identifier is written to the
answer records or the audit log, participation is tracked separately from
answers, and a documented minimum-response threshold suppresses small groups and
identifying filter combinations — in the screens *and* in the exports, because
both call the same function. See [docs/PRIVACY.md](docs/PRIVACY.md).

**Development.** Development plans, and performance improvement plans as a
restricted personnel record. Competency libraries by role with written
behavioural descriptors per career level. Calibration sessions that record who
decided what and why.

**Reporting.** Completion, participation, rating distributions, goal progress,
action-item progress and survey results, with stated denominators, filters,
drill-downs and CSV export. Exports go through the same permission checks as the
screens. A trend across cycles that used different templates is still drawn, but
it carries a caveat naming which templates differed and saying why the periods
are not strictly comparable — a score is a position on its own template's rating
scale, so the direction is indicative rather than a like-for-like measurement.
Released reviews print cleanly.

**Administration.** Employee directory and profiles, CSV import with field
mapping, validation, duplicate detection and a preview that is the contract the
commit honours. Competencies, libraries, rating scales, recognition values,
organization settings, branding, accounts and roles, an append-only audit log,
a local e-mail outbox, optional AI configuration, demonstration-data removal,
and an exceptions worklist.

## Roles

| Role | Grants |
|---|---|
| **System administrator** | The application: accounts, roles, branding, integrations, the audit log. **No** access to review content, private notes or HR-restricted records. |
| **HR / program administrator** | The performance programme: people records, templates, cycles, surveys, calibration, restricted records. **No** keys to the application. |
| **Leadership** | Aggregate reporting across the organization. No individual drafts, no private notes. |
| **Employee** | Own records, plus whatever is explicitly shared. Held by every account. |

**Manager is not a role.** It is structural: someone is a manager because people
report to them. For a historical review it is resolved against the reporting
line *as it stood when that cycle launched*, so a reorganization cannot
retroactively open an old review or close one somebody should still be able to
read. The full matrix is [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Known limitations

Stated plainly, because a feature list that hides these is not useful.

- **One organization.** Records are scoped by `orgId` throughout and a second
  organization could be added without the two seeing each other, but there is no
  tenant-selection UI and that path is untested.
- **No live e-mail.** Messages are queued and readable at
  `/admin/outbox`. Delivery needs a mail client implemented and
  `EMAIL_TRANSPORT_CONFIGURED=true`; the contract is one function. This is
  deliberate — nothing reaches a real employee without an explicit decision.
- **No live AI.** The mock provider works fully and costs nothing. A paid
  provider needs its HTTP call implemented *and* `AI_BILLING_APPROVED=true`.
  The application is complete without it.
- **No compensation planning.** Assessed and deliberately deferred; see
  [docs/EXTENSION-PLAN.md](docs/EXTENSION-PLAN.md) for why, and what it would
  need.
- **No SSO.** Password sessions only. An adapter seam exists
  (`User.externalIdpSubject`) but no provider is wired.
- **SQLite by default.** The schema is Postgres-compatible and uses no SQLite-
  specific features, but the committed migration is SQLite's. Moving to Postgres
  means changing the datasource and regenerating migrations.
- **Reporting graph held in memory.** The reporting structure is loaded and
  walked in memory, which is far cheaper than recursive queries at this scale
  (hundreds of employees) and would need a recursive CTE at tens of thousands.
- **Attachments on local disk.** Private and permission-checked, but on the
  application's own filesystem; object storage means reimplementing four
  functions in `src/server/storage/files.ts`.
- **Surveys cannot be edited after creation.** There is no survey edit path at
  all — create, launch, close and remind is the whole surface. A typo in a
  question means creating the survey again. (The mode being unchangeable is
  deliberate and should stay; the rest is a gap.)
- **Browser tests need a running server.** They are not hermetic and they seed
  the database first, so do not point them at anything you care about.

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, layering, where enforcement lives, scaling notes |
| [PERMISSIONS.md](docs/PERMISSIONS.md) | The full matrix, and how history is protected from reorganization |
| [SCORING.md](docs/SCORING.md) | Every scoring rule, worked by hand |
| [PRIVACY.md](docs/PRIVACY.md) | Private notes, confidential vs anonymous, survey suppression |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment, migrations, jobs, backup and restore, recurring costs |
| [EXTENSION-PLAN.md](docs/EXTENSION-PLAN.md) | Compensation planning, talent views, integrations, live AI |
| [VERIFICATION.md](docs/VERIFICATION.md) | What was tested, what passed, what remains unverified |
| [DECISIONS.md](docs/DECISIONS.md) | Decisions that are not obvious from the code, and why |
| [PROGRESS.md](docs/PROGRESS.md) | Build state, so another session can continue accurately |

## Demonstration data

Every seeded record carries `isDemoData` (or `isDemoAccount`), which is how
`/admin/demo-data` can count and remove them exactly rather than guessing from
a name pattern. Names, addresses and review text are invented and the e-mail
domain is `.example`, which cannot receive mail. No real person is described.

Removing it keeps the configuration — departments, job titles, competencies,
scales, templates — because that is a reasonable starting point for a real
rollout, and keeps the audit log, because deleting history to tidy up is what an
append-only log exists to prevent.
