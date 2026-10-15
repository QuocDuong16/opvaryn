'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { loginAction } from '@/app/login/actions';
import { INITIAL_LOGIN_STATE } from '@/components/auth/login-state';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/** LoginForm signs in against the API through a server action. */
export function LoginForm({ next = '' }: { next?: string }) {
  const [state, formAction] = useActionState(loginAction, INITIAL_LOGIN_STATE);

  return (
    <Card>
      <CardTitle>Đăng nhập</CardTitle>
      <CardDescription>
        Dùng tài khoản do quản trị tạo bằng <code className="font-mono text-xs">make useradm</code>.
        Session lưu trong cookie httpOnly của web app và chỉ server mới đọc được.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div>
          <label htmlFor="login-email" className="text-xs font-medium tracking-wide uppercase">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="lan@opvaryn.local"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="login-password" className="text-xs font-medium tracking-wide uppercase">
            Mật khẩu
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={INPUT_CLASS}
          />
        </div>

        <SubmitButton />

        {state.status === 'error' && state.message ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
    </button>
  );
}
