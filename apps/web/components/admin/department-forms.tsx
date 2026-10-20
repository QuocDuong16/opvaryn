'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AdminDepartment } from '@opvaryn/contracts';

import {
  createAdminDepartmentAction,
  updateAdminDepartmentAction,
} from '@/app/(workspace)/admin/actions';
import { INITIAL_ADMIN_STATE } from '@/components/admin/admin-state';
import { INPUT_CLASS, LABEL_CLASS, SUBMIT_CLASS } from '@/components/admin/form-styles';
import { keyFromLabel } from '@/lib/names';

/** Adds one department; the internal key follows the name until somebody edits it. */
export function CreateDepartmentForm() {
  const [state, formAction] = useActionState(createAdminDepartmentAction, INITIAL_ADMIN_STATE);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const effectiveKey = key === '' ? keyFromLabel(name) : key;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="department-name" className={LABEL_CLASS}>
            Tên phòng ban
          </label>
          <input
            id="department-name"
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kỹ thuật"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="department-key" className={LABEL_CLASS}>
            Mã (tự sinh, sửa được)
          </label>
          <input
            id="department-key"
            name="key"
            required
            pattern="[a-z][a-z0-9_]{1,63}"
            value={effectiveKey}
            onChange={(event) => setKey(event.target.value)}
            placeholder="ky_thuat"
            autoComplete="off"
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="mt-1 text-xs text-on-surface-muted">
            Mã dùng để gán phạm vi dữ liệu; không đổi được sau khi tạo.
          </p>
        </div>
      </div>
      <Submit label="Tạo phòng ban" />
      <StateMessage state={state} />
    </form>
  );
}

/** Renames a department; the key stays fixed because records store it as their scope. */
export function RenameDepartmentForm({ department }: { department: AdminDepartment }) {
  const [state, formAction] = useActionState(updateAdminDepartmentAction, INITIAL_ADMIN_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="key" value={department.key} />
      <label className="sr-only" htmlFor={`department-name-${department.key}`}>
        {`Tên mới cho ${department.name}`}
      </label>
      <input
        id={`department-name-${department.key}`}
        name="name"
        required
        maxLength={120}
        defaultValue={department.name}
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
