import type { ReactNode } from 'react';

import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';

/**
 * The workspace frame: every screen behind the sign-in shares it. The public landing
 * page and the sign-in screen live outside this route group on purpose — they are what
 * a visitor sees before they have an account (ADR 0014), and the proxy keeps this group
 * out of reach without a session.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <Sidebar />
      <div className="flex min-w-0 flex-col">
        <Topbar />
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
