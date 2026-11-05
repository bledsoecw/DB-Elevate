import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge gate: redirects anonymous visitors to the sign-in page.
 *
 * This is a convenience, NOT the security boundary. It only checks that a
 * session cookie is present, because the Edge runtime cannot reach the
 * database. Every page and API route independently resolves the session and
 * authorizes the actor server-side; see src/server/authz.
 */
/**
 * Paths that must bypass the cookie check.
 *
 * `/api/jobs/run` is here because it is machine-to-machine: a scheduler has no
 * session cookie to send. It is not unprotected — the route itself requires a
 * bearer token compared in constant time, and returns 404 unless JOBS_TOKEN is
 * configured. Letting it past this gate only means the route gets to apply its
 * own, stricter check instead of being refused with a misleading 401.
 */
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  // The single-sign-on round trip happens before there is a session, so both
  // ends of it have to be reachable without one. Neither grants anything on
  // its own: the callback verifies Google's response before issuing a session.
  '/api/auth/sso/start',
  '/api/auth/sso/callback',
  '/api/health',
  '/api/jobs/run',
  '/favicon.ico',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get('dbe_session')?.value);
  if (hasSessionCookie) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'auth_required', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Static assets skip the gate entirely. Fonts are in this list because they
   * were not, and the sign-in page — where by definition nobody has a session
   * cookie — had its font requests redirected to /login and rendered in the
   * fallback face. Nothing here is sensitive: these are the same files any
   * visitor to the sign-in page already receives.
   */
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf)$).*)',
  ],
};
