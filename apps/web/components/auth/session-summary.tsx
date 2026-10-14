import Link from 'next/link';

import { createServerApiClient } from '@/lib/api/server';

/**
 * SessionSummary shows who is signed in, or points at the sign-in screen. It fails
 * soft: the shell must keep rendering when the API is down or no session exists.
 */
export async function SessionSummary() {
  let label: string | null = null;
  let department: string | null = null;

  try {
    const me = await createServerApiClient().getMe();
    label = me.name;
    department = me.department;
  } catch {
    label = null;
  }

  if (!label) {
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
    <Link
      href="/login"
      title={`Bộ phận ${department ?? '—'}`}
      className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-surface-overlay"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      <span className="font-medium">{label}</span>
    </Link>
  );
}
