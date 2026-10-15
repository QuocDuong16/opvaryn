import Link from 'next/link';

import { logoutAction } from '@/app/login/actions';
import { createServerApiClient } from '@/lib/api/server';
import { labelOrKey } from '@/lib/names';

/**
 * SessionSummary is the account menu in the topbar: who is signed in, and the way out. The
 * disclosure is a native <details>, so signing out works with no client JavaScript at all.
 * It fails soft: the shell must keep rendering when the API is down or no session exists.
 */
export async function SessionSummary() {
  let me: {
    name: string;
    email: string;
    departmentName: string;
    roles: string[];
    roleLabels: Record<string, string>;
  } | null = null;

  try {
    me = await createServerApiClient().getMe();
  } catch {
    me = null;
  }

  if (!me) {
    return (
      <Link
        href="/login"
        className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-on-surface-muted transition-colors hover:bg-surface-overlay hover:text-on-surface"
      >
        Đăng nhập
      </Link>
    );
  }

  return (
    <details className="relative">
      <summary
        title="Tài khoản"
        className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-surface-overlay [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        <span className="font-medium">{me.name}</span>
      </summary>

      <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface p-4 shadow-lg">
        <p className="text-sm font-medium">{me.name}</p>
        <p className="mt-0.5 truncate text-xs text-on-surface-muted">{me.email}</p>

        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-muted">Bộ phận</dt>
            <dd>{me.departmentName || '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-muted">Vai trò</dt>
            <dd className="text-right">
              {me.roles.map((role) => labelOrKey(me.roleLabels[role], role)).join(', ') || '—'}
            </dd>
          </div>
        </dl>

        <form action={logoutAction} className="mt-4">
          <button
            type="submit"
            name="logout"
            value="1"
            className="w-full rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-overlay"
          >
            Đăng xuất
          </button>
        </form>
      </div>
    </details>
  );
}
