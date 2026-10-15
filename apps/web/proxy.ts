import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * The workspace is behind the sign-in (ADR 0014). A visitor without the session cookie
 * is sent to /login carrying the path they asked for, so signing in returns them to it.
 *
 * Only the cookie's presence can be checked here; the API validates the token on every
 * call, and that is where authorization actually lives (ADR 0008). A stale cookie
 * therefore reaches the screen, which answers with its own sign-in card instead of
 * pretending the data loaded.
 */
const PUBLIC_PATHS = new Set(['/', '/login']);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  if (PUBLIC_PATHS.has(pathname)) {
    // Someone already signed in does not need the sign-in screen.
    if (pathname === '/login' && signedIn) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }
    return NextResponse.next();
  }

  if (signedIn) {
    return NextResponse.next();
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
