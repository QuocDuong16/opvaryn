import { cookies } from 'next/headers';

/** Supported UI themes. Dark is the default, matching the playbook's dark-first shell. */
export type Theme = 'dark' | 'light';

export const THEME_COOKIE = 'opvaryn.theme';
export const DEFAULT_THEME: Theme = 'dark';

/**
 * Reads the theme from a cookie so the server can render the correct
 * `data-theme` on the first paint — no flash and no client storage.
 */
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  return store.get(THEME_COOKIE)?.value === 'light' ? 'light' : DEFAULT_THEME;
}

/** Returns the theme a toggle press should switch to. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}
