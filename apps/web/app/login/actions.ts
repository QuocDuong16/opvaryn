'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { loginViaApi, logoutViaApi } from '@/lib/api/auth';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, getSessionToken } from '@/lib/session';

import type { LoginState } from '@/components/auth/login-state';

/**
 * Signs in through the API and stores the resulting token in the web app's own
 * httpOnly cookie. The browser never sees the token; server components and actions
 * forward it to the API (ADR 0008).
 */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (email === '' || password === '') {
    return { status: 'error', message: 'Nhập email và mật khẩu.' };
  }

  const outcome = await loginViaApi(email, password);
  if (!outcome.ok || !outcome.token) {
    return { status: 'error', message: outcome.message ?? 'Đăng nhập thất bại.' };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, outcome.token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 60 * 60 * 12,
  });
  redirect('/');
}

/** Signs out: the API session ends and the local cookie is removed. */
export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  await logoutViaApi(token);

  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
