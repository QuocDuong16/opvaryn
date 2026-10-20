'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { INITIAL_ADMIN_STATE, type AdminActionState } from '@/components/admin/admin-state';

type Action = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

/**
 * A destructive action with one confirmation. When it cannot work (a department with people,
 * a system role) the button is rendered disabled with the reason, instead of inviting a
 * request the API will refuse (ADR 0021).
 */
export function DeleteForm({
  action,
  hiddenValue,
  label,
  confirmMessage,
  disabled = false,
  disabledNote,
}: {
  action: Action;
  hiddenValue: string;
  label: string;
  confirmMessage: string;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ADMIN_STATE);

  if (disabled) {
    return (
      <div>
        <button
          type="button"
          disabled
          title={disabledNote}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium opacity-50"
        >
          {label}
        </button>
        {disabledNote ? (
          <p className="mt-1 max-w-48 text-[11px] leading-relaxed text-on-surface-muted">
            {disabledNote}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="key" value={hiddenValue} />
      <DeleteButton label={label} />
      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-1 max-w-56 text-[11px] leading-relaxed text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function DeleteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
    >
      {pending ? 'Đang xoá…' : label}
    </button>
  );
}
