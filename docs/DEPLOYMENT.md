# Deployment

Covers environment configuration, the database, scheduled jobs, e-mail, backup
and restore, logs, and — explicitly — everything that could introduce a
recurring cost.

## Secrets

**No secret is stored in the database, in source, in a client bundle, or in a
log.** Credentials live in the server environment only.

- `.env` is gitignored. `.env.example` is committed and contains no real values.
- The AI settings screen reports *whether* a credential is present, never its
  value.
- A temporary password set by an administrator is shown once, in the browser, to
  the administrator who set it. It is hashed immediately and never logged — the
  audit log records that a reset happened, not what it was.
- Session tokens are stored only as SHA-256 hashes.
- `JOBS_TOKEN` is compared in constant time.

Before going live, regenerate `SESSION_SECRET` (`openssl rand -base64 48`) and
set a `SEED_PASSWORD` you do not intend to keep — or do not seed at all.

## Environment variables

Full annotated list in `.env.example`. The ones that change behaviour rather
than configuration:

| Variable | Default | Effect |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite file, or a Postgres URL |
| `SESSION_SECRET` | placeholder | **Must be replaced.** Signed artefacts |
| `APP_URL` | `http://localhost:3000` | Absolute links in e-mail |
| `STORAGE_DIR` | `./storage/attachments` | Private files. **Never inside `./public`** — the application refuses to write if it is |
| `ENABLE_DEV_LOGIN` | `true` | Demo account buttons on the sign-in page. Ignored when `NODE_ENV=production` |
| `SEED_PASSWORD` | `ElevateDemo!2026` | Password for seeded accounts |
| `EMAIL_TRANSPORT_CONFIGURED` | unset | **Nothing is e-mailed unless this is `true`** |
| `AI_BILLING_APPROVED` | unset | **No paid AI provider can be enabled unless this is `true`** |
| `JOBS_TOKEN` | empty | Enables `POST /api/jobs/run`. Empty means that route returns 404 |
| `GOOGLE_CLIENT_ID` | empty | Empty means password sign-in only. Set, and Google Workspace sign-in is offered |
| `GOOGLE_CLIENT_SECRET` | empty | **Secret.** Used once, server to server, in the token exchange |
| `GOOGLE_WORKSPACE_DOMAIN` | empty | The domain(s) allowed to sign in. Without it SSO stays **off** rather than accepting any Google account |
| `ALLOW_PASSWORD_LOGIN` | unset | **Once SSO is on, `POST /api/auth/login` returns 403 unless this is `true`** |
| `SSO_AUTO_PROVISION` | unset | `true` creates an account on first sign-in for anyone in the domain. Off by default |

### Production checklist

```bash
NODE_ENV=production
DATABASE_URL=...                 # Postgres
SESSION_SECRET=...               # openssl rand -base64 48
APP_URL=https://...
STORAGE_DIR=/var/lib/db-elevate/attachments
ENABLE_DEV_LOGIN=false           # also ignored automatically, but be explicit
JOBS_TOKEN=...                   # openssl rand -hex 32

# Google Workspace sign-in. See docs/SSO.md for the console steps.
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...         # secret: set it in the host, not in a file
GOOGLE_WORKSPACE_DOMAIN=deitemeyerbrothers.com
# ALLOW_PASSWORD_LOGIN is deliberately left unset, which turns passwords OFF.
```

With single sign-on enforced, create the first administrator as an SSO account
or it will not be able to sign in:

```bash
npm run create-admin -- --email you@deitemeyerbrothers.com --name "Your Name" --sso
```

The script refuses to create a password account while SSO is enforced, rather
than leaving you with credentials the server will not accept.

`ENABLE_DEV_LOGIN` is checked as `process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_LOGIN === 'true'`,
so a production build cannot show the demo panel even if the variable is left
set. The panel never bypassed authentication anyway — it submits a real password
to the same endpoint as the form — but keeping development shortcuts isolated
from production authentication means not relying on that.

## Database

```bash
npm run db:deploy     # apply migrations (production)
npm run db:migrate    # create and apply a migration (development)
npm run db:reset      # drop, re-migrate, re-seed — destroys data
```

### Moving to PostgreSQL

The schema is written to be Postgres-compatible and uses no SQLite-specific
features, but the committed migration is SQLite's.

1. Change `datasource db { provider = "postgresql" }` in `prisma/schema.prisma`.
2. Delete `prisma/migrations/` and run `npm run db:migrate` against an empty
   Postgres database to generate a fresh initial migration.
3. Review the generated SQL. Nothing should need hand-editing.

There is no automated data migration from an existing SQLite file. For a
development database, reseed. For one with real data, export and import per
table, in dependency order.

### Seeding

```bash
npm run db:seed
```

Refuses to run with `NODE_ENV=production` unless `ALLOW_PROD_SEED=true`, because
seeding a live installation would insert 27 fictional employees into a real
company's directory.

Every seeded row carries `isDemoData` (or `isDemoAccount`), so
`/admin/demo-data` can remove them exactly. That screen refuses to run while the
caller is signed in as a demonstration account, since that would delete their
own access mid-operation.

## Scheduled jobs

Reminders, survey open/close and e-mail delivery.

```bash
npm run jobs:run        # everything due
npm run jobs:dry-run    # no e-mail delivery
```

Crontab, every 15 minutes:

```cron
*/15 * * * * cd /srv/db-elevate && /usr/bin/npm run jobs:run >> /var/log/db-elevate/jobs.log 2>&1
```

Or over HTTP, for platforms that offer a cron webhook instead of a shell:

```bash
curl -fsS -X POST https://your-host/api/jobs/run -H "Authorization: Bearer $JOBS_TOKEN"
```

**Safe to run as often as you like.** Reminders carry day-bucketed idempotency
keys enforced by a unique index, and stored jobs are claimed with a conditional
update, so overlapping runs cannot double-send. Verified by running it twice: 37
reminders created, then 0.

Exit code is 0 when the sweep completed and 1 when any organization raised an
error, so a scheduler can alert on it. `--json` prints a machine-readable
summary. The HTTP route returns 207 rather than 200 when there were errors.

Note the script passes `--conditions=react-server`: the `server-only` marker
package resolves to a throwing stub otherwise. That marker is what keeps server
modules out of client bundles, so it is declared rather than removed.

### What is deliberately not automated

**Launching a review cycle.** A scheduled launch creates review assignments for
real people with real deadlines. The stored job notifies HR administrators that
a cycle is due to start; a person presses the button. Automating it would mean
discovering a misconfigured cycle after 78 people had been notified.

## E-mail

**Nothing is sent by default.** Messages are written to `EmailMessage` and
readable at `/admin/outbox` with their full text.

Two independent conditions must both hold before anything is delivered:

1. `EMAIL_TRANSPORT_CONFIGURED=true` in the server environment.
2. The organization's provider is set to something other than `outbox` in
   Administration → Organization.

The setting says what the organization wants; the environment variable says what
the server is permitted to do. Either alone is not enough, which is what stops a
development or demonstration installation mailing a real employee if somebody
changes the setting in the interface. Messages that were not sent are reported
as **held**, never as sent — the outbox does not claim a delivery that did not
happen.

### Implementing delivery

No mail client is vendored, so this build genuinely cannot send mail. Adding it
is one function:

1. `npm install nodemailer` (or your provider's SDK).
2. In `src/server/email/transport.ts`, implement `smtpTransport.send` and set
   `ready: true`.
3. Set `EMAIL_TRANSPORT_CONFIGURED=true` and the provider's own variables.
4. Select the provider in Administration → Organization.

Delivery claims each message with a transient `SENDING` status before sending,
so two runners cannot deliver the same message. A row left in `SENDING` means a
runner died mid-send; it is surfaced on the outbox page rather than hidden.

## Optional AI

Off by default, and no feature depends on it. See [PRIVACY.md](PRIVACY.md) for
what context assembly is and is not allowed to include.

Four conditions must hold at once, and a paid provider adds two more:

| | Mock provider | Paid provider |
|---|---|---|
| Provider chosen in Administration → AI | yes | yes |
| Switch turned on there | yes | yes |
| Monthly call budget above zero | not required | **required** |
| `AI_BILLING_APPROVED=true` on the server | not required | **required** |
| Credential in the server environment | not required | **required** |
| HTTP client implemented in this build | included | **not included** |

`AI_BILLING_APPROVED` is a deliberate sign-off that somebody with authority has
approved the spend. Without it, enabling a paid provider is refused — including
against a direct API call — so nobody starts a metered service from a browser
toggle.

The mock provider makes no network call, costs nothing, and labels its output
inside the text so a fixture cannot be mistaken for a real suggestion. An
unimplemented provider refuses rather than silently falling back to the mock.

## Backup and restore

### What to back up

| | Where | Why |
|---|---|---|
| Database | `DATABASE_URL` | Everything except file contents |
| Attachments | `STORAGE_DIR` | Not in the database |

Both, together, from the same moment. An attachment row with no file produces an
honest error ("the record exists but the file is missing from storage; restore it
from a backup"), but it is still a restore you then have to do.

### SQLite

```bash
# Consistent copy of a live database — do not just cp the file.
sqlite3 /srv/db-elevate/dev.db ".backup '/backup/db-elevate-$(date +%F).db'"
tar czf /backup/attachments-$(date +%F).tar.gz -C /srv/db-elevate storage/attachments
```

### PostgreSQL

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > /backup/db-elevate-$(date +%F).dump
tar czf /backup/attachments-$(date +%F).tar.gz -C /var/lib/db-elevate attachments
```

### Restore

```bash
# 1. Stop the application.
# 2. Restore the database.
pg_restore --clean --no-owner --dbname="$DATABASE_URL" /backup/db-elevate-2026-11-05.dump
# 3. Restore the files to STORAGE_DIR.
tar xzf /backup/attachments-2026-11-05.tar.gz -C /var/lib/db-elevate
# 4. Apply any migrations newer than the backup.
npm run db:deploy
# 5. Start, then verify.
curl -fsS https://your-host/api/health
```

### Verifying a restore

`/api/health` reports database reachability and latency. Then check, in order:

1. Sign in.
2. `/admin/audit` — the most recent event should match roughly when the backup
   was taken.
3. Open a released review and confirm its score breakdown renders.
4. Download one attachment — this is the check that catches a database restored
   without its files.
5. `npm run jobs:dry-run` — it should report work without errors.

Test the restore on a copy before you need it. A backup that has never been
restored is a hypothesis.

### What a restore does not undo

The audit log is append-only *within* the application, but a restore rolls the
whole database back, including the log. A restore is itself an event worth
recording outside the application.

## Logs

Application logs go to stdout. The application logs:

- Unhandled API errors, with the detail server-side and a safe message returned.
- Audit write failures, loudly — an audit failure never takes down the operation
  the user asked for, but it must not be silent.
- Prisma warnings and errors.

It deliberately does **not** log: review content, private note content, passwords
or temporary passwords, session tokens, AI credentials, AI context (only a
digest), or anonymous survey respondent identity (there is none to log).

Rotate stdout with your process supervisor. Nothing writes to a log file
directly.

## External services and recurring costs

Stated plainly, because this is the section somebody reads before signing
something.

**As shipped, this application has no recurring external cost.** It makes no
outbound network call of any kind. No telemetry, no analytics, no CDN, no
fonts fetched at runtime, no e-mail, no AI.

Costs appear only if you opt in:

| Service | When it starts costing | Guard |
|---|---|---|
| Hosting | Immediately, whatever you deploy to | — |
| Postgres | If you use a managed database | SQLite needs nothing |
| Mail provider | Per message, once delivery is implemented and both conditions met | `EMAIL_TRANSPORT_CONFIGURED` |
| AI provider | Per call, metered | `AI_BILLING_APPROVED` + budget ceiling + credential |
| Object storage | Per GB, if you move attachments off local disk | Local disk by default |

The AI budget is a hard ceiling on billable calls per calendar month, not a
warning threshold: reaching it stops further calls. The rest of the application
is unaffected.

## Health check

```
GET /api/health
```

Public (no session), returns database reachability and latency. Suitable for a
load balancer probe. It reports no version, no schema detail and no counts —
nothing an unauthenticated caller should not have.

## Hardening notes

- Run behind TLS. Session cookies are `httpOnly`, `sameSite=lax`, and `secure`
  in production.
- `STORAGE_DIR` must be outside `./public` and outside the deploy directory if
  you replace deploys wholesale, or an upgrade will delete the attachments.
- Attachment downloads are served `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` and a
  restrictive CSP, and only from an allowlist of types with HTML and SVG
  excluded.
- Failed sign-ins increment a counter and lock the account temporarily; the
  login endpoint burns comparable time on both branches so timing does not
  distinguish "no such user" from "wrong password".
