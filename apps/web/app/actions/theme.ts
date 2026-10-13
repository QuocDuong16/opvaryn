'use server';

import { cookies } from 'next/headers';

import { DEFAULT_THEME, THEME_COOKIE, type Theme } from '@/lib/theme';

/** Persists the theme choice; the root layout re-renders with the new value. */
export async function setTheme(theme: Theme): Promise<void> {
  const store = await cookies();
  store.set(THEME_COOKIE, theme === 'light' ? 'light' : DEFAULT_THEME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
