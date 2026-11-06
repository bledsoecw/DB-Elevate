/**
 * Single-sign-on configuration.
 *
 * Pure: reads an environment record and returns a decision. No process.env, no
 * network, no database — so every rule below is testable, which matters more
 * here than anywhere else in this application. A mistake in this file is the
 * difference between "only our Workspace can sign in" and "anyone with a
 * Google account can sign in".
 *
 * Deliberately NOT configurable from inside the application. The allowed
 * domain is a property of the deployment, set once in the environment, and a
 * system administrator cannot widen it from a settings page. Someone who
 * compromises an administrator account should not be able to turn
 * "deitemeyerbrothers.com only" into "any domain" with two clicks.
 */

export interface SsoConfig {
  /** Google OAuth client id. Public by nature; it appears in the redirect. */
  clientId: string;
  /** Google OAuth client secret. Server-side only, never sent to a browser. */
  clientSecret: string;
  /**
   * Workspace domains allowed to sign in, lower-cased. An ID token must carry
   * an `hd` claim matching one of these AND an e-mail address in the same
   * domain. Empty means SSO is not configured.
   */
  allowedDomains: string[];
  /** Absolute callback URL registered with Google. */
  redirectUri: string;
  /**
   * Whether a user who signs in successfully but has no account here is
   * created on the spot. Off unless explicitly enabled: this application holds
   * salary and review data, and every account in a Workspace — shared
   * mailboxes, contractors, service accounts — would otherwise get in.
   */
  autoProvision: boolean;
}

export type SsoState =
  | { enabled: false; reason: string }
  | { enabled: true; config: SsoConfig; passwordLoginAllowed: boolean };

export interface SsoEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_WORKSPACE_DOMAIN?: string;
  SSO_REDIRECT_URI?: string;
  APP_URL?: string;
  SSO_AUTO_PROVISION?: string;
  ALLOW_PASSWORD_LOGIN?: string;
  NODE_ENV?: string;
}

/** Splits a comma or space separated domain list, lower-casing and trimming. */
export function parseDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter((d) => d.length > 0 && d.includes('.'));
}

/**
 * Resolves whether SSO is on, and whether passwords still work alongside it.
 *
 * Both halves matter. "Only our Google Workspace accounts can sign in" is only
 * true if the password endpoint also refuses, which is why that decision lives
 * here rather than being a property of the sign-in page's markup.
 */
export function resolveSso(env: SsoEnv): SsoState {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const allowedDomains = parseDomains(env.GOOGLE_WORKSPACE_DOMAIN);

  if (!clientId || !clientSecret) {
    return { enabled: false, reason: 'No Google OAuth client is configured.' };
  }
  if (allowedDomains.length === 0) {
    // Fail closed. A client with no domain restriction would let any Google
    // account in, which is the opposite of what this is for.
    return {
      enabled: false,
      reason:
        'GOOGLE_WORKSPACE_DOMAIN is not set. Sign-in is restricted to a named Workspace domain, and without one single sign-on stays off rather than accepting any Google account.',
    };
  }

  const base = (env.SSO_REDIRECT_URI?.trim() || env.APP_URL?.trim() || '').replace(/\/+$/, '');
  if (!base) {
    return { enabled: false, reason: 'APP_URL or SSO_REDIRECT_URI must be set for the callback.' };
  }
  const redirectUri = env.SSO_REDIRECT_URI?.trim()
    ? env.SSO_REDIRECT_URI.trim()
    : `${base}/api/auth/sso/callback`;

  if (!/^https:\/\//i.test(redirectUri) && !/^http:\/\/localhost(:\d+)?(\/|$)/i.test(redirectUri)) {
    return {
      enabled: false,
      reason: `The callback URL must be https (or http://localhost for development). Got: ${redirectUri}`,
    };
  }

  return {
    enabled: true,
    config: {
      clientId,
      clientSecret,
      allowedDomains,
      redirectUri,
      autoProvision: env.SSO_AUTO_PROVISION === 'true',
    },
    // Once SSO is on, passwords are off unless somebody deliberately keeps
    // them. Opt-in rather than opt-out: forgetting to set a variable should
    // tighten access, never loosen it.
    passwordLoginAllowed: env.ALLOW_PASSWORD_LOGIN === 'true',
  };
}

/**
 * Whether a new account for this address should have no password at all.
 *
 * True when single sign-on is configured and the address belongs to one of
 * the allowed Workspace domains — that person signs in with Google, so a
 * password would be a credential nobody needs, nobody uses, and somebody can
 * eventually steal.
 */
export function addressUsesSso(state: SsoState, email: string): boolean {
  if (!state.enabled) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return state.config.allowedDomains.includes(domain);
}
