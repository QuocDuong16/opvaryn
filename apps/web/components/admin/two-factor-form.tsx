'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  disableMyTwoFactorAction,
  enableMyTwoFactorAction,
  resetAdminUserTwoFactorAction,
  setupMyTwoFactorAction,
} from '@/app/(workspace)/admin/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_ADMIN_STATE } from '@/components/admin/admin-state';
import { INPUT_CLASS, LABEL_CLASS, SUBMIT_CLASS } from '@/components/admin/form-styles';

/**
 * Two-step verification for an administrator account (ADR 0030). The person enrols an
 * authenticator app: the secret is shown once, the app's code switches the second step
 * on, and the single-use recovery codes are handed out once, at that moment.
 */
export function TwoFactorForm({ enabled }: { enabled: boolean }) {
  const [state, formAction] = useActionState(enableMyTwoFactorAction, INITIAL_ADMIN_STATE);
  const [disableState, disableFormAction] = useActionState(
    disableMyTwoFactorAction,
    INITIAL_ADMIN_STATE,
  );
  const [setupState, setSetupState] = useState<{ secret?: string; uri?: string }>({});

  return (
    <Card>
      <CardTitle>Xác thực hai bước</CardTitle>
      <CardDescription>
        {enabled
          ? 'Tài khoản này cần mã từ ứng dụng xác thực ở lần đăng nhập kế tiếp, ngoài mật khẩu.'
          : 'Tài khoản này chỉ cần mật khẩu. Bật bước thứ hai để một mật khẩu bị lộ không đủ để vào hệ thống.'}
      </CardDescription>

      {enabled ? (
        <form action={disableFormAction} className="mt-4 space-y-3">
          <div>
            <label htmlFor="two-factor-code" className={LABEL_CLASS}>
              Mã xác thực
            </label>
            <input
              id="two-factor-code"
              name="code"
              type="text"
              required
              autoComplete="one-time-code"
              placeholder="Mã ứng dụng, hoặc một mã cứu hộ"
              className={INPUT_CLASS}
            />
          </div>
          <Submit label="Tắt xác thực hai bước" secondary />
          <StateMessage state={disableState} />
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => {
              void setupMyTwoFactorAction().then((result) => {
                setSetupState({ secret: result.twoFactorSecret, uri: result.twoFactorUri });
              });
            }}
            className={SUBMIT_CLASS}
          >
            Bật xác thực hai bước
          </button>
          {setupState.secret ? (
            <div className="space-y-3 rounded-lg border border-border bg-surface-raised/40 p-3">
              <p className="text-sm">
                Nhập khoá này vào ứng dụng xác thực (Google Authenticator, 1Password, Authy…), rồi
                nhập mã ứng dụng bên dưới.
              </p>
              <p className="font-mono text-xs break-all">{setupState.secret}</p>
              <form action={formAction} className="space-y-3">
                <div>
                  <label htmlFor="two-factor-enable-code" className={LABEL_CLASS}>
                    Mã ứng dụng
                  </label>
                  <input
                    id="two-factor-enable-code"
                    name="code"
                    type="text"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className={INPUT_CLASS}
                  />
                </div>
                <Submit label="Bật và lấy mã cứu hộ" />
                <StateMessage state={state} />
              </form>
            </div>
          ) : null}
          {state.recoveryCodes ? (
            <div className="rounded-lg border border-success/40 p-3">
              <p className="text-sm font-medium">Mã cứu hộ — mỗi mã dùng được một lần:</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                {state.recoveryCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-on-surface-muted">
                Lưu chúng cùng chỗ với mật khẩu. Chúng không hiện lại.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/**
 * ResetTwoFactorForm is the administrator's way back in when a person lost the device:
 * the second step is removed, the password stays.
 */
export function ResetTwoFactorForm({ userId, label }: { userId: string; label: string }) {
  const [state, formAction] = useActionState(resetAdminUserTwoFactorAction, INITIAL_ADMIN_STATE);

  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(event) => {
        if (!window.confirm(`Gỡ xác thực hai bước của ${label}?`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Submit label="Gỡ xác thực hai bước" secondary />
      <StateMessage state={state} />
    </form>
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
