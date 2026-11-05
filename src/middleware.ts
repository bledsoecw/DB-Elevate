import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge gate: redirects anonymous visitors to the sign-in page.
 *
 * This is a convenience, NOT the security boundary. It only checks that a
 * session cookie is present, because the Edge runtime cannot reach the
 * database. Every page and API route independently resolves the session and
 * authorizes the actor server-side; see src/server/authz.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health', '/favicon.ico'];

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
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
