# Progress

Build state, so another session can continue accurately without re-deriving the
reasoning. Current as of 2026-11-05.

## Where things stand

The application is complete and working against the brief: every module is
built, every visible control does something, and no internal link is dangling.
549 automated checks pass (216 unit, 43 workflow, 290 supplementary browser).
See [VERIFICATION.md](VERIFICATION.md) for what that covers and — more usefully
— what it does not.

## Commit history

| Commit | What it added |
|---|---|
| `f8c47e7` | Schema, auth, authorization, scoring engines, seed data |
| `e501575` | Application shell, authentication, the complete review workflow |
| `843c2bc` | Services for people, import, goals, feedback, meetings, surveys |
| `f992567` | People, goals, feedback, meetings and surveys screens |
| `2c2ed85` | Reporting with scoped queries and comparability caveats |
| `64e395c` | Template builder and review cycle management |
| `ca10f98` | Competency, rating scale and recognition value administration |
| `bbd5a3b` | System administration, and closing a role-separation hole |
| `5bd1707` | Calibration sessions with recorded human decisions |
| `a1be955` | Development plans, improvement plans, the account page |
| `a94d522` | Scheduled jobs, private attachments, optional AI scaffolding |
| `a94d522`+ | Documentation, committed browser suites, build fix, layout fixes |
| *(later)* | PerformYard layout, branding, competencies, compensation, SSO, PostgreSQL and the Vercel deployment |
| *(this one)* | Job title and department management — the two pickers on an employee record had no write path at all |

Branch: `main`, which is also the Vercel production branch. The earlier work
was done on `claude/great-hawking-djo6w0` and merged.

## Layout of the code

```
prisma/
  schema.prisma            56 models
  seed.ts, seed/           deterministic demonstration data
src/
  app/(app)/**             55 pages, server components
  app/api/**               93 REST routes, thin wrappers over services
  server/
    authz/                 policy.ts (pure), actor.ts, history.ts
    services/              20 services — THE enforcement layer
    scoring/               review-score.ts, goal-progress.ts (pure)
    surveys/privacy.ts     suppression rules (pure)
    validation/            Zod schemas per domain
    jobs/, email/, ai/, storage/
  components/              primitives, forms, charts, app shell
tests/
  unit/                    134 tests, no database
  e2e/                     43 checks, review workflow and permissions
  browser/                 120 checks, the modules built after e2e
docs/                      the documents listed in the README
```

## If you are picking this up

**Read first:** [DECISIONS.md](DECISIONS.md). Most of what looks like an odd
choice in this codebase is a deliberate one with a reason, and the reasons are
there rather than in commit messages.

**The three rules that hold the design together:**

1. A page and an API route call the same service function. Neither contains a
   permission decision of its own. If you add a route that reads from Prisma
   directly, you have created the gap this design exists to prevent.
2. Historical review access resolves against the launch-time snapshot, never
   today's org chart. Goals deliberately work the other way.
3. Missing information is excluded and reported as reduced coverage, never
   counted as zero.

**When adding a feature**, the order that works: schema → service with its
policy check → validation schema → API route → page → a browser check that
calls the route as a user who should be refused.

**Testing rule learned the hard way:** assert on what the server re-rendered,
not on what is on screen, and never on a predicate that is already true before
the action. Three assertions in this project passed for the wrong reason before
being caught; `tests/browser/README.md` lists them.

## Immediate next priorities

In the order I would do them.

1. **Get real people in.** The first-run path now exists (`npm run setup:blank`
   then `npm run create-admin`), and CSV import is built and works on an empty
   organization. This is the step that turns a demonstration into something
   useful, and everything below matters less until it is done.

2. **Run the backup and restore procedure end to end.** It is written in
   [DEPLOYMENT.md](DEPLOYMENT.md) from the schema and storage layout but has
   never been executed. It is the highest-value unverified thing here, because
   it is the one that matters on the worst day.

3. ~~**Generate and test the PostgreSQL migration.**~~ **Done.** The datasource
   is PostgreSQL, SQLite support is gone, and the full suite was re-run against
   a real PostgreSQL 16 — which is how the case-sensitivity bug in every search
   box was found. See [VERIFICATION.md](VERIFICATION.md).

4. **Run an accessibility audit.** Labels, focus management, heading order and
   contrast were built in and spot-checked, but no axe pass and no screen-reader
   pass has been done. Start with the review form and the results page, since
   those are the screens every employee has to use.

5. **Add survey editing.** There is no edit path at all, so a typo means
   creating the survey again. It must refuse to change `mode` on a launched
   survey and refuse to change questions once any response exists — the same
   freezing logic published template versions already use.

6. **Implement e-mail delivery** if real notifications are wanted. One function
   in `src/server/email/transport.ts`, plus `EMAIL_TRANSPORT_CONFIGURED=true`.
   Everything around it — queueing, idempotency, the outbox, the held-not-sent
   reporting — is done.

7. **Profile at realistic scale.** Seed several thousand employees and look at
   the reporting graph and the report queries. The in-memory graph walk is the
   first thing that will need replacing; see
   [ARCHITECTURE.md](ARCHITECTURE.md).

8. **Bulk reviewer reassignment.** The exceptions worklist surfaces reviews
   assigned to deactivated people one at a time, which is tedious for a real
   departure.

Deferred deliberately, with reasoning: advanced talent views, live AI, external
integrations — [EXTENSION-PLAN.md](EXTENSION-PLAN.md). Compensation planning was
deferred, then asked for, and is now built; three things inside it are still
deferred and listed there (printable statements, a defined export, proration).

## Things to be careful about

- **`src/lib/enums.ts` is the single source of truth** for every enumerated
  value. When using one in a *query filter*, type the constant as the union
  (`readonly ParticipantStatus[]`), because the write-boundary validation never
  sees that case. A filter listing non-existent statuses silently narrows a
  query and nothing errors.

- **`npm run typecheck` passing is not evidence that the app builds.** Next
  validates route handler signatures more strictly than this project's tsconfig.
  Run `npm run build` before claiming a change is clean.

- **The dev server can serve a stale component** after an edit to the app shell.
  If a change seems not to apply, restart it before concluding the change is
  wrong.

- **`server-only` needs the `react-server` export condition** outside Next —
  hence `--conditions=react-server` in the jobs script and `resolve.conditions`
  in the vitest config. Do not solve a resolution error by deleting the import;
  it is what keeps server modules out of client bundles.

- **The browser suites write to the database.** Reseed afterwards.

- **Never reuse `TableWrap` with your own `<table>`** — it renders one already.
  That mistake produced a real hydration failure on three pages.

- **A model with no write path is an empty picker, not a compile error.**
  `Department` and `JobTitle` could only be created by the seed for most of
  this project's life, so a real installation opened the employee form and
  found two dropdowns with nothing in them, and nothing anywhere said so. The
  check that finds this is comparing the models in `prisma/schema.prisma`
  against the models something actually calls `create`, `createMany` or
  `upsert` on (nested `relation: { create: … }` counts). As of the audit the
  only remaining one is `ScheduledJob`, which is dead rather than missing — see
  the known limitations in the README.
