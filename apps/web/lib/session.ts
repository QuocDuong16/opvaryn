import { cookies } from 'next/headers';

/**
 * The web app keeps the API session token in its own httpOnly cookie: the browser
 * never sees the token, and every server-side API call forwards it as a Cookie
 * header. The API is the only thing that can validate it (ADR 0008).
 */
export const SESSION_COOKIE = 'opvaryn.session';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const;

/** getSessionToken returns the stored token, if the browser has one. */
export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}
