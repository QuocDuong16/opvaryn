import Link from 'next/link';

import { cn } from '@/lib/utils';

export interface TabItem {
  /** Matches the value in the URL's `tab` parameter. */
  key: string;
  label: string;
  href: string;
  /** What is behind the tab, when the screen already knows the number. */
  count?: number;
}

/**
 * Tabs is the segmented navigation a long screen uses to show one subject at a time. The
 * active tab is part of the URL, not component state: a tab is a place, so a link can point
 * at one, a reload keeps it, and a person can send it to someone else (ADR 0017).
 */
export function Tabs({
  items,
  active,
  label,
}: {
  items: readonly TabItem[];
  active: string;
  /** Accessible name of the group, e.g. "Các phần của loại dữ liệu". */
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-3">
      {items.map((item) => {
        const current = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              current
                ? 'bg-accent/10 text-on-surface ring-1 ring-accent-strong/40'
                : 'text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
            )}
          >
            {item.label}
            {item.count === undefined ? null : (
              <span className="ml-2 text-xs text-on-surface-muted">{item.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
