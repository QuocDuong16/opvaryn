'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveWorkPolicyAction } from '@/app/(workspace)/admin/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_WORK_POLICY_STATE } from '@/components/admin/work-policy-state';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

const PRIORITIES = [
  { value: 'low', label: 'Thấp' },
  { value: 'normal', label: 'Bình thường' },
  { value: 'high', label: 'Cao' },
  { value: 'urgent', label: 'Khẩn' },
];

/**
 * WorkPolicyForm is the clock of one kind of work (ADR 0035): the deadline, the priority
 * and the role that takes an overdue step over. Only an administrator may change it.
 */
export function WorkPolicyForm({
  objectKey,
  objectName,
  policy,
}: {
  objectKey: string;
  objectName: string;
  /** The policy as it is stored; the page reads it on the server. */
  policy: { defaultDueHours: number; defaultPriority: string; escalationRole: string };
}) {
  const [state, formAction] = useActionState(saveWorkPolicyAction, INITIAL_WORK_POLICY_STATE);

  return (
    <Card>
      <CardTitle>{objectName}</CardTitle>
      <CardDescription>
        Hạn mặc định tính theo giờ làm việc của tổ chức. Để 0 nghĩa là bước không có hạn, trừ khi
        bước tự khai.
      </CardDescription>

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="objectKey" value={objectKey} />

        <label className="block text-xs">
          <span className="font-medium tracking-wide uppercase">Hạn (giờ làm việc)</span>
          <input
            type="number"
            name="defaultDueHours"
            min={0}
            defaultValue={policy.defaultDueHours}
            className={INPUT_CLASS}
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium tracking-wide uppercase">Ưu tiên mặc định</span>
          <select
            name="defaultPriority"
            defaultValue={policy.defaultPriority}
            className={INPUT_CLASS}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority.value} value={priority.value}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-medium tracking-wide uppercase">Chuyển cấp cho</span>
          <input
            name="escalationRole"
            defaultValue={policy.escalationRole}
            placeholder="Vai trò nhận việc khi quá hạn"
            className={INPUT_CLASS}
          />
        </label>

        <div className="sm:col-span-3">
          <Submit />
          {state.message ? (
            <p
              role={state.status === 'error' ? 'alert' : 'status'}
              className={
                state.status === 'error'
                  ? 'mt-2 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger'
                  : 'mt-2 rounded-lg border border-success/40 px-3 py-2 text-sm text-success'
              }
            >
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : 'Lưu chính sách'}
    </button>
  );
}
