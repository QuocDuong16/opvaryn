import { cookies } from 'next/headers';

import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/session-cookie';

/**
 * The web app keeps the API session token in its own httpOnly cookie: the browser
 * never sees the token, and every server-side API call forwards it as a Cookie
 * header. The API is the only thing that can validate it (ADR 0008).
 *
 * The cookie name and options live in `session-cookie.ts` so the proxy can import
 * them without dragging `next/headers` into the edge runtime.
 */
export { SESSION_COOKIE, SESSION_COOKIE_OPTIONS };

/** getSessionToken returns the stored token, if the browser has one. */
export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}
