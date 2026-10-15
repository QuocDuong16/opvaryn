/**
 * The web app's own session cookie. It lives in its own module with no `next/headers`
 * import so the proxy (edge runtime) can name the cookie too — importing `cookies()`
 * there would pull a Node-only API into the edge bundle (ADR 0014).
 */
export const SESSION_COOKIE = 'opvaryn.session';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const;
