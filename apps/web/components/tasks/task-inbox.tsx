'use client';

import { useMemo, useReducer, useState } from 'react';

import {
  cloneTasks,
  countByStatus,
  DEMO_TASKS,
  TASK_STATUS_LABELS,
  type DemoTask,
  type TaskStatus,
} from '@/components/tasks/demo-tasks';
import { inboxReducer } from '@/components/tasks/inbox-reducer';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: 'border-warning/40 text-warning',
  approved: 'border-success/40 text-success',
  rejected: 'border-danger/40 text-danger',
  returned: 'border-border-strong text-on-surface-muted',
};

const ACTION_BUTTON =
  'rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-overlay';

/** nowLabel formats the current time the way the demo timeline shows events. */
function nowLabel(): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
}

type DraftMode = 'return' | 'reject';

interface Draft {
  mode: DraftMode;
  text: string;
}

/**
 * TaskInbox is the demo Inbox: approve, return and reject move tasks through a
 * local reducer with a visible timeline. No server call happens — the real inbox
 * needs the workflow runtime, so the page labels this screen as a simulation.
 */
export function TaskInbox() {
  const [tasks, dispatch] = useReducer(inboxReducer, DEMO_TASKS, cloneTasks);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const counts = useMemo(() => countByStatus(tasks), [tasks]);

  function openDraft(taskId: string, mode: DraftMode) {
    setDrafts((current) => ({ ...current, [taskId]: { mode, text: '' } }));
  }

  function closeDraft(taskId: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  function updateDraft(taskId: string, text: string) {
    setDrafts((current) =>
      current[taskId] ? { ...current, [taskId]: { ...current[taskId], text } } : current,
    );
  }

  function submitDraft(task: DemoTask) {
    const draft = drafts[task.id];
    if (!draft || draft.text.trim() === '') {
      return;
    }
    if (draft.mode === 'return') {
      dispatch({ type: 'return', taskId: task.id, at: nowLabel(), note: draft.text.trim() });
    } else {
      dispatch({ type: 'reject', taskId: task.id, at: nowLabel(), reason: draft.text.trim() });
    }
    closeDraft(task.id);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-on-surface-muted">Đang chờ bạn</dt>
            <dd className="font-semibold text-warning">{counts.pending}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-on-surface-muted">Đã duyệt</dt>
            <dd className="font-semibold text-success">{counts.approved}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-on-surface-muted">Đã trả về</dt>
            <dd className="font-semibold">{counts.returned}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-on-surface-muted">Đã từ chối</dt>
            <dd className="font-semibold text-danger">{counts.rejected}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => dispatch({ type: 'reset', tasks: DEMO_TASKS })}
          className={ACTION_BUTTON}
        >
          Đặt lại phiên demo
        </button>
      </div>

      <ul className="space-y-4">
        {tasks.map((task) => {
          const draft = drafts[task.id];
          const overdue = task.status === 'pending' && task.waitingHours > task.slaHours;

          return (
            <li key={task.id} className="rounded-xl border border-border bg-surface-raised p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-on-surface-muted">{task.id}</span>
                    {task.priority === 'high' ? (
                      <span className="rounded-full border border-danger/40 px-2 py-0.5 text-[11px] text-danger">
                        Ưu tiên cao
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px]',
                        STATUS_STYLES[task.status],
                      )}
                    >
                      {TASK_STATUS_LABELS[task.status]}
                    </span>
                  </p>
                  <h2 className="mt-1.5 text-base font-semibold tracking-tight">{task.title}</h2>
                  <p className="mt-1 text-xs text-on-surface-muted">
                    {task.processName} · <code className="font-mono">{task.businessObject}</code> ·{' '}
                    {task.amountLabel}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className={overdue ? 'font-medium text-danger' : 'text-on-surface-muted'}>
                    {overdue
                      ? `Quá SLA ${task.waitingHours - task.slaHours} giờ`
                      : `Chờ ${task.waitingHours} giờ · SLA ${task.slaHours} giờ`}
                  </p>
                  <p className="mt-1 text-on-surface-muted">{task.submittedBy} gửi</p>
                </div>
              </div>

              <p className="mt-3 text-xs text-on-surface-muted">
                <span className="font-medium text-on-surface">Người giữ việc:</span> {task.holder}
              </p>

              {task.status === 'pending' ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'approve', taskId: task.id, at: nowLabel() })}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
                  >
                    Duyệt
                  </button>
                  <button
                    type="button"
                    onClick={() => openDraft(task.id, 'return')}
                    aria-expanded={draft?.mode === 'return'}
                    className={ACTION_BUTTON}
                  >
                    Trả về chỉnh sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => openDraft(task.id, 'reject')}
                    aria-expanded={draft?.mode === 'reject'}
                    className={cn(ACTION_BUTTON, 'border-danger/40 text-danger')}
                  >
                    Từ chối
                  </button>
                </div>
              ) : null}

              {draft ? (
                <div className="mt-3 rounded-lg border border-border bg-surface/50 p-3">
                  <label
                    htmlFor={`${task.id}-draft`}
                    className="text-xs font-medium tracking-wide uppercase"
                  >
                    {draft.mode === 'return'
                      ? 'Lý do trả về (bắt buộc, người đề nghị sẽ đọc)'
                      : 'Lý do từ chối (bắt buộc, được ghi vào audit)'}
                  </label>
                  <textarea
                    id={`${task.id}-draft`}
                    value={draft.text}
                    onChange={(event) => updateDraft(task.id, event.target.value)}
                    rows={2}
                    placeholder={
                      draft.mode === 'return'
                        ? 'Ví dụ: bổ sung báo giá của hai nhà cung cấp.'
                        : 'Ví dụ: không nằm trong ngân sách quý này.'
                    }
                    className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={draft.text.trim() === ''}
                      onClick={() => submitDraft(task)}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                    >
                      {draft.mode === 'return' ? 'Xác nhận trả về' : 'Xác nhận từ chối'}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeDraft(task.id)}
                      className={ACTION_BUTTON}
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              ) : null}

              <details className="mt-4" open={task.status === 'pending'}>
                <summary className="cursor-pointer text-xs font-medium text-on-surface-muted hover:text-on-surface">
                  Timeline ({task.timeline.length} sự kiện)
                </summary>
                <ol className="mt-3 space-y-2">
                  {task.timeline.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="flex gap-3 text-xs">
                      <span className="w-24 shrink-0 pt-0.5 font-mono text-on-surface-muted">
                        {event.at}
                      </span>
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-strong"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{event.actor}</span>{' '}
                        <span className="text-on-surface-muted">— {event.action}</span>
                        {event.note ? (
                          <span className="mt-0.5 block text-on-surface-muted italic">
                            “{event.note}”
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
