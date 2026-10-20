'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/admin', label: 'Tổng quan' },
  { href: '/admin/users', label: 'Người dùng' },
  { href: '/admin/departments', label: 'Phòng ban' },
  { href: '/admin/roles', label: 'Vai trò' },
  { href: '/admin/working-hours', label: 'Giờ làm việc' },
  { href: '/admin/policies', label: 'Chính sách việc' },
] as const;

/** The administration areas, with the current one marked. */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Các phần quản trị"
      className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-3"
    >
      {ITEMS.map((item) => {
        const current =
          item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
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
          </Link>
        );
      })}
    </nav>
  );
}
