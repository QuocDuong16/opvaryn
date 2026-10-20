'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { changePasswordAction } from '@/app/actions/password';
import { INITIAL_PASSWORD_STATE } from '@/components/auth/password-state';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs ' +
  'focus:border-accent-strong focus:outline-none';

/** The account menu's change-password form. */
export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, INITIAL_PASSWORD_STATE);

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <div>
        <label htmlFor="account-current-password" className="text-[11px] font-medium">
          Mật khẩu hiện tại
        </label>
        <input
          id="account-current-password"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label htmlFor="account-new-password" className="text-[11px] font-medium">
          Mật khẩu mới (ít nhất 10 ký tự)
        </label>
        <input
          id="account-new-password"
          name="newPassword"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={INPUT_CLASS}
        />
      </div>
      <SubmitButton />
      {state.message ? (
        <p
          role={state.status === 'error' ? 'alert' : 'status'}
          className={
            state.status === 'error'
              ? 'rounded-lg border border-danger/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger'
              : 'rounded-lg border border-success/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-success'
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang đổi…' : 'Đổi mật khẩu'}
    </button>
  );
}
