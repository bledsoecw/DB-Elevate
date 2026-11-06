import { describe, it, expect } from 'vitest';
import { addressUsesSso, parseDomains, resolveSso, type SsoEnv } from '@/server/auth/sso-config';
import { verifyGoogleClaims, type GoogleIdClaims } from '@/server/auth/google-claims';
import { authorizeUrl, beginLogin, exchangeCode, statesMatch } from '@/server/auth/google';

/**
 * Single sign-on.
 *
 * The rules that decide who may sign in. Most of these assert a REFUSAL,
 * because the expensive failure here is not "a colleague cannot get in" — it
 * is "somebody outside the company can". Every claim Google sends is treated
 * as hostile input until checked.
 */

const BASE_ENV: SsoEnv = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret-value',
  GOOGLE_WORKSPACE_DOMAIN: 'deitemeyerbrothers.com',
  APP_URL: 'https://elevate.example.com',
};

describe('SSO configuration', () => {
  it('is off when no OAuth client is configured', () => {
    expect(resolveSso({}).enabled).toBe(false);
    expect(resolveSso({ ...BASE_ENV, GOOGLE_CLIENT_ID: '' }).enabled).toBe(false);
    expect(resolveSso({ ...BASE_ENV, GOOGLE_CLIENT_SECRET: '  ' }).enabled).toBe(false);
  });

  it('refuses to turn on without a named Workspace domain', () => {
    // The dangerous configuration: a working OAuth client and no domain
    // restriction accepts every Google account on earth. It must fail closed.
    const state = resolveSso({ ...BASE_ENV, GOOGLE_WORKSPACE_DOMAIN: undefined });
    expect(state.enabled).toBe(false);
    if (!state.enabled) expect(state.reason).toMatch(/GOOGLE_WORKSPACE_DOMAIN/);
  });

  it('derives the callback from APP_URL', () => {
    const state = resolveSso(BASE_ENV);
    expect(state.enabled).toBe(true);
    if (state.enabled) {
      expect(state.config.redirectUri).toBe('https://elevate.example.com/api/auth/sso/callback');
    }
  });

  it('tolerates a trailing slash on APP_URL', () => {
    const state = resolveSso({ ...BASE_ENV, APP_URL: 'https://elevate.example.com/' });
    expect(state.enabled).toBe(true);
    if (state.enabled) {
      expect(state.config.redirectUri).toBe('https://elevate.example.com/api/auth/sso/callback');
    }
  });

  it('refuses a plain-http callback except on localhost', () => {
    expect(resolveSso({ ...BASE_ENV, APP_URL: 'http://elevate.example.com' }).enabled).toBe(false);
    expect(resolveSso({ ...BASE_ENV, APP_URL: 'http://localhost:3000' }).enabled).toBe(true);
  });

  it('keeps password sign-in off unless it is explicitly kept', () => {
    const def = resolveSso(BASE_ENV);
    expect(def.enabled && def.passwordLoginAllowed).toBe(false);

    const kept = resolveSso({ ...BASE_ENV, ALLOW_PASSWORD_LOGIN: 'true' });
    expect(kept.enabled && kept.passwordLoginAllowed).toBe(true);

    // Anything other than exactly "true" leaves passwords off.
    for (const value of ['TRUE', '1', 'yes', 'false', '']) {
      const s = resolveSso({ ...BASE_ENV, ALLOW_PASSWORD_LOGIN: value });
      expect(s.enabled && s.passwordLoginAllowed).toBe(false);
    }
  });

  it('keeps automatic account creation off unless it is explicitly on', () => {
    const def = resolveSso(BASE_ENV);
    expect(def.enabled && def.config.autoProvision).toBe(false);
    const on = resolveSso({ ...BASE_ENV, SSO_AUTO_PROVISION: 'true' });
    expect(on.enabled && on.config.autoProvision).toBe(true);
  });

  it('parses a domain list tolerantly but drops nonsense', () => {
    expect(parseDomains('a.com, b.com')).toEqual(['a.com', 'b.com']);
    expect(parseDomains('  A.COM   b.com ')).toEqual(['a.com', 'b.com']);
    expect(parseDomains('@a.com')).toEqual(['a.com']);
    // A bare word is not a domain and must not become one.
    expect(parseDomains('localhost')).toEqual([]);
    expect(parseDomains('')).toEqual([]);
    expect(parseDomains(undefined)).toEqual([]);
  });
});

describe('Google ID token claims', () => {
  const NOW = 1_800_000_000;
  const CLIENT = 'client-123.apps.googleusercontent.com';
  const NONCE = 'nonce-abcdefghijklmnop';

  const expected = {
    clientId: CLIENT,
    nonce: NONCE,
    allowedDomains: ['deitemeyerbrothers.com'],
    now: NOW,
  };

  const good: GoogleIdClaims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    sub: '1029384756',
    exp: NOW + 3600,
    iat: NOW - 10,
    nonce: NONCE,
    hd: 'deitemeyerbrothers.com',
    email: 'carl@deitemeyerbrothers.com',
    email_verified: true,
    name: 'Carl Bledsoe',
  };

  it('accepts a well-formed Workspace token', () => {
    const r = verifyGoogleClaims(good, expected);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.subject).toBe('1029384756');
      expect(r.identity.email).toBe('carl@deitemeyerbrothers.com');
      expect(r.identity.domain).toBe('deitemeyerbrothers.com');
      expect(r.identity.name).toBe('Carl Bledsoe');
    }
  });

  it('refuses a personal Google account, which carries no hd claim', () => {
    const r = verifyGoogleClaims({ ...good, hd: undefined, email: 'someone@gmail.com' }, expected);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_workspace');
  });

  it('refuses another company’s Workspace', () => {
    const r = verifyGoogleClaims(
      { ...good, hd: 'othercompany.com', email: 'rival@othercompany.com' },
      expected,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_domain');
  });

  it('refuses an address outside the domain even when hd is right', () => {
    // A Workspace can host several domains. The hd claim can name an allowed
    // one while the address — which is what gets matched to an employee —
    // sits in a domain nobody allowed.
    const r = verifyGoogleClaims(
      { ...good, hd: 'deitemeyerbrothers.com', email: 'contractor@elsewhere.com' },
      expected,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_email_domain');
  });

  it('refuses an unverified e-mail address', () => {
    expect(verifyGoogleClaims({ ...good, email_verified: false }, expected).ok).toBe(false);
    expect(verifyGoogleClaims({ ...good, email_verified: undefined }, expected).ok).toBe(false);
    // The string form Google has used in places is accepted.
    expect(verifyGoogleClaims({ ...good, email_verified: 'true' }, expected).ok).toBe(true);
    // But not any other truthy value.
    expect(verifyGoogleClaims({ ...good, email_verified: 1 }, expected).ok).toBe(false);
    expect(verifyGoogleClaims({ ...good, email_verified: 'yes' }, expected).ok).toBe(false);
  });

  it('refuses a token minted for a different OAuth client', () => {
    const r = verifyGoogleClaims({ ...good, aud: 'someone-elses-client' }, expected);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad_audience');
  });

  it('accepts an audience array containing this client', () => {
    expect(verifyGoogleClaims({ ...good, aud: ['other', CLIENT] }, expected).ok).toBe(true);
    expect(verifyGoogleClaims({ ...good, aud: ['other', 'another'] }, expected).ok).toBe(false);
  });

  it('refuses a token from an issuer that is not Google', () => {
    expect(verifyGoogleClaims({ ...good, iss: 'https://evil.example' }, expected).ok).toBe(false);
    // Google documents both spellings.
    expect(verifyGoogleClaims({ ...good, iss: 'accounts.google.com' }, expected).ok).toBe(true);
  });

  it('refuses an expired token, allowing a little clock skew', () => {
    expect(verifyGoogleClaims({ ...good, exp: NOW - 300 }, expected).ok).toBe(false);
    expect(verifyGoogleClaims({ ...good, exp: NOW - 30 }, expected).ok).toBe(true);
    expect(verifyGoogleClaims({ ...good, exp: undefined }, expected).ok).toBe(false);
  });

  it('refuses a token dated well into the future', () => {
    expect(verifyGoogleClaims({ ...good, iat: NOW + 600 }, expected).ok).toBe(false);
    expect(verifyGoogleClaims({ ...good, iat: NOW + 30 }, expected).ok).toBe(true);
  });

  it('refuses a token answering a different sign-in attempt', () => {
    const r = verifyGoogleClaims({ ...good, nonce: 'a-different-nonce00' }, expected);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('nonce_mismatch');
  });

  it('refuses a token with no nonce at all', () => {
    const r = verifyGoogleClaims({ ...good, nonce: undefined }, expected);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_nonce');
  });

  it('refuses a token with no subject', () => {
    expect(verifyGoogleClaims({ ...good, sub: undefined }, expected).ok).toBe(false);
    expect(verifyGoogleClaims({ ...good, sub: '' }, expected).ok).toBe(false);
  });

  it('normalizes the address and domain to lower case', () => {
    const r = verifyGoogleClaims(
      { ...good, email: 'Carl@DeitemeyerBrothers.COM', hd: 'DeitemeyerBrothers.com' },
      expected,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.email).toBe('carl@deitemeyerbrothers.com');
      expect(r.identity.domain).toBe('deitemeyerbrothers.com');
    }
  });

  it('matches a sub-domain only when it is listed in its own right', () => {
    const r = verifyGoogleClaims(
      { ...good, hd: 'field.deitemeyerbrothers.com', email: 'c@field.deitemeyerbrothers.com' },
      expected,
    );
    expect(r.ok).toBe(false);
    const allowed = verifyGoogleClaims(
      { ...good, hd: 'field.deitemeyerbrothers.com', email: 'c@field.deitemeyerbrothers.com' },
      { ...expected, allowedDomains: ['deitemeyerbrothers.com', 'field.deitemeyerbrothers.com'] },
    );
    expect(allowed.ok).toBe(true);
  });

  it('is not fooled by a look-alike domain', () => {
    for (const hd of [
      'deitemeyerbrothers.com.evil.example',
      'notdeitemeyerbrothers.com',
      'deitemeyerbrothers.co',
    ]) {
      const r = verifyGoogleClaims({ ...good, hd, email: `x@${hd}` }, expected);
      expect(r.ok, hd).toBe(false);
    }
  });
});

describe('the authorization-code exchange', () => {
  const config = {
    clientId: 'client-123.apps.googleusercontent.com',
    clientSecret: 'secret-value',
    allowedDomains: ['deitemeyerbrothers.com'],
    redirectUri: 'https://elevate.example.com/api/auth/sso/callback',
    autoProvision: false,
  };
  const NOW_MS = 1_800_000_000_000;
  const NONCE = 'nonce-abcdefghijklmnop';

  /** A Google that answers with whatever the test wants. */
  function fakeGoogle(response: { status?: number; body?: unknown; throws?: boolean }) {
    return async () => {
      if (response.throws) throw new Error('network down');
      return new Response(JSON.stringify(response.body ?? {}), {
        status: response.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  }

  const claimsFor = (over: Record<string, unknown> = {}) => ({
    iss: 'https://accounts.google.com',
    aud: config.clientId,
    sub: '1029384756',
    exp: NOW_MS / 1000 + 3600,
    iat: NOW_MS / 1000 - 10,
    nonce: NONCE,
    hd: 'deitemeyerbrothers.com',
    email: 'carl@deitemeyerbrothers.com',
    email_verified: true,
    ...over,
  });

  const deps = (
    fetchImpl: typeof fetch,
    claims: Record<string, unknown> | Error = claimsFor(),
  ) => ({
    fetchImpl,
    now: () => NOW_MS,
    verifyIdToken: async () => {
      if (claims instanceof Error) throw claims;
      return claims;
    },
  });

  it('turns a code into a verified identity', async () => {
    const r = await exchangeCode(
      config,
      { code: 'auth-code', codeVerifier: 'verifier', nonce: NONCE },
      deps(fakeGoogle({ body: { id_token: 'header.payload.signature' } })),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.claims.ok) {
      expect(r.claims.identity.email).toBe('carl@deitemeyerbrothers.com');
    }
  });

  it('sends the secret and the PKCE verifier to Google, not to the browser', async () => {
    let seen: URLSearchParams | null = null;
    const spy: typeof fetch = async (_url, init) => {
      seen = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ id_token: 'a.b.c' }), { status: 200 });
    };
    await exchangeCode(
      config,
      { code: 'auth-code', codeVerifier: 'the-verifier', nonce: NONCE },
      deps(spy),
    );
    expect(seen).not.toBeNull();
    const body = seen as unknown as URLSearchParams;
    expect(body.get('client_secret')).toBe('secret-value');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('refuses when Google rejects the code', async () => {
    const r = await exchangeCode(
      config,
      { code: 'stale', codeVerifier: 'v', nonce: NONCE },
      deps(fakeGoogle({ status: 400, body: { error: 'invalid_grant' } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_exchange_failed');
  });

  it('refuses when Google cannot be reached, rather than letting anybody in', async () => {
    const r = await exchangeCode(
      config,
      { code: 'c', codeVerifier: 'v', nonce: NONCE },
      deps(fakeGoogle({ throws: true })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_endpoint_unreachable');
  });

  it('refuses a response with no ID token', async () => {
    const r = await exchangeCode(
      config,
      { code: 'c', codeVerifier: 'v', nonce: NONCE },
      deps(fakeGoogle({ body: { access_token: 'only-this' } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_id_token');
  });

  it('refuses when the signature does not verify', async () => {
    const r = await exchangeCode(
      config,
      { code: 'c', codeVerifier: 'v', nonce: NONCE },
      deps(fakeGoogle({ body: { id_token: 'forged' } }), new Error('signature verification failed')),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_invalid');
  });

  it('still applies the domain rule to a perfectly signed token', async () => {
    // A real, Google-signed token for a personal account. The signature is
    // fine; the account is not ours. This is the case the whole feature exists
    // to refuse, so it is asserted end to end rather than only in the claim
    // checker.
    const r = await exchangeCode(
      config,
      { code: 'c', codeVerifier: 'v', nonce: NONCE },
      deps(
        fakeGoogle({ body: { id_token: 'valid.but.personal' } }),
        claimsFor({ hd: undefined, email: 'someone@gmail.com' }),
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.ok).toBe(false);
      if (!r.claims.ok) expect(r.claims.reason).toBe('not_workspace');
    }
  });

  it('builds an authorize URL with state, nonce and PKCE', () => {
    const pending = beginLogin();
    expect(pending.state).not.toBe(pending.nonce);
    expect(pending.codeVerifier.length).toBeGreaterThanOrEqual(43);

    const url = new URL(authorizeUrl(config, pending));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(config.clientId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.get('nonce')).toBe(pending.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('hd')).toBe('deitemeyerbrothers.com');
    // The verifier itself must never leave the server.
    expect(url.toString()).not.toContain(pending.codeVerifier);
    // Nor the client secret.
    expect(url.toString()).not.toContain(config.clientSecret);
  });

  it('compares state in a way that rejects mismatches and blanks', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'ab')).toBe(false);
    expect(statesMatch(null, 'abc')).toBe(false);
    expect(statesMatch('abc', null)).toBe(false);
    expect(statesMatch('', '')).toBe(false);
  });
});

describe('which accounts get a password', () => {
  const on = resolveSso(BASE_ENV);
  const off = resolveSso({});
  const multi = resolveSso({ ...BASE_ENV, GOOGLE_WORKSPACE_DOMAIN: 'deitemeyerbrothers.com, db-field.com' });

  it('gives no password to an address in the Workspace', () => {
    expect(addressUsesSso(on, 'rosa@deitemeyerbrothers.com')).toBe(true);
    expect(addressUsesSso(on, 'ROSA@DeitemeyerBrothers.COM')).toBe(true);
  });

  it('gives a password to an address outside it', () => {
    expect(addressUsesSso(on, 'rosa@gmail.com')).toBe(false);
    expect(addressUsesSso(on, 'rosa@deitemeyerbrothers.com.evil.example')).toBe(false);
    expect(addressUsesSso(on, 'rosa@notdeitemeyerbrothers.com')).toBe(false);
  });

  it('honours every configured domain', () => {
    expect(addressUsesSso(multi, 'crew@db-field.com')).toBe(true);
    expect(addressUsesSso(multi, 'office@deitemeyerbrothers.com')).toBe(true);
    expect(addressUsesSso(multi, 'someone@elsewhere.com')).toBe(false);
  });

  it('gives everyone a password when SSO is not configured', () => {
    // Otherwise a deployment with no SSO would create accounts that have
    // neither a password nor any way to sign in.
    expect(addressUsesSso(off, 'rosa@deitemeyerbrothers.com')).toBe(false);
  });

  it('is not confused by a malformed address', () => {
    expect(addressUsesSso(on, 'not-an-address')).toBe(false);
    expect(addressUsesSso(on, '')).toBe(false);
    expect(addressUsesSso(on, '@deitemeyerbrothers.com')).toBe(true);
  });

  it('is decided by the domain alone, never by the local part', () => {
    // A local part that merely contains an allowed domain must not pass.
    expect(addressUsesSso(on, 'deitemeyerbrothers.com@gmail.com')).toBe(false);
  });
});
