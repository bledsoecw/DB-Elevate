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
node tests/browser/layout-check.js /tmp/shots
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
| `layout-check.js` | 20 pages × 2 viewports | Horizontal overflow and tap targets at 1440px and 390px; writes screenshots to the directory given as the first argument |

## Known residue

`calibration-test.js` and `development-test.js` create records they do not fully
remove (a finalised calibration session; two plans). Reseed afterwards for a
pristine demonstration state:

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

The rule that follows: **assert on what the server re-rendered**, not on what is
on screen, and never on a predicate that is already true before the action.
