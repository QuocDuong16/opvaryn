import Link from 'next/link';
import { ApiError, type InboxItem, type Me } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';

export const metadata = { title: 'Tasks' };

const RUNTIME_GAPS: readonly { title: string; body: string }[] = [
  {
    title: 'Đã có trong engine',
    body: 'Resolver theo role (D08b), transition atomic bằng compare-and-swap (người thứ hai nhận 409), audit append-only kèm actor và lý do, từ chối terminal và trả về reset theo D08a.',
  },
  {
    title: 'Chưa có: song song và join',
    body: 'Nhiều nhánh cùng lúc, gộp nhánh và điều kiện join nằm ngoài phạm vi đã chốt của ADR 0007 (mục 12).',
  },
  {
    title: 'Chưa có: SLA và escalation',
    body: 'Timer, hạn xử lý và tự động chuyển cấp là V1.x; chưa có bảng hay cột nào cho chúng, nên màn hình này không hiển thị hạn giả.',
  },
  {
    title: 'Chưa có: uỷ quyền và huỷ instance',
    body: 'Delegate, subprocess, service action và huỷ instance giữa đường đều chưa có cột trong schema lẫn giao diện.',
  },
];

export default async function TasksPage() {
  const api = createServerApiClient();

  let me: Me | null = null;
  let items: InboxItem[] = [];
  let error: string | null = null;
  let needsSignIn = false;

  try {
    me = await api.getMe();
    items = await api.listInboxTasks();
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      needsSignIn = true;
    } else {
      error = describeApiError(cause);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="05 / Task inbox"
        title="Tasks"
        lead="Inbox thật: task đang mở thuộc đúng các role mà người đang đăng nhập giữ, đọc từ engine qua API. Mở một việc để xem bản ghi, timeline sự kiện và quyết định duyệt, trả về hoặc từ chối."
        aside={<StatusBadge kind={error || needsSignIn ? 'mock' : 'live'} />}
      />

      {needsSignIn ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Cần đăng nhập để đọc inbox</CardTitle>
          <CardDescription>
            Inbox là theo người: API chỉ trả việc thuộc các role mà session đang giữ. Đăng nhập rồi
            quay lại trang này.
          </CardDescription>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Đăng nhập
          </Link>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được inbox</CardTitle>
          <CardDescription>{error}</CardDescription>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-on-surface-muted">
            make docker-up{'\n'}cd apps/api &amp;&amp; go run ./cmd/migrate{'\n'}make seed-demo
            {'\n'}
            make dev
          </pre>
        </Card>
      ) : null}

      {me ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-muted">Đang chờ bạn</dt>
              <dd className="font-semibold text-warning">{items.length}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-muted">Role của bạn</dt>
              <dd className="font-mono text-xs">{me.roles.join(', ') || '—'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-muted">Bộ phận</dt>
              <dd className="font-mono text-xs">{me.department || '—'}</dd>
            </div>
          </dl>
          <p className="text-xs text-on-surface-muted">
            Việc cũ nhất ở trên đầu, đúng thứ tự engine trả về.
          </p>
        </div>
      ) : null}

      {me && items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
          <p className="text-sm font-medium">Không có việc nào đang chờ bạn</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-muted">
            Inbox chỉ chứa task mở thuộc role bạn giữ. Khởi động một quy trình từ màn hình bản ghi
            của business object (hoặc chạy <code className="font-mono text-xs">make seed-demo</code>
            ), rồi tải lại trang.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-6 space-y-4">
          {items.map((item) => (
            <li
              key={item.task.id}
              className="rounded-xl border border-border bg-surface-raised p-5 transition-colors hover:border-border-strong"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning">
                      Đang chờ quyết định
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-on-surface-muted">
                      {`role ${item.task.assigneeRole}`}
                    </span>
                    {item.task.attempt > 1 ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
                        {`attempt ${item.task.attempt}`}
                      </span>
                    ) : null}
                  </p>
                  <h2 className="mt-1.5 text-base font-semibold tracking-tight">
                    {item.task.title}
                  </h2>
                  <p className="mt-1 text-xs text-on-surface-muted">
                    <code className="font-mono">{item.instance.definitionKey}</code>
                    {` v${item.instance.definitionVersion} · node `}
                    <code className="font-mono">{item.task.nodeKey}</code>
                    {` · ${item.instance.objectKey}`}
                  </p>
                </div>
                <div className="text-right text-xs text-on-surface-muted">
                  <p>{`Giao lúc ${formatTimestamp(item.task.createdAt)}`}</p>
                  <p className="mt-1 font-mono">{`instance ${item.instance.id.slice(0, 8)}…`}</p>
                </div>
              </div>

              <Link
                href={`/tasks/${item.instance.id}`}
                className="mt-4 inline-block rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
              >
                Mở và quyết định
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {me ? (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Engine đã có gì, inbox còn thiếu gì
            </h2>
            <StatusBadge kind="concept" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {RUNTIME_GAPS.map((item) => (
              <Card key={item.title}>
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-on-surface-muted">{item.body}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
