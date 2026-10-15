import type { ReactNode } from 'react';

import { navItemsFor } from '@/app/nav';
import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';
import { isAdmin } from '@/lib/access';
import { advancedVisible } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';
import { createServerApiClient } from '@/lib/api/server';

/** Who is signed in decides which screens appear; a broken API hides the administrator's. */
async function loadRoles(): Promise<string[]> {
  try {
    const me = await createServerApiClient().getMe();
    return me.roles;
  } catch {
    return [];
  }
}

/**
 * The workspace frame: every screen behind the sign-in shares it. The public landing page and
 * the sign-in screen live outside this route group on purpose (ADR 0014), and the proxy keeps
 * this group out of reach without a session.
 *
 * The navigation is built for the person using the product: everyone sees the product screens,
 * while the build and operations screens appear only for an administrator with advanced mode
 * on (ADR 0015).
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [roles, advanced] = await Promise.all([loadRoles(), getAdvancedMode()]);
  const isAdminUser = isAdmin(roles);
  const showAdvanced = advancedVisible(isAdminUser, advanced);
  const items = navItemsFor(showAdvanced);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-col">
        <Topbar items={items} isAdminUser={isAdminUser} showStage={showAdvanced} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="border-t border-border px-4 py-5 text-xs text-on-surface-muted sm:px-6 lg:px-8">
          OPVARYN · Bản MVP V1 · đang hoàn thiện theo phản hồi từ pilot.
        </footer>
      </div>
    </div>
  );
}
