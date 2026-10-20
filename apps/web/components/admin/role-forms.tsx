'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AdminRole } from '@opvaryn/contracts';

import { createAdminRoleAction, updateAdminRoleAction } from '@/app/(workspace)/admin/actions';
import { INITIAL_ADMIN_STATE } from '@/components/admin/admin-state';
import { INPUT_CLASS, LABEL_CLASS, SUBMIT_CLASS } from '@/components/admin/form-styles';
import { keyFromLabel } from '@/lib/names';

/** Adds one role to the catalogue before anyone holds it. */
export function CreateRoleForm() {
  const [state, formAction] = useActionState(createAdminRoleAction, INITIAL_ADMIN_STATE);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const effectiveKey = key === '' ? keyFromLabel(label) : key;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="role-label" className={LABEL_CLASS}>
            Tên vai trò
          </label>
          <input
            id="role-label"
            name="label"
            required
            maxLength={120}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Trưởng bộ phận"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="role-key" className={LABEL_CLASS}>
            Mã (tự sinh, sửa được)
          </label>
          <input
            id="role-key"
            name="key"
            required
            pattern="[a-z][a-z0-9_]{1,63}"
            value={effectiveKey}
            onChange={(event) => setKey(event.target.value)}
            placeholder="truong_bo_phan"
            autoComplete="off"
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="mt-1 text-xs text-on-surface-muted">
            Quy trình gán việc theo mã này; không đổi được sau khi tạo.
          </p>
        </div>
      </div>
      <Submit label="Tạo vai trò" />
      <StateMessage state={state} />
    </form>
  );
}

/** Renames a role in the catalogue; the key stays fixed. */
export function RenameRoleForm({ role }: { role: AdminRole }) {
  const [state, formAction] = useActionState(updateAdminRoleAction, INITIAL_ADMIN_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="key" value={role.key} />
      <label className="sr-only" htmlFor={`role-label-${role.key}`}>
        {`Tên mới cho ${role.label || role.key}`}
      </label>
      <input
        id={`role-label-${role.key}`}
        name="label"
        required
        maxLength={120}
        defaultValue={role.label}
        className="w-48 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent-strong focus:outline-none"
      />
      <Submit label="Đổi tên" secondary />
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
          ? 'rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-overlay disabled:opacity-60'
          : SUBMIT_CLASS
      }
    >
      {pending ? 'Đang lưu…' : label}
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
          ? 'w-full rounded-lg border border-danger/40 px-3 py-2 text-xs text-danger'
          : 'w-full rounded-lg border border-success/40 px-3 py-2 text-xs text-success'
      }
    >
      {state.message}
    </p>
  );
}
