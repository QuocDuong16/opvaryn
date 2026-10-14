import type { Me } from '@opvaryn/contracts';

import { SESSION_COOKIE } from '@/lib/session';

const DEFAULT_API_BASE_URL = 'http://localhost:21501';

function apiBaseUrl(): string {
  return (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).replace(/\/$/, '');
}

export interface LoginOutcome {
  ok: boolean;
  token?: string;
  message?: string;
}

/**
 * loginViaApi signs in and returns the session token from the API's Set-Cookie
 * header. It talks to the API directly (not through the contracts client) because
 * the token lives in a response header, not in the JSON body.
 */
export async function loginViaApi(email: string, password: string): Promise<LoginOutcome> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, message: 'Không gọi được API. Kiểm tra server Go ở cổng 21501.' };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { ok: false, message: 'Email hoặc mật khẩu không đúng.' };
    }
    return { ok: false, message: `Đăng nhập thất bại (HTTP ${response.status}).` };
  }

  const token = readSessionCookie(response.headers.get('set-cookie'));
  if (!token) {
    return {
      ok: false,
      message: 'API không trả session cookie. Kiểm tra phiên bản API đang chạy.',
    };
  }
  return { ok: true, token };
}

/** logoutViaApi ends the session server-side. An unknown token is not an error. */
export async function logoutViaApi(token: string | undefined): Promise<void> {
  if (!token) {
    return;
  }
  try {
    await fetch(`${apiBaseUrl()}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
  } catch {
    // The local cookie is cleared regardless; a session that cannot be reached now
    // will expire on its own.
  }
}

/** readSessionCookie pulls one cookie value out of a Set-Cookie header. */
export function readSessionCookie(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return rest.join('=');
    }
  }
  return undefined;
}

/** SessionUser is the signed-in user as far as the web shell needs it. */
export type SessionUser = Me;
