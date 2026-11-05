# Supplementary browser suites

Standalone scripts that drive a real browser against a running server. They
complement `tests/e2e/` (the review workflow and the core permission matrix)
and cover the areas built after it.

Each one is deliberately written the same way: **every access-control check
calls the REST route as well as visiting the page.** A page redirect hides a
permission hole rather than preventing it, and the one real authorization bug
found in this project was invisible to anything that only clicked buttons.

## Running them

Start the application first — these are not hermetic and they write to the
database.

```bash
npm run dev          # terminal 1
npm run test:browser # terminal 2
```

Or individually:

```bash
node tests/browser/catalog-test.js
node tests/browser/admin-test.js
node tests/browser/calibration-test.js
node tests/browser/development-test.js
node tests/browser/infra-test.js
node tests/browser/competencies-test.js
node tests/browser/compensation-test.js
node tests/browser/compensation-flow-test.js      # mutates the cycle
node tests/browser/compensation-budget-test.js    # mutates the cycle
node tests/browser/layout-check.js /tmp/shots

# Needs a server started with the demo panel enabled:
ENABLE_DEV_LOGIN=true npx next dev --turbopack -p 3100 &
node tests/browser/devlogin-test.js http://localhost:3100
```

Each exits non-zero if any check fails, so they work in CI once a server is up.

They assume the seeded demonstration organization and the default
`ElevateDemo!2026` password. **Do not point them at an installation with real
data** — they create plans, sessions, scales and competencies, and several
toggle organization settings.

## What each covers

| Script | Checks | Covers |
|---|---|---|
| `catalog-test.js` | 16 | Competency ladders, competency libraries, rating-scale freezing, recognition values, and that an employee is refused at both page and API |
| `admin-test.js` | 27 | Organization settings round-trip, branding driven from the database, the mail-transport guard, the paid-AI guard, demo-data removal guards, and the HR/system role separation in both directions |
| `calibration-test.js` | 23 | A full session: open, propose, decide, revert, finalise — plus the refusals (short reason, outstanding decisions, finalised session) and who may run one |
| `development-test.js` | 28 | Development vs improvement plan visibility per actor, asserted on rendered page content; the subject's record-progress-but-not-edit split; `/account` password rules |
| `infra-test.js` | 26 | AI disabled by default and why, the mock provider's labelling and digest, context-assembly permissions, attachment upload/download/delete and who is refused |
| `competencies-test.js` | 6 | Competency profile visibility per actor, including that a system administrator is refused because ratings are review content |
| `compensation-test.js` | 44 | The compensation/HR/system role split in every direction, a manager's scope being the launch snapshot, that nobody allocates their own pay, and that approving, applying, banding and budgeting are each refused without the role. Read-only |
| `compensation-flow-test.js` | 22 | A manager deciding and overriding through the dialog, an administrator approving and applying, and that the integer written to pay history is the integer the dialog previewed. **Mutates the seeded cycle** |
| `compensation-budget-test.js` | 18 | The three budget states — no row, a row of zero, a figure — on screen and at the submission boundary. **Mutates the seeded cycle** |
| `devlogin-test.js` | 7 | The demonstration sign-in panel: that it renders with `ENABLE_DEV_LOGIN=true`, that each button performs a real password sign-in against the real endpoint, and that it does not bypass authentication. Needs a server started with the flag on |
| `bootstrap-test.js` | 4 | First run on an *empty* organization: the bootstrapped administrator can sign in, all 24 main screens survive having no data, and CSV import is reachable. Needs its own blank database; see the header |
| `layout-check.js` | 20 pages × 2 viewports | Horizontal overflow and tap targets at 1440px and 390px; writes screenshots to the directory given as the first argument |

## Known residue

`calibration-test.js` and `development-test.js` create records they do not fully
remove (a finalised calibration session; two plans).

`compensation-flow-test.js` and `compensation-budget-test.js` **change the
seeded compensation cycle** — the first applies it to pay history, the second
rewrites its budgets. Neither can run twice in a row without a re-seed, and
`npm run test:browser` and `npm run test:compensation` re-seed around them for
that reason. Run one by hand and reseed afterwards:

```bash
SEED_FORCE=1 npx tsx prisma/seed.ts
```

## A note on writing assertions here

Three assertions in these suites originally passed for the wrong reason, which
is worse than failing:

- A URL predicate `/development/[^/]+$` also matched `/development/new`, so it
  resolved instantly and raced past the navigation it was meant to await.
- A text assertion for a saved check-in matched the textarea it had just typed
  into rather than the rendered record.
- A visibility assertion checked `page.url()`, but `notFound()` leaves the URL
  unchanged, so the check was decided by a string identical either way.

Three more were found later, all from the same cause: the shell was restyled
and gained an employee-search box in the header, which silently changed what
`page.locator('input').first()` and `a[href^="/people/"]` resolve to.

- `catalog-test.js` typed scale and competency names into the search box.
  The subsequent save succeeded — saving nothing — and the assertion then
  looked for the new name as page text, which an `<input>` value never is.
- `admin-test.js` edited settings fields by positional index, off by one.
- `development-test.js` scraped the subject's e-mail from the first `/people/`
  link, got the wrong person, and signed in as the **manager**. Every "the
  subject cannot…" check passed while testing nothing. The authorization was
  correct; the test was not demonstrating it.

The rules that follow:

1. **Assert on what the server re-rendered**, not on what is on screen, and
   never on a predicate that is already true before the action.
2. **Locate fields by label**, never by position. A positional selector is a
   bet on page structure that no assertion will ever check.
3. **Resolve a subject from the database, not by scraping the page.** A
   refusal test that cannot find something to attack reports a pass, which is
   the loudest possible way to test nothing. Both compensation suites take
   their targets from Prisma for this reason, and assert through the browser.
