import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, statesMatch } from '@/server/auth/google';
import { ssoState } from '@/server/auth/sso';
import { signInWithGoogle } from '@/server/auth/sso-signin';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { requestMeta } from '@/server/api';
import { AUDIT_ACTIONS, recordSystemAudit } from '@/server/audit';
import { prisma } from '@/server/db';

/**
 * Where Google sends the browser back.
 *
 * Every refusal here lands on the sign-in page with a short code rather than a
 * message in the URL, so nothing an attacker controls is reflected onto the
 * page. The detail goes to the audit log, which is where somebody debugging a
 * refused sign-in should be looking anyway.
 */
export const dynamic = 'force-dynamic';

const PENDING_COOKIES = ['dbe_sso_state', 'dbe_sso_nonce', 'dbe_sso_verifier', 'dbe_sso_next'];

async function clearPending(): Promise<void> {
  const store = await cookies();
  for (const name of PENDING_COOKIES) store.delete(name);
}

function back(request: NextRequest, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?sso=${encodeURIComponent(code)}`, request.nextUrl.origin));
}

/** Audit a refusal even when no account is involved, so attempts are visible. */
async function noteRefusal(reason: string, detail: string, ip: string | null): Promise<void> {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return;
  await recordSystemAudit(org.id, {
    action: AUDIT_ACTIONS.SSO_REFUSED,
    entityType: 'auth',
    entityId: 'sso',
    summary: `Refused a single sign-on attempt: ${detail}`,
    metadata: { reason, ip },
  });
}

export async function GET(request: NextRequest) {
  const state = ssoState();
  if (!state.enabled) return back(request, 'unavailable');

  const meta = requestMeta(request);
  const store = await cookies();
  const params = request.nextUrl.searchParams;

  // Google reports its own failures here — a cancelled consent screen, most
  // often. Not an error worth alarming anybody about.
  const googleError = params.get('error');
  if (googleError) {
    await clearPending();
    return back(request, googleError === 'access_denied' ? 'cancelled' : 'provider_error');
  }

  const expectedState = store.get('dbe_sso_state')?.value ?? null;
  const nonce = store.get('dbe_sso_nonce')?.value ?? null;
  const verifier = store.get('dbe_sso_verifier')?.value ?? null;
  const next = store.get('dbe_sso_next')?.value ?? null;

  // A callback with no pending cookies is either a stale tab, a bookmarked
  // callback URL, or somebody else's request. All three are refused the same.
  if (!expectedState || !nonce || !verifier) {
    await clearPending();
    await noteRefusal('no_pending_login', 'the browser had no sign-in in progress', meta.ip);
    return back(request, 'expired');
  }

  if (!statesMatch(params.get('state'), expectedState)) {
    await clearPending();
    await noteRefusal('state_mismatch', 'the state parameter did not match', meta.ip);
    return back(request, 'state');
  }

  const code = params.get('code');
  if (!code) {
    await clearPending();
    await noteRefusal('no_code', 'no authorization code was returned', meta.ip);
    return back(request, 'provider_error');
  }

  const exchanged = await exchangeCode(state.config, { code, codeVerifier: verifier, nonce });
  await clearPending();

  if (!exchanged.ok) {
    await noteRefusal(exchanged.reason, exchanged.detail, meta.ip);
    return back(request, 'provider_error');
  }
  if (!exchanged.claims.ok) {
    await noteRefusal(exchanged.claims.reason, exchanged.claims.detail, meta.ip);
    // The two the person can actually act on are told apart, because "you used
    // your personal account" and "something went wrong" call for different
    // next steps.
    const code =
      exchanged.claims.reason === 'not_workspace' ||
      exchanged.claims.reason === 'wrong_domain' ||
      exchanged.claims.reason === 'wrong_email_domain'
        ? 'domain'
        : 'token';
    return back(request, code);
  }

  const result = await signInWithGoogle(exchanged.claims.identity, state.config, meta);
  if (!result.ok) {
    return back(request, result.code === 'sso_no_account' ? 'no_account' : result.code);
  }

  const { token, expiresAt } = await createSession(result.userId, meta);
  await setSessionCookie(token, expiresAt);

  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(new URL(destination, request.nextUrl.origin));
}
