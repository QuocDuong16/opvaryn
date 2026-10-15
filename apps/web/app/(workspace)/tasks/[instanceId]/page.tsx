import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApiError,
  type BusinessObjectVersion,
  type Me,
  type ObjectRecord,
  type ProcessInstanceView,
} from '@opvaryn/contracts';

import { DecisionForm } from '@/components/tasks/decision-form';
import {
  INSTANCE_STATE_LABELS,
  TASK_STATUS_LABELS,
  describeEvent,
  nextTasks,
  openTasksForUser,
} from '@/components/process/process-timeline';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatFieldValue, formatTimestamp } from '@/lib/format';
import { fieldNames, labelOrKey } from '@/lib/names';
import { cn } from '@/lib/utils';

interface PageProps {
  params: Promise<{ instanceId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { instanceId } = await params;
  return { title: `Instance ${instanceId.slice(0, 8)}` };
}

const STATE_STYLES: Record<string, string> = {
  running: 'border-warning/40 text-warning',
  completed: 'border-success/40 text-success',
  rejected: 'border-danger/40 text-danger',
};

const TASK_STYLES: Record<string, string> = {
  open: 'border-warning/40 text-warning',
  approved: 'border-success/40 text-success',
  returned: 'border-border-strong text-on-surface-muted',
  rejected: 'border-danger/40 text-danger',
};

export default async function ProcessInstancePage({ params }: PageProps) {
  const { instanceId } = await params;
  const api = createServerApiClient();

  let me: Me;
  let view: ProcessInstanceView;
  let roleLabels: Record<string, string> = {};
  let definitionName = 'Quy trình';
  let objectName = 'Bản ghi';
  try {
    me = await api.getMe();
    view = await api.getProcessInstance(instanceId);
    // The screen names roles, so it needs the catalogue. A missing catalogue is not fatal:
    // the chips fall back to the key rather than showing nothing.
    const catalogue = await api.listRoles().catch(() => []);
    roleLabels = Object.fromEntries(catalogue.map((entry) => [entry.key, entry.label]));
    // Names, not keys: the process and the kind of record it runs on (ADR 0016).
    const [definition, object] = await Promise.all([
      api.getProcessDefinition(view.instance.definitionKey).catch(() => null),
      api.getBusinessObject(view.instance.objectKey).catch(() => null),
    ]);
    definitionName = definition?.name || view.instance.definitionKey;
    objectName = object?.name || view.instance.objectKey;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      // An instance the caller may not see is answered as absent, never as forbidden:
      // 404 does not confirm that it exists (ADR 0008 scoping).
      notFound();
    }
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      return (
        <>
          <PageHeader
            eyebrow="05 / Việc của tôi"
            title="Cần đăng nhập"
            lead="Phiên làm việc đã hết hạn hoặc chưa đăng nhập. Đăng nhập lại để xem quy trình này."
          />
          <Card className="border-warning/40">
            <CardTitle className="text-warning">Chưa có session hợp lệ</CardTitle>
            <CardDescription>Đăng nhập lại để tiếp tục.</CardDescription>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
            >
              Đăng nhập
            </Link>
          </Card>
        </>
      );
    }
    return (
      <>
        <PageHeader
          eyebrow="05 / Task inbox"
          title="Không đọc được quy trình"
          lead="Không tải được lần chạy này. Thử lại sau ít phút."
        />
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Lỗi khi đọc instance</CardTitle>
          <CardDescription>{describeApiError(cause)}</CardDescription>
          <Link
            href="/tasks"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            ← Về inbox
          </Link>
        </Card>
      </>
    );
  }

  const { instance, tasks, events } = view;
  const mine = openTasksForUser(tasks, me.roles);
  const waiting = nextTasks(tasks);

  const recordContext = await loadRecordContext(instance.objectKey, instance.recordId);
  // The log carries keys; the screen reads names (ADR 0018).
  const timeline = events.map((event) =>
    describeEvent(event, {
      roles: new Map(Object.entries(roleLabels)),
      fields: fieldNames({ fields: recordContext.fields }),
    }),
  );

  return (
    <>
      <PageHeader
        eyebrow={`05 / Việc của tôi · ${definitionName} v${instance.definitionVersion}`}
        title={recordContext.record ? 'Chi tiết công việc' : `Lần chạy ${instance.id.slice(0, 8)}…`}
        lead={`Chạy trên ${recordContext.record ? 'bản ghi bên dưới' : 'một bản ghi bạn không đọc được'} theo ${definitionName} phiên bản ${instance.definitionVersion}. Mọi quyết định bên dưới đều được ghi lại.`}
      />

      <p className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/tasks" className="text-on-surface-muted hover:text-on-surface">
          ← Về inbox
        </Link>
        {recordContext.record ? (
          <Link
            href={`/objects/${instance.objectKey}`}
            className="text-accent-strong hover:underline"
          >
            {objectName}
          </Link>
        ) : null}
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs font-medium',
            STATE_STYLES[instance.state] ?? 'border-border text-on-surface-muted',
          )}
        >
          {INSTANCE_STATE_LABELS[instance.state] ?? instance.state}
        </span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-on-surface-muted">
          {`lần ${instance.attempt}`}
        </span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              {`Việc của quy trình (${tasks.length})`}
            </h2>
            <ul className="space-y-4">
              {tasks.map((task) => {
                const canDecide = mine.some((candidate) => candidate.id === task.id);
                return (
                  <li
                    key={task.id}
                    className="rounded-xl border border-border bg-surface-raised p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[11px]',
                              TASK_STYLES[task.status] ?? 'border-border text-on-surface-muted',
                            )}
                          >
                            {TASK_STATUS_LABELS[task.status] ?? task.status}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
                            {labelOrKey(roleLabels[task.assigneeRole], task.assigneeRole)}
                          </span>
                          {task.attempt > 1 ? (
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
                              {`lần ${task.attempt}`}
                            </span>
                          ) : null}
                        </p>
                        <h3 className="mt-1.5 text-base font-semibold tracking-tight">
                          {task.title}
                        </h3>
                        <p className="mt-1 text-xs text-on-surface-muted">
                          {`Giao ${formatTimestamp(task.createdAt)}`}
                          {task.decidedBy ? ` · quyết định bởi ${task.decidedBy}` : ''}
                          {task.decidedAt ? ` lúc ${formatTimestamp(task.decidedAt)}` : ''}
                        </p>
                      </div>
                    </div>

                    {task.reason ? (
                      <p className="mt-3 rounded-lg border border-border bg-surface/50 px-3 py-2 text-sm italic text-on-surface-muted">
                        “{task.reason}”
                      </p>
                    ) : null}

                    {canDecide ? (
                      <DecisionForm
                        instanceId={instance.id}
                        taskId={task.id}
                        taskTitle={task.title}
                      />
                    ) : null}

                    {task.status === 'open' && !canDecide ? (
                      <p className="mt-3 text-xs text-on-surface-muted">
                        {'Việc này thuộc '}
                        <strong>
                          {labelOrKey(roleLabels[task.assigneeRole], task.assigneeRole)}
                        </strong>
                        {'; bạn không giữ vai trò đó nên không quyết định được.'}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {waiting.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-muted">
                Không còn việc nào đang mở — quy trình đã kết thúc.
              </p>
            ) : null}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              {`Event log (${timeline.length})`}
            </h2>
            <p className="mb-3 text-xs text-on-surface-muted">
              Append-only, cũ nhất trước. Không có bước nào thay đổi state mà không đi qua đây.
            </p>
            <ol className="space-y-2">
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap gap-3 rounded-lg border border-border bg-surface-raised/40 px-3 py-2 text-xs"
                >
                  <span className="w-36 shrink-0 font-mono text-on-surface-muted">{entry.at}</span>
                  <span className="min-w-0">
                    <span className="font-medium">{entry.label}</span>{' '}
                    <span className="text-on-surface-muted">{`bởi ${entry.actor}`}</span>
                    {entry.detail ? (
                      <span className="mt-0.5 block text-on-surface-muted">{entry.detail}</span>
                    ) : null}
                    {entry.reason ? (
                      <span className="mt-0.5 block text-on-surface-muted italic">
                        {`“${entry.reason}”`}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Dữ liệu quyết định đọc trên</CardTitle>
            <CardDescription>
              Bản ghi được render bằng đúng phiên bản định nghĩa mà nó mang, không phải bản mới
              nhất.
            </CardDescription>

            {recordContext.error ? (
              <p className="mt-4 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">
                {recordContext.error}
              </p>
            ) : null}

            {recordContext.record && recordContext.fields.length > 0 ? (
              <dl className="mt-4 space-y-2 text-sm">
                {recordContext.fields.map((field) => (
                  <div key={field.key} className="flex flex-wrap justify-between gap-2">
                    <dt className="text-on-surface-muted">{field.label}</dt>
                    <dd className="text-right">
                      {formatFieldValue(field, recordContext.record?.values[field.key])}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {recordContext.record && recordContext.fields.length === 0 && !recordContext.error ? (
              <p className="mt-4 text-sm text-on-surface-muted">
                {`Phiên bản v${recordContext.record.objectVersion} của định nghĩa không tìm thấy trong lịch sử publish, nên giá trị không được gán nhãn.`}
              </p>
            ) : null}

            {!recordContext.record && !recordContext.error ? (
              <p className="mt-4 text-sm text-on-surface-muted">
                Bạn thấy quy trình này vì đang giữ role của một việc mở, nhưng bản ghi thuộc bộ phận
                khác nên không hiển thị với bạn. Bạn vẫn ra được quyết định trên việc đó.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Instance</CardTitle>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-on-surface-muted">Định nghĩa</dt>
                <dd className="font-mono text-xs">
                  {`${definitionName} v${instance.definitionVersion}`}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-on-surface-muted">Bước hiện tại</dt>
                <dd className="text-right text-xs">
                  {waiting.length > 0
                    ? waiting.map((task) => task.title).join(', ')
                    : '— đã kết thúc'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-on-surface-muted">Bắt đầu</dt>
                <dd className="text-xs">{formatTimestamp(instance.startedAt)}</dd>
              </div>
              {instance.finishedAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-on-surface-muted">Kết thúc</dt>
                  <dd className="text-xs">{formatTimestamp(instance.finishedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

interface RecordContext {
  record: ObjectRecord | null;
  fields: BusinessObjectVersion['fields'];
  error: string | null;
}

/**
 * loadRecordContext reads the record the instance runs on, together with the
 * definition version it was created under, so the screen shows the values the
 * conditions were evaluated against. Both reads are best-effort: an instance is
 * still decidable when its record is outside the caller's read scope.
 */
async function loadRecordContext(objectKey: string, recordId: string): Promise<RecordContext> {
  const api = createServerApiClient();
  try {
    const [versions, records] = await Promise.all([
      api.listBusinessObjectVersions(objectKey),
      api.listObjectRecords(objectKey, { limit: 100 }).then((page) => page.data),
    ]);
    const record = records.find((candidate) => candidate.id === recordId) ?? null;
    if (!record) {
      return { record: null, fields: [], error: null };
    }
    const version = versions.find((candidate) => candidate.version === record.objectVersion);
    return { record, fields: version?.fields ?? [], error: null };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      return { record: null, fields: [], error: 'Loại dữ liệu của bản ghi này không còn.' };
    }
    return { record: null, fields: [], error: describeApiError(cause) };
  }
}
