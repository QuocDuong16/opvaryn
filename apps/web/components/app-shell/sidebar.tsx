import type { NavItem } from '@/app/nav';
import { SidebarNav } from '@/components/app-shell/nav';

export function Sidebar({ items }: { items: readonly NavItem[] }) {
  return (
    <aside className="hidden border-r border-border bg-surface-raised lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 font-mono text-sm text-accent-strong"
        >
          ◎
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">OPVARYN</p>
          <p className="truncate text-[11px] text-on-surface-muted">Business Operations Platform</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav items={items} />
      </div>
    </aside>
  );
}
