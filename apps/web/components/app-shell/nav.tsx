'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { NavItem } from '@/app/nav';
import { cn } from '@/lib/utils';

/** Vertical navigation used in the desktop sidebar. */
export function SidebarNav({
  items,
  counts = {},
}: {
  items: readonly NavItem[];
  /** What is waiting behind an entry, e.g. open tasks; zero or absent shows no badge. */
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href;
        const count = counts[item.href] ?? 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent/10 text-on-surface'
                : 'text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
            )}
          >
            <span
              className={cn(
                'font-mono text-[11px]',
                active ? 'text-accent-strong' : 'text-on-surface-muted',
              )}
            >
              {item.index}
            </span>
            <span className="font-medium">{item.label}</span>
            {count > 0 ? (
              <span
                title={`${count} việc đang chờ`}
                className="ml-auto rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-strong"
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal navigation strip used below the topbar on small screens. */
export function CompactNav({
  items,
  counts = {},
}: {
  items: readonly NavItem[];
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Điều hướng chính" className="flex gap-1 overflow-x-auto py-2">
      {items.map((item) => {
        const active = pathname === item.href;
        const count = counts[item.href] ?? 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-accent/15 text-on-surface'
                : 'text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
            )}
          >
            {item.label}
            {count > 0 ? <span className="ml-1.5 text-accent-strong">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
