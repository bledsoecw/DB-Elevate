# Verification

What was tested, what passed, and what remains unverified. The last section is
the important one — a verification document that only lists successes is a
marketing document.

Run on 2026-11-05 against commit `a94d522` plus the documentation work, on
Node 22, SQLite, a seeded demonstration organization (27 employees, 6 cycles,
78 participants, 168 review assignments, 70 goals, 3 surveys, 199 audit events).

## Summary

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run build` (production) | Succeeds |
| `npm test` — unit | **134 / 134 passed** |
| `npm run test:e2e` — browser workflow and permissions | **43 / 43 passed** |
| Catalogue administration (browser) | **16 / 16 passed** |
| System administration and role separation (browser) | **27 / 27 passed** |
| Calibration (browser) | **23 / 23 passed** |
| Development plans and account (browser) | **28 / 28 passed** |
| AI gating and attachments (browser) | **26 / 26 passed** |
| Demonstration sign-in panel (browser) | **7 / 7 passed** |
| Layout, desktop 1440px and phone 390px | No horizontal overflow on 20 pages |
| Console / server errors during browser runs | None |

**304 automated checks**, all passing.

A caveat about that number: it was 297 and entirely green while the sign-in
page was returning HTTP 500 under its documented default configuration. The
suites all authenticated by filling the form directly, so none of them ever
rendered the demo panel. Coverage counts measure what was looked at, not what
works.

## Unit tests (134)

Pure functions, no database.

| Suite | Tests | Covers |
|---|---|---|
| `review-score` | 24 | Normalization, exclusion reasons, section and overall weighting, final-score renormalization, drafts excluded |
| `policy` | 51 | The permission matrix, including the administrative role split |
| `survey-privacy` | 24 | Threshold, small-group and complement suppression, filter limits, verbatim rules, stable shuffle |
| `goal-progress` | 21 | Reported vs computed, divergence, milestone denominators, risk flags |
| `ai-provider` | 14 | Mock determinism, in-text labelling, refusal of unimplemented providers, context digest |

### The documented worked examples are verified, not asserted

Every worked example in [SCORING.md](SCORING.md) was run through the real
functions rather than calculated by hand into prose:

```
section example   -> score 83.33 | coverage 0.75   (doc: 83.33 | 0.75)
  N/A counted as lowest instead     -> 62.5         (doc: 62.5)
normalize 3 on 1-5 -> 50                            (doc: 50)
normalize 3 on 1-3 -> 100                           (doc: 100)
final, all components -> 78.00 | coverage 1.0       (doc: 78.00 | 1.0)
final, no peer review -> 77.50 | coverage 0.8       (doc: 77.50 | 0.8)
draft peer ignored    -> 77.50 | coverage 0.8       (equals the no-peer case)
```

## Browser tests

Driven through a real browser against a running server. Every access-control
check calls the REST route as well as visiting the page, because a page
redirect hides a permission hole rather than preventing it.

### Verified against the requirement list

| Requirement | How it was checked | Result |
|---|---|---|
| Data persists after restart | Settings saved, server restarted, value re-read | Pass |
| Employees cannot access unauthorized records | Direct API calls as an employee to another's review, release, reopen, audit log | 403 / 404 |
| Managers limited to their scope | Directory and reports as a manager; 13 people listed, none outside the line | Pass |
| Peer reviewers see only their assignments | Peer assignment access checks | Pass |
| Drafts protected | Draft content requested as manager, HR, leadership | Withheld from all |
| Private content protected | Private meeting note requested by the other participant | Withheld |
| Transitions enforce prerequisites | Submit before answering required questions; approve before submit; release before approve | Refused |
| Released reviews protected from edits | Edit attempt after release | Refused |
| Template changes preserve history | Published version edited → forks; old cycle still shows original questions | Pass |
| Duplicate submissions don't duplicate work | Second acknowledgement, second submit | 409 |
| Scores match independent calculation | Unit tests against hand arithmetic (above) | Pass |
| Anonymous survey restrictions hold in reports and exports | Suppression on screen and in CSV | Pass |
| Failed saves produce honest recoverable states | Network failure surfaced as "not saved", draft retained | Pass |
| Manager changes behave correctly | Reorganization: new manager denied the old review, previous manager keeps it | Pass |
| Deactivation behaves correctly | Deactivated account cannot sign in; records retained | Pass |

### Supplementary suites

**Catalogue (16/16)** — competency ladder create and edit persist; a rating
scale used by a published template is frozen, its level inputs are disabled, and
a direct `PATCH` with new levels returns **409**; duplicate level values block
the save; an unused recognition value deletes while a used one deactivates; a
plain employee gets **403** from `/api/admin/competencies`, `/scales` and
`/recognition`.

**System administration (27/27)** — settings round-trip and persist across a
reload; branding is read from the database (changing the wordmark changes the
sidebar); a real mail provider cannot be selected and the API returns **409**;
a paid AI provider is refused with **409** without `AI_BILLING_APPROVED`; the
mock provider enables with no credential and turns off cleanly; demo-data
removal is refused (**409**) while signed in as a demo account and on a
mistyped confirmation (**422**); the last system administrator cannot be
demoted. **An HR administrator is refused at every system API route (403), and
a system administrator is refused at every catalogue route (403).**

**Calibration (23/23)** — a decision under ten characters is refused (**422**);
finalising with outstanding decisions is refused (**409**); a finalised session
refuses further changes (**409**); an adjustment reaches the participant record
and is shown with its before value; clearing a decision returns the participant
to the queue; neither a system administrator nor a manager can open a session or
record a decision (**403**).

**Development plans (28/28)** — plan visibility verified per actor against
*rendered page content*, since `notFound()` leaves the URL intact:

| Actor | Improvement plan | Development plan |
|---|---|---|
| The subject | visible | visible |
| Direct manager | visible | visible |
| Chain +2, +4 (leadership) | **hidden** | visible |
| HR administrator | visible | visible |
| System administrator | **hidden** | **hidden** |
| Unrelated employee | **hidden** | **hidden** |

Also: relaxing an improvement plan's restriction is refused (**409**); the
subject can mark an action complete and add a check-in, and both persist across
a reload; the subject cannot add an action, rename the plan or cancel it
(**403** on all three); closing without an outcome is refused (**422**).
Password change refuses a wrong current password, a weak password and reuse
(**422** each).

**AI and attachments (26/26)** — AI reports itself disabled with a specific
reason; a suggestion request is refused (**409**) with that reason; the mock
provider returns text labelled `[MOCK SUGGESTION` *inside the text*, reports
`local: true`, and carries a 32-character context digest that does not contain
the context; only the requester can decide on a suggestion (**404** otherwise);
context assembly enforces its own permissions (**403** for a manager requesting
HR-only drafting); a meeting summary states that private notes were excluded.
Attachment upload succeeds for an own draft, downloads with
`Content-Disposition: attachment`, `no-store` and `nosniff`; an HTML upload is
refused (**422**); **an unrelated employee and a system administrator both get
404 on the download**; anonymous access is refused.

## Layout

20 pages at 1440×950 and 390×844, covering dashboards, tables, forms, charts,
the review form and the printable results page.

- **No horizontal overflow on any page at either width.**
- Two tap-target issues were found and one was fixed: a footer link measured
  16px tall and is now 24px. Checkbox inputs measure 16px but their labels are
  clickable and full-width, so the effective target is comfortable — the
  measurement was corrected to model how the control is actually tapped.

Screenshots were inspected, not merely captured.

## Bugs found by this testing, and fixed

Recorded because the method matters more than the count.

1. **An authorization hole.** `canManageOrgSettings` returned true for
   `HR_ADMIN`. Every screen refused an HR administrator correctly, but a direct
   `PATCH /api/admin/settings` succeeded — letting them rewrite branding, lower
   a survey privacy threshold, change the mail provider or enable a metered AI
   service. Found by calling the route instead of clicking the button. Fixed,
   with six unit tests pinning the matrix.

2. **A silently narrowed query.** A calibration filter listed `SUBMITTED` and
   `IN_APPROVAL`, which are *assignment* statuses, not participant ones. Nothing
   errored; the filter matched only `APPROVED` and left half the eligible cohort
   out of every session — the 2026 annual cycle offered 2 participants where it
   should have offered 4. Fixed and the constant typed so a repeat is a build
   error.

3. **A production build failure that `tsc --noEmit` did not catch.** The shared
   route `handler` typed its context argument as optional; `next build`
   validates handler signatures more strictly and rejected it. Fixed. The
   lesson: a clean typecheck is not evidence that the application builds, so the
   build is now part of this checklist.

4. **Invalid HTML nesting causing a real hydration failure.** Three new pages
   nested a second `<table>` inside `TableWrap`, which already renders one.

5. **An incoherent form payload.** Choosing AI provider "None" only disabled the
   enable checkbox instead of clearing it, so Save posted "enabled with no
   provider" and the server rightly refused — leaving the user with an error
   they did not cause.

6. **Misleading reporting in the job runner.** Reminder counts reported calls
   *attempted* rather than notifications *created*, so a sweep that created
   nothing reported 37 reminders. `notify()` now returns whether it wrote a row.

7. **The demonstration sign-in panel was broken, and had never been rendered.**
   It appears only when `ENABLE_DEV_LOGIN=true`, and the `.env` used throughout
   development happened not to set that variable — so the first screen a reader
   of the README would see returned HTTP 500 on every run above. `DemoButton`
   was attached to `LoginForm` as a static property, and a server component
   importing from a `'use client'` module receives a client reference proxy
   rather than the function object, so the property was `undefined`.
   TypeScript could not see it because the assignment makes the property look
   real. Found by cloning the pushed branch and following the README exactly.
   Fixed, and `tests/browser/devlogin-test.js` now covers it.

8. **`npm run setup` failed on a clean clone.** `.env` is gitignored, so a
   fresh checkout has only `.env.example`, and Prisma needs `DATABASE_URL`
   before it can read the schema. The documented one-command setup therefore
   did not work for anybody but me. `scripts/setup-env.mjs` now creates `.env`
   with a generated `SESSION_SECRET` and never touches an existing one.

9. **A documentation claim that was false.** The README said comparisons between
   incompatible templates were "refused rather than drawn". The code draws them
   with a caveat naming the differing templates. The document was corrected to
   match the code.

### Test bugs found and fixed

Assertions that passed for the wrong reason, which is worse than failing:

- A URL predicate `/development/[^/]+$` also matched `/development/new`, so it
  resolved instantly and the test raced past the navigation it was meant to
  await. Two checks passed while the thing under test had not happened.
- A text assertion for a saved check-in matched the textarea it had just typed
  into rather than the rendered record. The check-in was never saved and the
  test said it was.
- A visibility assertion checked `page.url()`, but `notFound()` leaves the URL
  unchanged — so "the upper chain cannot see the improvement plan" was being
  decided by a string that is identical either way. Now asserts page content.

## Known flakiness, investigated

The first full browser run showed 41/43 with two failures in the acknowledgement
step. Both were a race, not a defect: the dev server had been started three
seconds earlier and was compiling routes on first request, so the acknowledge
form unmounted while the write was still in flight and the next step saw a
second acknowledgement succeed.

Driving the same flow by hand confirmed correct behaviour (first call 200 with
the comment stored, second call 409). The test's signal was then strengthened
from "the form disappeared" to "the Acknowledged badge and the stored comment
are rendered back by the server", and the suite was re-run **against a cold
`.next` cache** — the condition that produced the original failure — giving
43/43.

## What remains unverified

Stated plainly.

- **PostgreSQL.** Everything was run on SQLite. The schema avoids SQLite-specific
  features and should port, but no migration has been generated or run against
  Postgres, and no query has been checked for Postgres-specific behaviour.
- **Live e-mail delivery.** No mail client is implemented, so the delivery path
  beyond "queued and held" is untested by construction. The outbox, the
  held-not-sent reporting and the transport fallback are tested.
- **Live AI providers.** Only the mock provider is implemented. The gate, the
  refusals, the budget ceiling and the context rules are tested; the HTTP call
  to a real provider does not exist.
- **Backup and restore.** The procedure in [DEPLOYMENT.md](DEPLOYMENT.md) is
  written from the schema and the storage layout. It has **not been executed**
  end to end. Do not treat it as verified; run it on a copy before relying on it.
- **Scale.** Tested with 27 employees and 168 review assignments. The in-memory
  reporting graph and the report queries have not been profiled at thousands of
  employees. See [ARCHITECTURE.md](ARCHITECTURE.md) for where that breaks first.
- **Concurrency under real load.** Double-submit and double-acknowledge are
  guarded by conditional updates and verified single-threaded. No parallel load
  test has been run.
- **Accessibility beyond the basics.** Labels, `aria-describedby`, focus rings,
  keyboard reachability, heading order and tap targets were built in and spot-
  checked. **No screen-reader pass and no automated axe audit has been run.**
- **Cross-browser.** Chromium only. No Safari or Firefox testing.
- **Print output.** The print stylesheet exists and the results page is built for
  it, but no physical print or PDF export has been inspected.
- **Long-running job behaviour.** The runner was executed repeatedly and proved
  idempotent, but not over days, and no failure-retry cycle was observed in
  production conditions.
- **The import pipeline at volume.** CSV import was tested with small files. A
  2,000-row import with mixed encodings has not been attempted.

## Reproducing

```bash
npm run setup
npm run typecheck && npm run build && npm test
npm run dev          # in one terminal
npm run test:e2e     # in another
```

```bash
npm run test:browser          # the five supplementary suites, server must be up
npm run test:layout /tmp/shots  # layout check, writes screenshots
```

The supplementary suites are committed under `tests/browser/` with a README
covering what each one asserts and the residue they leave behind. Reseed
afterwards (`SEED_FORCE=1 npx tsx prisma/seed.ts`) for a pristine demonstration
state.
