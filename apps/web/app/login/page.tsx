import Link from 'next/link';

import { LoginForm } from '@/components/auth/login-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { logoutAction } from '@/app/login/actions';

export const metadata = { title: 'Đăng nhập' };

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * The sign-in screen stands outside the workspace frame: a visitor who has no account
 * yet should not see the application chrome (ADR 0014). `?next=` carries the page they
 * asked for, so signing in returns them to it.
 */
export default async function LoginPage({ searchParams }: PageProps) {
  const { next } = await searchParams;
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
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 font-mono text-sm text-accent-strong"
            >
              ◎
            </span>
            <span className="text-sm font-semibold tracking-tight">OPVARYN</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Đăng nhập</h1>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-muted">
          Vào workspace của tổ chức bạn. Mọi thao tác đều ghi nhận người thực hiện.
        </p>

        <div className="mt-8">
          {signedIn ? (
            <Card>
              <CardTitle>Đang đăng nhập</CardTitle>
              <CardDescription>
                <span className="font-medium">{signedIn.name}</span> ({signedIn.email}) — bộ phận{' '}
                <code className="font-mono text-xs">{signedIn.department}</code>, role{' '}
                <code className="font-mono text-xs">{signedIn.roles.join(', ')}</code>.
              </CardDescription>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  href="/overview"
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
                >
                  Vào workspace
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
            </Card>
          ) : (
            <>
              {error ? (
                <p
                  role="alert"
                  className="mb-4 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning"
                >
                  {error}
                </p>
              ) : null}
              <LoginForm next={next ?? ''} />
            </>
          )}
        </div>

        <p className="mt-8 text-xs text-on-surface-muted">
          <Link href="/" className="hover:text-on-surface">
            ← Về trang giới thiệu
          </Link>
        </p>
      </main>
    </div>
  );
}
