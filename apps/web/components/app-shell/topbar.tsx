import { Breadcrumb } from '@/components/app-shell/breadcrumb';
import { CompactNav } from '@/components/app-shell/nav';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Breadcrumb />
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] tracking-wide text-on-surface-muted sm:inline-block">
            DEMO BUILD
          </span>
          <ThemeToggle />
        </div>
      </div>
      <div className="px-3 lg:hidden">
        <CompactNav />
      </div>
    </header>
  );
}
