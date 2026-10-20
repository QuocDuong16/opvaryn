'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  revokeAdminUserSessionsAction,
  setAdminUserPasswordAction,
  unlockAdminUserAction,
} from '@/app/(workspace)/admin/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_ADMIN_STATE } from '@/components/admin/admin-state';
import { INPUT_CLASS, LABEL_CLASS, SUBMIT_CLASS } from '@/components/admin/form-styles';

/** Resets a password and ends every session of that person. */
export function PasswordResetForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(setAdminUserPasswordAction, INITIAL_ADMIN_STATE);

  return (
    <Card>
      <CardTitle>Đặt lại mật khẩu</CardTitle>
      <CardDescription>
        Dùng khi người dùng quên mật khẩu hoặc tài khoản cần được bàn giao. Mọi phiên đăng nhập hiện
        tại sẽ kết thúc; hãy báo mật khẩu mới cho người đó qua kênh an toàn.
      </CardDescription>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="userId" value={userId} />
        <div>
          <label htmlFor="admin-reset-password" className={LABEL_CLASS}>
            Mật khẩu mới
          </label>
          <input
            id="admin-reset-password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </div>
        <Submit label="Đặt mật khẩu mới" />
        <StateMessage state={state} />
      </form>
    </Card>
  );
}

/** Signs one person out of every device without changing the password. */
export function RevokeSessionsForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(revokeAdminUserSessionsAction, INITIAL_ADMIN_STATE);

  return (
    <Card>
      <CardTitle>Đăng xuất mọi phiên</CardTitle>
      <CardDescription>
        Kết thúc mọi phiên đang mở của người này mà không đổi mật khẩu. Dùng khi thiết bị bị mất
        hoặc tài khoản vừa được bàn giao.
      </CardDescription>
      <form
        action={formAction}
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          if (!window.confirm('Đăng xuất mọi phiên đang mở của người này?')) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <Submit label="Đăng xuất mọi phiên" secondary />
        <StateMessage state={state} />
      </form>
    </Card>
  );
}

/**
 * Ends the short wait an address gets after too many wrong passwords. The screen only
 * offers it while the account is waiting (ADR 0028, ADR 0021).
 */
export function UnlockSignInForm({
  userId,
  lockedUntilClock,
}: {
  userId: string;
  lockedUntilClock: string;
}) {
  const [state, formAction] = useActionState(unlockAdminUserAction, INITIAL_ADMIN_STATE);

  return (
    <Card>
      <CardTitle>Đăng nhập đang bị tạm khoá</CardTitle>
      <CardDescription>
        Người này gõ sai mật khẩu quá nhiều lần nên hệ thống tạm khoá đăng nhập, và đang mở lại lúc{' '}
        {lockedUntilClock}. Mở khoá để họ thử lại ngay; mật khẩu không thay đổi và các phiên đang mở
        giữ nguyên.
      </CardDescription>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="unlockUserId" value={userId} />
        <Submit label="Mở khoá đăng nhập" secondary />
        <StateMessage state={state} />
      </form>
    </Card>
  );
}

function Submit({ label, secondary = false }: { label: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        secondary
          ? 'rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-overlay disabled:opacity-60'
          : SUBMIT_CLASS
      }
    >
      {pending ? 'Đang xử lý…' : label}
    </button>
  );
}

function StateMessage({
  state,
}: {
  state: { status: 'idle' | 'success' | 'error'; message?: string };
}) {
  if (!state.message) {
    return null;
  }
  const error = state.status === 'error';
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={
        error
          ? 'rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger'
          : 'rounded-lg border border-success/40 px-3 py-2 text-sm text-success'
      }
    >
      {state.message}
    </p>
  );
}
