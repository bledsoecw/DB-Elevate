import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import { verifyGoogleClaims, type ClaimResult, type GoogleIdClaims } from './google-claims';
import type { SsoConfig } from './sso-config';

/**
 * The Google half of single sign-on: the two network calls and the signature
 * check. Everything that decides *who may sign in* lives in google-claims.ts,
 * which is pure and tested.
 *
 * Flow: authorization code with PKCE, plus `state` and `nonce`. All three
 * guard different things and none of them is optional here:
 *
 *  - `state` is compared against a cookie, so a callback the user's browser
 *    did not start is refused. That is the CSRF guard.
 *  - PKCE ties the code to this browser, so a code intercepted in a redirect
 *    cannot be redeemed elsewhere.
 *  - `nonce` is carried inside the ID token, so a token obtained somewhere
 *    else cannot be replayed into this sign-in.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Google's signing keys, fetched once and cached by `jose` with its own
 * rotation handling. Module scope so a key fetch is not repeated per sign-in.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URI));
  return jwks;
}

export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export function beginLogin(): PendingLogin {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    codeVerifier: randomBytes(64).toString('base64url'),
  };
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Where to send the browser to start a sign-in. */
export function authorizeUrl(config: SsoConfig, pending: PendingLogin): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', pending.state);
  url.searchParams.set('nonce', pending.nonce);
  url.searchParams.set('code_challenge', codeChallenge(pending.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  // Ask Google to show only accounts in this Workspace. A convenience for the
  // person signing in, NOT a security control: `hd` here is a hint that a
  // crafted request can drop. The real check is on the returned token.
  if (config.allowedDomains.length === 1) url.searchParams.set('hd', config.allowedDomains[0]);
  // Always show the chooser. Without this, somebody signed into a personal
  // Google account in the same browser is silently refused with no way to
  // understand why.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Constant-time comparison for the state parameter. */
export function statesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface ExchangeDeps {
  /** Injected so tests can run the whole exchange without reaching Google. */
  fetchImpl?: typeof fetch;
  /** Injected so a test can verify claims without a real signature. */
  verifyIdToken?: (idToken: string, config: SsoConfig) => Promise<GoogleIdClaims>;
  now?: () => number;
}

/**
 * Verifies the ID token's signature against Google's published keys.
 *
 * Google's own guidance is that a token fetched directly from the token
 * endpoint over TLS can be trusted without this. It is done anyway: the cost
 * is one cached key fetch, and the alternative is that the only thing standing
 * between a compromised TLS path and a forged identity is the TLS path itself.
 *
 * Failures here are refusals, never fallbacks. If Google's keys cannot be
 * reached, nobody signs in via SSO — which is the right way round for a
 * system holding salary data.
 */
async function verifySignature(idToken: string, config: SsoConfig): Promise<GoogleIdClaims> {
  const { payload } = await jwtVerify(idToken, keySet(), {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.clientId,
  });
  return payload as GoogleIdClaims;
}

export type ExchangeResult =
  | { ok: true; claims: ClaimResult }
  | { ok: false; reason: string; detail: string };

/**
 * Trades the authorization code for tokens and validates the result.
 *
 * The client secret is sent here and only here — server to server, never to a
 * browser.
 */
export async function exchangeCode(
  config: SsoConfig,
  params: { code: string; codeVerifier: string; nonce: string },
  deps: ExchangeDeps = {},
): Promise<ExchangeResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const nowSeconds = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);

  let response: Response;
  try {
    response = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: params.codeVerifier,
      }),
    });
  } catch {
    // Deliberately vague to the caller; the detail is for the audit log.
    return { ok: false, reason: 'token_endpoint_unreachable', detail: 'Could not reach Google.' };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'token_exchange_failed',
      detail: `Google refused the authorization code (HTTP ${response.status}).`,
    };
  }

  let body: { id_token?: unknown };
  try {
    body = (await response.json()) as { id_token?: unknown };
  } catch {
    return { ok: false, reason: 'bad_token_response', detail: 'Google returned an unreadable response.' };
  }

  const idToken = body.id_token;
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return { ok: false, reason: 'no_id_token', detail: 'Google returned no ID token.' };
  }

  let claims: GoogleIdClaims;
  try {
    claims = deps.verifyIdToken
      ? await deps.verifyIdToken(idToken, config)
      : await verifySignature(idToken, config);
  } catch (e) {
    return {
      ok: false,
      reason: 'signature_invalid',
      detail: e instanceof Error ? e.message : 'The ID token signature could not be verified.',
    };
  }

  return {
    ok: true,
    claims: verifyGoogleClaims(claims, {
      clientId: config.clientId,
      nonce: params.nonce,
      allowedDomains: config.allowedDomains,
      now: nowSeconds,
    }),
  };
}

/** Exposed for diagnostics only — never used to make an access decision. */
export function peekClaims(idToken: string): GoogleIdClaims | null {
  try {
    return decodeJwt(idToken) as GoogleIdClaims;
  } catch {
    return null;
  }
}
