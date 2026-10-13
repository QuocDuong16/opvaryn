'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_ITEMS } from '@/app/nav';
import { cn } from '@/lib/utils';

/** Vertical navigation used in the desktop sidebar. */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
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
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal navigation strip used below the topbar on small screens. */
export function CompactNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Điều hướng chính" className="flex gap-1 overflow-x-auto py-2">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
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
          </Link>
        );
      })}
    </nav>
  );
}
