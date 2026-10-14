import Link from 'next/link';

import { LoginForm } from '@/components/auth/login-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { logoutAction } from '@/app/login/actions';

export const metadata = { title: 'Đăng nhập' };

export default async function LoginPage() {
  const api = createServerApiClient();

  let signedIn: { name: string; email: string; department: string; roles: string[] } | null = null;
  let error: string | null = null;
  try {
    const me = await api.getMe();
    signedIn = me;
  } catch (cause) {
    // A missing session is the normal case here; anything else is worth showing.
    const message = describeApiError(cause);
    if (!message.includes('Cần đăng nhập')) {
      error = message;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="00 / Identity"
        title="Đăng nhập"
        lead="API xác thực bằng session cookie: mọi hành động trên quy trình và mọi lần đọc bản ghi đều gắn với một người thật (ADR 0008)."
        aside={<StatusBadge kind="live" />}
      />

      {signedIn ? (
        <div className="max-w-xl rounded-xl border border-border bg-surface-raised p-5">
          <p className="text-sm">
            Đang đăng nhập là <span className="font-medium">{signedIn.name}</span> ({signedIn.email}
            ) — bộ phận <code className="font-mono text-xs">{signedIn.department}</code>, role{' '}
            <code className="font-mono text-xs">{signedIn.roles.join(', ')}</code>.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
            >
              Về trang Tổng quan
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-overlay"
              >
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="max-w-xl">
          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning"
            >
              {error}
            </p>
          ) : null}
          <LoginForm />
        </div>
      )}
    </>
  );
}
