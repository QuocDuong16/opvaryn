import { SessionSummary } from '@/components/auth/session-summary';
import { Breadcrumb } from '@/components/app-shell/breadcrumb';
import { CompactNav } from '@/components/app-shell/nav';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { createServerApiClient } from '@/lib/api/server';
import { stageLabel } from '@/lib/stage';

/** The stage chip names the build the workspace is running, straight from the API. */
async function loadStage(): Promise<string | null> {
  try {
    const meta = await createServerApiClient().getMeta();
    return stageLabel(meta.stage);
  } catch {
    return null;
  }
}

export async function Topbar() {
  const stage = await loadStage();

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
          <SessionSummary />
          <ThemeToggle />
        </div>
      </div>
      <div className="px-3 lg:hidden">
        <CompactNav />
      </div>
    </header>
  );
}
