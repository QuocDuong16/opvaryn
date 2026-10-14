import Link from 'next/link';
import type { ProcessInstanceSummary } from '@opvaryn/contracts';

import { INSTANCE_STATE_LABELS } from '@/components/process/process-timeline';
import { formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATE_STYLES: Record<string, string> = {
  running: 'border-warning/40 text-warning',
  completed: 'border-success/40 text-success',
  rejected: 'border-danger/40 text-danger',
};

/**
 * InstanceList renders instances as rows: state, the definition version each one is
 * bound to, the node it waits at, and who holds it up. It is the answer to "what is
 * running on these records?" — the list the inbox alone could not give, because an
 * instance whose task was already decided never appears in anyone's inbox.
 */
export function InstanceList({
  instances,
  emptyHint,
}: {
  instances: readonly ProcessInstanceSummary[];
  emptyHint: string;
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
              Quy trình
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Trạng thái
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Node hiện tại
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Đang chờ ai
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Bắt đầu
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface-raised/40">
          {instances.map(({ instance, openTasks }) => (
            <tr key={instance.id}>
              <td className="px-4 py-3 align-top">
                <Link
                  href={`/tasks/${instance.id}`}
                  className="font-medium text-accent-strong hover:underline"
                >
                  {instance.definitionKey}
                </Link>
                <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-on-surface-muted">
                  {`v${instance.definitionVersion} · attempt ${instance.attempt}`}
                </span>
                <span className="mt-1 block font-mono text-[11px] text-on-surface-muted">
                  {`instance ${instance.id.slice(0, 8)}…`}
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
              <td className="px-4 py-3 align-top font-mono text-xs">{instance.currentNode}</td>
              <td className="px-4 py-3 align-top">
                {openTasks.length === 0 ? (
                  <span className="text-xs text-on-surface-muted">— đã kết thúc</span>
                ) : (
                  <ul className="space-y-1">
                    {openTasks.map((task) => (
                      <li key={task.id} className="text-xs">
                        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-on-surface-muted">
                          {task.assigneeRole}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
