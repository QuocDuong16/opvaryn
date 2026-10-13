import { MoonIcon, SunIcon } from '@phosphor-icons/react/dist/ssr';

import { setTheme } from '@/app/actions/theme';
import { getTheme, nextTheme } from '@/lib/theme';

/**
 * Theme toggle. The choice is stored in a cookie through a server action, so
 * the server renders the right theme on first paint and no client storage or
 * hydration-time script is needed.
 */
export async function ThemeToggle() {
  const theme = await getTheme();
  const target = nextTheme(theme);

  return (
    <form action={setTheme.bind(null, target)}>
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-on-surface-muted transition-colors hover:border-border-strong hover:text-on-surface"
      >
        {theme === 'dark' ? (
          <SunIcon aria-hidden size={14} weight="bold" />
        ) : (
          <MoonIcon aria-hidden size={14} weight="bold" />
        )}
        {theme === 'dark' ? 'Sáng' : 'Tối'}
      </button>
    </form>
  );
}
