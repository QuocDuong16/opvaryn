import type { NavItem } from '@/app/nav';
import { AdvancedToggle } from '@/components/app-shell/advanced-toggle';
import { SessionSummary } from '@/components/auth/session-summary';
import { Breadcrumb } from '@/components/app-shell/breadcrumb';
import { CompactNav } from '@/components/app-shell/nav';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { createServerApiClient } from '@/lib/api/server';
import { stageLabel } from '@/lib/stage';

/** The stage chip names the build the workspace is running; only advanced mode asks for it. */
async function loadStage(): Promise<string | null> {
  try {
    const meta = await createServerApiClient().getMeta();
    return stageLabel(meta.stage);
  } catch {
    return null;
  }
}

export async function Topbar({
  items,
  counts = {},
  isAdminUser,
  showStage,
}: {
  items: readonly NavItem[];
  /** Small badges by href, e.g. how much work is waiting in the inbox. */
  counts?: Record<string, number>;
  isAdminUser: boolean;
  showStage: boolean;
}) {
  const stage = showStage ? await loadStage() : null;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Breadcrumb />
        <div className="flex items-center gap-3">
          {stage ? (
            <span className="hidden rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] tracking-wide text-on-surface-muted sm:inline-block">
              {stage}
            </span>
          ) : null}
          {isAdminUser ? <AdvancedToggle /> : null}
          <SessionSummary />
          <ThemeToggle />
        </div>
      </div>
      <div className="px-3 lg:hidden">
        <CompactNav items={items} counts={counts} />
      </div>
    </header>
  );
}
