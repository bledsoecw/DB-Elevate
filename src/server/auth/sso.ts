import 'server-only';
import { addressUsesSso, resolveSso, type SsoState } from './sso-config';

/**
 * The live SSO state for this deployment, read from the process environment.
 *
 * One place reads process.env so every other module takes a plain object and
 * stays testable. Not cached: an environment variable cannot change inside a
 * running process, but a module-level cache would survive a hot reload in
 * development and quietly serve stale configuration.
 */
export function ssoState(): SsoState {
  return resolveSso({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_WORKSPACE_DOMAIN: process.env.GOOGLE_WORKSPACE_DOMAIN,
    SSO_REDIRECT_URI: process.env.SSO_REDIRECT_URI,
    APP_URL: process.env.APP_URL,
    SSO_AUTO_PROVISION: process.env.SSO_AUTO_PROVISION,
    ALLOW_PASSWORD_LOGIN: process.env.ALLOW_PASSWORD_LOGIN,
    NODE_ENV: process.env.NODE_ENV,
  });
}

/**
 * Whether password sign-in is accepted at all.
 *
 * With SSO off, passwords are the only way in. With SSO on, they are refused
 * unless ALLOW_PASSWORD_LOGIN is explicitly "true" — which is what makes
 * "only our Workspace accounts can sign in" true of the server and not just
 * of the sign-in page.
 */
export function passwordLoginAllowed(): boolean {
  const state = ssoState();
  return !state.enabled || state.passwordLoginAllowed;
}

/** What the sign-in page needs to know. Carries no secret. */
export interface SsoPublicState {
  enabled: boolean;
  passwordAllowed: boolean;
  domains: string[];
}

export function ssoPublicState(): SsoPublicState {
  const state = ssoState();
  if (!state.enabled) return { enabled: false, passwordAllowed: true, domains: [] };
  return {
    enabled: true,
    passwordAllowed: state.passwordLoginAllowed,
    domains: state.config.allowedDomains,
  };
}

/**
 * Whether an account for this address signs in with Google rather than a
 * password. Used wherever an account is created, so the three creation paths
 * — import, a single employee, and Administration -> Accounts — cannot drift
 * apart on the question of who gets a password.
 */
export function accountUsesSso(email: string): boolean {
  return addressUsesSso(ssoState(), email);
}

/**
 * Whether the password endpoint must refuse this address outright.
 *
 * Stronger than switching passwords off globally, and deliberately so. With
 * ALLOW_PASSWORD_LOGIN unset, passwords are off for everybody; the moment
 * somebody turns them on for one exception, every company account becomes
 * reachable by password again. This rule says a Workspace address signs in
 * with Google *whatever else is configured*, so turning passwords on for an
 * exception cannot weaken the accounts that hold salary and review data.
 *
 * It leaks nothing. The answer depends only on the domain of the address the
 * caller already typed, not on whether any account exists.
 */
export function mustUseSso(email: string): boolean {
  return accountUsesSso(email);
}
