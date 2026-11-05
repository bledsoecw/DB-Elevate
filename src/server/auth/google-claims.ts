/**
 * Google ID token claim checks.
 *
 * Pure. Given a decoded payload and the expectations, decide whether this
 * token may sign somebody in. Separated from the network so the rules can be
 * tested exhaustively — including the cases that must FAIL, which are the ones
 * that matter.
 *
 * Signature verification happens before this, in google.ts. A valid signature
 * only proves Google issued the token; it says nothing about whether the token
 * was issued for this application, recently, in answer to this request, or to
 * somebody in the right company. That is all decided here.
 */

export interface GoogleIdClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  hd?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

export interface VerifiedIdentity {
  /** Google's stable, never-reused identifier for the account. */
  subject: string;
  email: string;
  domain: string;
  name: string | null;
}

export type ClaimResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: string; detail: string };

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Tolerance for clock skew between this server and Google, in seconds. */
const SKEW_SECONDS = 120;

export function verifyGoogleClaims(
  claims: GoogleIdClaims,
  expected: {
    clientId: string;
    nonce: string;
    allowedDomains: string[];
    /** Unix seconds; injected so the check is testable. */
    now: number;
  },
): ClaimResult {
  const refused = (reason: string, detail: string): ClaimResult => ({ ok: false, reason, detail });

  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) {
    return refused('bad_issuer', `Issuer was ${JSON.stringify(claims.iss)}.`);
  }

  // `aud` is what stops a token minted for a different application — including
  // one an attacker controls — from being replayed here.
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(expected.clientId)) {
    return refused('bad_audience', 'The token was issued for a different OAuth client.');
  }

  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < expected.now) {
    return refused('expired', 'The token has expired.');
  }
  if (typeof claims.iat !== 'number' || claims.iat - SKEW_SECONDS > expected.now) {
    return refused('issued_in_future', 'The token is dated in the future.');
  }

  // The nonce ties this token to the sign-in attempt that started in this
  // browser. Without it a token captured elsewhere could be posted here.
  if (typeof claims.nonce !== 'string' || claims.nonce.length === 0) {
    return refused('missing_nonce', 'The token carries no nonce.');
  }
  if (!timingSafeEqualString(claims.nonce, expected.nonce)) {
    return refused('nonce_mismatch', 'The token answers a different sign-in attempt.');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return refused('missing_subject', 'The token carries no subject.');
  }

  if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
    return refused('missing_email', 'The token carries no e-mail address.');
  }
  // Google sends this as a boolean, but has historically sent the string
  // "true" in some contexts. Accept both, reject everything else.
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!emailVerified) {
    return refused('email_unverified', 'The e-mail address on the account is not verified.');
  }

  const email = claims.email.trim().toLowerCase();
  const emailDomain = email.slice(email.lastIndexOf('@') + 1);

  // `hd` is the Workspace domain. A personal gmail.com account has no `hd` at
  // all, which is exactly the case this has to refuse.
  if (typeof claims.hd !== 'string' || claims.hd.length === 0) {
    return refused(
      'not_workspace',
      'The account is a personal Google account rather than a Workspace account.',
    );
  }
  const hd = claims.hd.trim().toLowerCase();

  const allowed = expected.allowedDomains.map((d) => d.toLowerCase());
  if (!allowed.includes(hd)) {
    return refused('wrong_domain', `The account belongs to ${hd}.`);
  }

  // Both, not either. `hd` names the Workspace the account lives in; the
  // address is what this application matches a person by. A Workspace can host
  // several domains, so an account in the right Workspace can still carry an
  // address in a domain that was never allowed here — and that address is the
  // one that would be matched to an employee record.
  if (!allowed.includes(emailDomain)) {
    return refused('wrong_email_domain', `The address is at ${emailDomain}.`);
  }

  return {
    ok: true,
    identity: {
      subject: claims.sub,
      email,
      domain: hd,
      name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
    },
  };
}

/**
 * Length-independent comparison.
 *
 * Not strictly required for a nonce we generated and are comparing to a value
 * from Google, but comparing secrets with === is a habit worth not having.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
