import Link from 'next/link';
import type { ProcessInstanceSummary } from '@opvaryn/contracts';

import { INSTANCE_STATE_LABELS } from '@/components/process/process-timeline';
import { formatTimestamp } from '@/lib/format';
import { labelOrKey } from '@/lib/names';
import { cn } from '@/lib/utils';

const STATE_STYLES: Record<string, string> = {
  running: 'border-warning/40 text-warning',
  completed: 'border-success/40 text-success',
  rejected: 'border-danger/40 text-danger',
};

/**
 * InstanceList renders instances as rows: which record each one runs on, its state, the step it
 * waits at, and who holds it up. It answers "what is running on these records?" — the list the
 * inbox alone could not give, because an instance whose task was already decided never appears
 * in anyone's inbox.
 *
 * A step is named by the task waiting on it, never by its node key: the key is what the graph
 * compares, and a person reads the step's title (ADR 0016). `recordLabels` maps a record id to
 * the label that identifies it (built from each record's own definition version); a record the
 * caller may not read has no label, and the row says so instead of pretending.
 */
export function InstanceList({
  instances,
  emptyHint,
  recordLabels = {},
  roleLabels = {},
  definitionNames = {},
}: {
  instances: readonly ProcessInstanceSummary[];
  emptyHint: string;
  recordLabels?: Record<string, string>;
  /** Role key to display name; a role nobody has named keeps its key. */
  roleLabels?: Record<string, string>;
  /** Definition key to its name. */
  definitionNames?: Record<string, string>;
}) {
  if (instances.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center">
        <p className="text-sm font-medium">Chưa có quy trình nào đang chạy</p>
        <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-muted">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Bản ghi
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Quy trình
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Trạng thái
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Bước đang chờ
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Bắt đầu
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface-raised/40">
          {instances.map((summary) => {
            const { instance, openTasks } = summary;
            return (
              <tr key={instance.id}>
                <td className="px-4 py-3 align-top">
                  <Link
                    href={`/tasks/${instance.id}`}
                    className="font-medium text-accent-strong hover:underline"
                  >
                    {summary.recordName ??
                      recordLabels[instance.recordId] ??
                      'Bản ghi chưa có tên hiển thị'}
                  </Link>
                </td>
                <td className="px-4 py-3 align-top text-xs">
                  {labelOrKey(definitionNames[instance.definitionKey], instance.definitionKey)}
                  <span className="mt-1 block text-[11px] text-on-surface-muted">
                    {`phiên bản ${instance.definitionVersion}${instance.attempt > 1 ? ` · lần ${instance.attempt}` : ''}`}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px]',
                      STATE_STYLES[instance.state] ?? 'border-border text-on-surface-muted',
                    )}
                  >
                    {INSTANCE_STATE_LABELS[instance.state] ?? instance.state}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  {openTasks.length === 0 ? (
                    <span className="text-xs text-on-surface-muted">— đã kết thúc</span>
                  ) : (
                    <ul className="space-y-1">
                      {openTasks.map((task) => (
                        <li key={task.id} className="text-xs">
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-on-surface-muted">
                            {labelOrKey(roleLabels[task.assigneeRole], task.assigneeRole)}
                          </span>
                          <span className="ml-2">{task.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-xs whitespace-nowrap text-on-surface-muted">
                  {formatTimestamp(instance.startedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
