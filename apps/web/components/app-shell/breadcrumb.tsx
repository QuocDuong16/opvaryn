'use client';

import { usePathname } from 'next/navigation';

import { navItemFor } from '@/app/nav';

/** Breadcrumb shows the product and the current demo area. */
export function Breadcrumb() {
  const pathname = usePathname();
  const item = navItemFor(pathname);

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="text-on-surface-muted">OPVARYN</span>
      <span aria-hidden className="text-border-strong">
        /
      </span>
      <span className="truncate font-medium">{item?.label ?? 'Không xác định'}</span>
    </div>
  );
}
