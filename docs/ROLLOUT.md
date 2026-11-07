# Rollout guide

How to take the live installation from "one administrator can sign in" to
"the company is using it". Written for the person doing it, in the order it
has to happen, with the reason each step comes where it does.

[DEPLOYMENT.md](DEPLOYMENT.md) covers the infrastructure — Vercel, Neon, DNS,
environment variables. This document starts after that and stays inside the
application.

## Where the installation stands

Verified on 2026-11-07 against the production project.

| | |
|---|---|
| Address | https://dbelevate.deitemeyerbrothers.com |
| Production branch | `main` (currently `52bc578`) |
| Database | Neon PostgreSQL `db_elevate`, both migrations applied |
| Attachments | Stored in the database (`STORAGE_DRIVER=database`) |
| Sign-in | Google Workspace only, `deitemeyerbrothers.com` |
| Password sign-in | **Closed for everybody** — see below |
| Auto-provisioning | **Off** — a valid Google sign-in with no account record here is refused |
| Scheduled jobs | Hourly, Vercel Cron → `/api/jobs/run`, authenticated with `CRON_SECRET` |
| Outbound e-mail | Off. Messages queue in `/admin/outbox` and are never sent |
| AI features | Off. No provider, no credential, no spend |
| Accounts | One: Operations Account, holding **both** administrative roles |

Two of those deserve spelling out, because they are the ones that produce a
confused phone call rather than an error message.

**Nobody can sign in with a password.** `ALLOW_PASSWORD_LOGIN` is not set, and
once single sign-on is configured the password endpoint refuses everything
rather than everything-except-the-Workspace. That is the intended setting while
every employee has a Workspace account. If you ever take on someone who does
not — a seasonal subcontractor, say — set `ALLOW_PASSWORD_LOGIN=true` in Vercel.
It reopens passwords for addresses *outside* the Workspace domain only;
`@deitemeyerbrothers.com` addresses are still forced through Google, so it does
not weaken the accounts that matter.

**A Workspace account is not an account here.** `SSO_AUTO_PROVISION` is off on
purpose: this application holds salary and review data, and every shared
mailbox, alias and service account in the Workspace would otherwise walk in.
Somebody who signs in with Google and has no employee record is refused. So
creating the records in step 4 is what lets people in — not anything in Google.

---

## Phase 1 — Before anyone else signs in

About an hour. Do all of it before step 4, because step 4 reads the results.

### 1. Organization and branding

**Administration → Organization** (`/admin/system`).

| Field | Value |
|---|---|
| Company name | Deitemeyer Brothers Roofing & Construction |
| Product name | DB Elevate |
| Wordmark text | DB ELEVATE |
| Logo URL | `/brand/deitemeyer-brothers.png` |
| Primary colour | `#1d4482` |
| Accent colour | `#57b152` |
| Time zone | America/New_York (or wherever payroll runs) |

The logo file already ships in the repository, so that path works as typed —
there is nothing to upload.

Below the branding are two privacy thresholds. They are not cosmetic:

- **Minimum responses before survey results are shown.** Under this number, an
  anonymous survey shows nothing at all. Three is the usual floor; on crews of
  four or five, five is safer.
- **Minimum peer reviews before peer feedback is aggregated.** Same idea for
  reviews. Below it, a "peer summary" is one identifiable person's opinion.

Raising these later does not retroactively unpublish anything people have
already seen, so set them higher than you think you need now.

### 2. Job titles and departments

**Administration → Job titles and departments** (`/admin/job-titles`).

Departments first, then titles, because a title points at a department.

A job title is not a label. It carries the competency library a review of that
role is built from, and it owns the salary band a pay recommendation is
measured against. Somebody imported without one gets a review with no
competencies and a compensation row with no band — the system will not
complain, it will just quietly produce an empty review.

Write the names exactly as they appear in the spreadsheet you are about to
import. Matching is by name and is case-insensitive, but "Lead Carpenter" and
"Lead carpenter " with a trailing space are two different things to a CSV.

Neither is ever deleted, only archived, and archiving is refused while active
people are still attached. That is deliberate: deleting a title would take its
salary band with it and strip the title from the snapshots past reviews and pay
decisions were made against.

### 3. A second administrator, then drop a role

The Operations Account currently holds **both** the HR/program administrator
role and the system administrator role, because the bootstrap account has to —
somebody has to start, and granting only one would lock you out of half the
application with nobody able to grant the other.

That is a bad permanent arrangement. The split exists so that the person who
manages accounts and integrations cannot read review content or salary, and the
person who runs the review programme cannot change who can sign in. One account
holding both defeats it.

**Administration → Accounts and roles** (`/admin/accounts`): give a second
person the role you intend them to keep, confirm they can sign in, then remove
the other role from Operations Account. Confirm *before* you remove, not after.

See [PERMISSIONS.md](PERMISSIONS.md) for what each role actually grants.

---

## Phase 2 — People

### 4. Import the employees

**People → Import** (`/people/import`).

1. Download the template from the first screen. The headers are
   First name, Last name, Preferred name, Work e-mail, Employee number,
   Job title, Department, Manager e-mail, Hire date, Employment type,
   Work location, Crew / project team, Work phone.
2. Upload your file and map the columns. Only work e-mail and the two name
   columns are required; the rest can be blank.
3. **Read the preview.** It is the contract the commit honours — what it says
   will happen is what happens. In particular it lists any job title or
   department it does not recognise, and those people are imported without one.
   If that list is not empty, go back to step 2, add the missing names, and
   upload again. The warning now links straight there, in a new tab, so you do
   not lose the staged file.
4. Leave **"Also create sign-in accounts"** ticked. With single sign-on on,
   these accounts are created with no password at all — there is nothing to
   hand out and nothing to leak. The wizard will name any address outside
   `@deitemeyerbrothers.com`, because those people get an account that cannot
   sign in until you either give them a Workspace address or turn password
   login back on.

Re-running the import later updates people matched by work e-mail rather than
duplicating them, so a corrected file is safe to re-upload.

### 5. Check the reporting lines

**People** (`/people`), and spot-check a few profiles.

Manager e-mail in the CSV is resolved after everyone is created, so a manager
who appears lower down the file still resolves. Anyone whose manager e-mail did
not match is listed in the import report and has no manager — fix those on the
employee record.

Reporting lines decide who can see whose reviews, goals and development plans.
Everything downstream is wrong if these are wrong, and nothing else will tell
you.

### 6. Tell people they can sign in

There is no invitation e-mail — outbound mail is off, and the application never
sends anything you did not ask it to. Tell them yourself:

> Go to https://dbelevate.deitemeyerbrothers.com and click **Sign in with
> Google**. Use your Deitemeyer Brothers account. There is no separate password.

---

## Phase 3 — The review programme

None of this is needed for goals, feedback, meetings or surveys, which work as
soon as people have accounts. It is needed before you can run a review cycle.

### 7. Rating scales

**Administration → Rating scales** (`/admin/scales`).

Each level carries a written description, so "3" means something specific
rather than "middle". A scale used by a published template version is frozen —
the labels a reviewer read when they answered must still be the ones shown on
that review in three years. Get them right before publishing a template, not
after.

### 8. Competencies and libraries

**Administration → Competencies and libraries** (`/admin/competencies`).

Build the competencies with their behavioural descriptors by level, group them
into a library per role family, then attach each library to the job titles that
use it — the attach step is on the job title, back in `/admin/job-titles`. A
title with no library gets reviews with no competency questions.

### 9. A review template

**Administration → Review templates** (`/admin/templates`).

Publishing freezes a version. A completed review can never be rewritten, which
is the point. Duplicate-and-edit is how you change a published template.

### 10. A review cycle

**Reviews → Cycles**. Choose participants, assign reviewers, set deadlines,
launch.

Run a pilot with one crew first. A cycle that goes out to everyone with the
wrong template is a lot of people's wasted evening, and cancelling it is
visible to all of them.

---

## Phase 4 — Optional modules

**Compensation** ([COMPENSATION.md](COMPENSATION.md)) has its own access model —
a compensation administrator sees salary and no review content. It needs salary
bands on the job titles, then a budget, then a cycle. No printable statement, no
defined export and no proration for mid-year starters; those are listed in
[EXTENSION-PLAN.md](EXTENSION-PLAN.md).

**E-mail delivery** is one function in `src/server/email/transport.ts` plus
`EMAIL_TRANSPORT_CONFIGURED=true`. Everything around it — queueing, idempotency,
the outbox, the held-not-sent reporting — is already built. Until then
`/admin/outbox` is where notifications accumulate, and it is worth looking at
occasionally even with delivery off, because it shows what *would* have gone
out.

**AI** stays off until a provider, credentials, usage limits and a budget are
approved. The mock provider works fully and costs nothing if you want to see
the shape of it first.

---

## Phase 5 — Operational, and not optional

### Rehearse the restore

[DEPLOYMENT.md](DEPLOYMENT.md) describes backup and restore from the schema and
storage layout. **It has never been executed.** It is the highest-value
unverified thing in this installation, because it is the one that matters on the
worst day. Do it against a Neon branch, not production, and time it.

Note that attachments live in the database rather than on disk, so a database
backup is a complete backup. That is a real advantage of the serverless storage
driver and worth not giving up casually.

### Upgrade zod

`zod` 3 has a published advisory (CVSS 7.5) reachable from the request path. The
upgrade to 4 is a breaking change across every validation schema and was
deliberately left as its own piece of work rather than smuggled into a feature
commit. It should be the next code change.

### Watch the first few job runs

The hourly cron opens and closes scheduled surveys and sends reminders. After
the first cycle launches, check `/admin/audit` for `jobs.run` entries and
confirm the counts look like what you expect.

---

## Things that will bite you

- **No account record, no sign-in.** Auto-provisioning is off. A new hire needs
  an employee record here before their Google account works.
- **The job title is load-bearing.** It carries the competency library and owns
  the salary band. An employee with no title is a quiet failure, not a loud one.
- **Archive, never delete.** The application will refuse to archive anything
  active people are attached to, and refuse to delete outright, so that history
  keeps pointing at something that still has a name.
- **E-mail is queued, not sent.** Nobody is notified of anything until delivery
  is implemented and explicitly enabled.
- **An acknowledgement is not agreement.** The review acknowledgement records
  that someone read a released review. It does not record that they agree with
  it, and nothing in the product claims otherwise.
- **Confidential is not anonymous.** Confidential feedback hides the author from
  the subject; an anonymous survey does not record who answered. They are
  different promises and the interface says which one it is making.
- **One organization.** Records are scoped by `orgId` throughout, but there is
  no tenant-selection interface and that path is untested.
