'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { decideProcessTaskAction } from '@/app/tasks/actions';
import { INITIAL_DECISION_STATE } from '@/components/tasks/decision-state';
import { cn } from '@/lib/utils';

const TEXTAREA_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

const SECONDARY_BUTTON =
  'rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors ' +
  'hover:bg-surface-overlay disabled:opacity-50';

/**
 * DecisionForm decides one open task. Each submit button carries the decision in
 * its own name/value pair, which both a JavaScript submit and a plain HTML POST
 * include, so a browser without JavaScript can still approve or reject (the
 * smoke test drives exactly that path). The Go service is what enforces the role,
 * the reason requirement and the compare-and-swap; this form only assembles the
 * request and shows the outcome.
 */
export function DecisionForm({
  instanceId,
  taskId,
  taskTitle,
}: {
  instanceId: string;
  taskId: string;
  taskTitle: string;
}) {
  const [state, formAction] = useActionState(decideProcessTaskAction, INITIAL_DECISION_STATE);

  return (
    <form
      key={state.decided ?? 'initial'}
      action={formAction}
      className="mt-4 rounded-lg border border-border bg-surface-raised/60 p-3"
      aria-label={`Quyết định cho việc: ${taskTitle}`}
    >
      <input type="hidden" name="instanceId" value={instanceId} />
      <input type="hidden" name="taskId" value={taskId} />

      <label htmlFor={`reason-${taskId}`} className="text-xs font-medium tracking-wide uppercase">
        Lý do (bắt buộc khi trả về hoặc từ chối)
      </label>
      <textarea
        id={`reason-${taskId}`}
        name="reason"
        rows={2}
        placeholder="Ví dụ: bổ sung báo giá của hai nhà cung cấp."
        className={TEXTAREA_CLASS}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DecisionButton
          decision="approve"
          label="Duyệt"
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        />
        <DecisionButton decision="return" label="Trả về chỉnh sửa" className={SECONDARY_BUTTON} />
        <DecisionButton
          decision="reject"
          label="Từ chối"
          className={cn(SECONDARY_BUTTON, 'border-danger/40 text-danger')}
        />
      </div>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function DecisionButton({
  decision,
  label,
  className,
}: {
  decision: 'approve' | 'return' | 'reject';
  label: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="decision" value={decision} disabled={pending} className={className}>
      {label}
    </button>
  );
}
