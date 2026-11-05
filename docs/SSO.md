# Google Workspace single sign-on

Sign-in restricted to one Google Workspace domain. When it is configured,
password sign-in is **refused by the server** — not merely hidden on the page —
so "only our Workspace accounts can get in" is a property of the application
rather than of its markup.

## What you need

- A Google Cloud project. Free; no billing account required for OAuth.
- The DB Elevate deployment reachable over **https** at a stable URL.
- A Workspace domain, e.g. `deitemeyerbrothers.com`.

## Setting it up in Google Cloud Console

1. **console.cloud.google.com** → create a project, or pick an existing one.
2. **APIs & Services → OAuth consent screen**
   - User type: **Internal**. This is the important one. Internal means only
     accounts in your Workspace can ever complete the flow, which is a second
     lock on top of the domain check this application does itself. It also
     means no Google verification review.
   - App name: `DB Elevate`. Support e-mail: yours. Logo optional.
   - Scopes: the defaults (`openid`, `email`, `profile`). Nothing else is
     requested and nothing else is needed.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorised JavaScript origins: `https://your-domain`
   - Authorised redirect URIs: `https://your-domain/api/auth/sso/callback`
     — exactly this path, and exactly the scheme and host you deploy on.
     A mismatch here is the single most common cause of `redirect_uri_mismatch`.
4. Copy the **client ID** and **client secret**.

## Environment variables

```
GOOGLE_CLIENT_ID="123-abc.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="…"
GOOGLE_WORKSPACE_DOMAIN="deitemeyerbrothers.com"
APP_URL="https://your-domain"
```

The client secret is a secret. It belongs in the deployment's environment —
on Vercel, Project Settings → Environment Variables — never in the repository.
Nothing in this application sends it to a browser; it is used in exactly one
place, the server-to-server token exchange.

Optional:

| Variable | Default | What it does |
| --- | --- | --- |
| `SSO_REDIRECT_URI` | `<APP_URL>/api/auth/sso/callback` | Only if the callback differs from the derived one. |
| `SSO_AUTO_PROVISION` | off | `"true"` creates an account on first sign-in for anyone in the domain. |
| `ALLOW_PASSWORD_LOGIN` | off once SSO is on | `"true"` keeps password sign-in working alongside Google. |
| `GOOGLE_WORKSPACE_DOMAIN` | — | Several domains may be listed, comma-separated. |

Every one of these **fails closed**. Unset or misspelled means the stricter
behaviour, never the looser one: no domain means SSO stays off rather than
accepting any Google account, and a value other than exactly `"true"` leaves
passwords disabled and auto-provisioning off.

## The first administrator

With SSO enforced, an account created with a password can never sign in — the
password endpoint refuses every request. Bootstrap with an SSO account instead:

```bash
npm run create-admin -- --email you@deitemeyerbrothers.com --name "Your Name" --sso
```

That creates an account with **no password at all**. Sign in with the Google
button; the account links itself to your Google identity on first use. The
script refuses `--sso` unless the address is in `GOOGLE_WORKSPACE_DOMAIN`, and
refuses a password account when SSO is enforced, rather than letting you create
something unusable.

## How accounts are matched

1. By Google's subject (`sub`) — stable, and survives a name or address change.
2. Otherwise by e-mail address, which links an account HR created in advance to
   the person on their first sign-in. The subject is recorded at that point.

**An address already linked to a different Google account is refused.** That is
what a recycled address looks like: somebody leaves, their Workspace account is
deleted, and months later a new hire is given the same address. Matching on
address alone would hand the new person the old one's reviews and pay history.
A system administrator has to unlink it deliberately.

With `SSO_AUTO_PROVISION` off (the default), somebody in the domain with no
account here is told to ask HR. That is deliberate: a Workspace contains shared
mailboxes, service accounts and contractors, and this application holds salary
and review records.

## What is checked on every sign-in

The ID token is validated server-side before any session exists:

| Check | Why |
| --- | --- |
| Signature against Google's published keys | The token was really issued by Google |
| `iss` is Google | Not a token from somewhere else |
| `aud` is this client ID | Not a token minted for another application and replayed here |
| `exp` / `iat`, 2 minutes' skew | Not an old or future-dated token |
| `nonce` matches this browser's attempt | Not a token captured elsewhere and replayed |
| `email_verified` | Not an unverified address |
| `hd` matches an allowed domain | A Workspace account, in *your* Workspace |
| The address is **also** in an allowed domain | A Workspace can host several domains; the address is what gets matched to an employee |

Plus, around the token: `state` compared against an httpOnly cookie (CSRF), and
PKCE tying the authorization code to the browser that started the flow.

A failure at any of these is a refusal and an audit entry. There is no
fallback path — if Google's keys cannot be fetched, nobody signs in by SSO,
which is the right way round for a system holding salary data.

## Turning it off

Unset `GOOGLE_CLIENT_ID` and redeploy. Password sign-in comes back
automatically. Accounts created SSO-only have no password, so an administrator
has to set one for them in Administration → Accounts.

## What has and has not been tested

**Tested, and automated:** every claim rule above, against a fake Google
(`tests/unit/sso.test.ts`, 33 cases — most of them asserting a *refusal*); and
the plumbing end to end against a server booted with SSO configured
(`tests/browser/sso-test.js`): the Google button, the redirect's PKCE and state
parameters, the httpOnly cookies, the refusal of a callback with no pending
sign-in or a mismatched state, and — the one that matters most — that
`POST /api/auth/login` returns **403 with a correct password** when SSO is
enforced.

**Not tested, and cannot be from here:** the live round trip to Google. That
needs a real OAuth client, a real Workspace account and a public https callback.
The first time anybody signs in for real will be the first time the signature
verification and the token exchange run against the actual Google. Expect to
spend a few minutes on `redirect_uri_mismatch` if the callback URL in the
console does not match `APP_URL` exactly.
