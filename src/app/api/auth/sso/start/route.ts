import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeUrl, beginLogin } from '@/server/auth/google';
import { ssoState } from '@/server/auth/sso';

/**
 * Starts a Google sign-in.
 *
 * The state, nonce and PKCE verifier are generated here and kept in
 * short-lived httpOnly cookies. They never reach JavaScript in the page, and
 * the callback refuses anything it cannot match against them.
 */
export const dynamic = 'force-dynamic';

const PENDING_TTL_SECONDS = 10 * 60;

export async function GET(request: NextRequest) {
  const state = ssoState();
  if (!state.enabled) {
    return NextResponse.redirect(new URL('/login?sso=unavailable', request.nextUrl.origin));
  }

  const pending = beginLogin();
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  const common = {
    httpOnly: true,
    // Lax, not Strict: the browser arrives back here from accounts.google.com
    // as a top-level navigation, and Strict would withhold the cookies that
    // the callback needs in order to verify the response.
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: PENDING_TTL_SECONDS,
  };
  store.set('dbe_sso_state', pending.state, common);
  store.set('dbe_sso_nonce', pending.nonce, common);
  store.set('dbe_sso_verifier', pending.codeVerifier, common);

  // Where to land afterwards. Only a path within this application is kept, so
  // the parameter cannot be used to bounce somebody to another site.
  const next = request.nextUrl.searchParams.get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    store.set('dbe_sso_next', next, common);
  }

  return NextResponse.redirect(authorizeUrl(state.config, pending));
}
