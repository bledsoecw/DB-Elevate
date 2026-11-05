import 'server-only';
import { resolveSso, type SsoState } from './sso-config';

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
