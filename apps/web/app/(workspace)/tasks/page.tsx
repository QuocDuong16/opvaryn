import Link from 'next/link';
import { ApiError, type InboxItem, type Me } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { labelOrKey } from '@/lib/names';

export const metadata = { title: 'Việc của tôi' };

const RUNTIME_GAPS: readonly { title: string; body: string }[] = [
  {
    title: 'Đã có',
    body: 'Việc giao theo role; hai người quyết cùng lúc thì người sau được báo là việc đã được xử lý; mọi quyết định đều ghi lại kèm người thực hiện và lý do; từ chối là kết thúc, còn trả về thì mở lại từ đầu.',
  },
  {
    title: 'Chưa có: song song và join',
    body: 'Chưa hỗ trợ nhiều nhánh chạy song song và gộp nhánh.',
  },
  {
    title: 'Chưa có: SLA và escalation',
    body: 'Hạn xử lý và tự động chuyển cấp chưa có, nên màn hình này không hiển thị hạn giả.',
  },
  {
    title: 'Chưa có: uỷ quyền và huỷ instance',
    body: 'Uỷ quyền cho người khác, quy trình con và huỷ một lần chạy giữa đường đều chưa có.',
  },
];

interface PageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

/** One page of the inbox; the API slices and reports the total. */
const PER_PAGE = 25;

export default async function TasksPage({ searchParams }: PageProps) {
  const { q, offset: rawOffset } = await searchParams;
  const query = (q ?? '').trim();
  const offset = pageOffset(rawOffset, PER_PAGE);
  const api = createServerApiClient();

  let me: Me | null = null;
  let items: InboxItem[] = [];
  let total = 0;
  let definitionNames: Record<string, string> = {};
  let objectNames: Record<string, string> = {};
  let error: string | null = null;
  let needsSignIn = false;

  try {
    me = await api.getMe();
    const [page, definitions, objects] = await Promise.all([
      api.listInboxTasks({ q: query || undefined, limit: PER_PAGE, offset }),
      api.listProcessDefinitions({ limit: 100 }),
      api.listBusinessObjects({ limit: 100 }),
    ]);
    items = page.data;
    total = page.total;
    // The card names the process and the object it belongs to; both catalogues are small
    // enough to read once and are allowed to fail without hiding the work.
    definitionNames = Object.fromEntries(
      definitions.data.map((definition) => [definition.key, definition.name]),
    );
    objectNames = Object.fromEntries(objects.data.map((object) => [object.key, object.name]));
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
        eyebrow="05 / Việc của tôi"
        title="Việc của tôi"
        lead="Hộp việc của bạn: chỉ những việc đang mở thuộc vai trò bạn giữ. Mở một việc để xem bản ghi, diễn biến và quyết định duyệt, trả về hoặc từ chối."
      />

      {needsSignIn ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Cần đăng nhập để đọc inbox</CardTitle>
          <CardDescription>
            Mỗi người chỉ thấy việc thuộc role mình giữ. Đăng nhập rồi quay lại trang này.
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
          <p className="mt-4 text-sm text-on-surface-muted">
            Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
          </p>
        </Card>
      ) : null}

      {me ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-muted">Đang chờ bạn</dt>
              <dd className="font-semibold text-warning">{total}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-muted">Vai trò của bạn</dt>
              <dd className="text-xs">
                {me.roles.map((role) => labelOrKey(me.roleLabels[role], role)).join(', ') || '—'}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-muted">Bộ phận</dt>
              <dd className="text-xs">{me.departmentName || '—'}</dd>
            </div>
          </dl>
          <p className="text-xs text-on-surface-muted">Việc cũ nhất ở trên đầu.</p>
        </div>
      ) : null}

      {me && total === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
          <p className="text-sm font-medium">Không có việc nào đang chờ bạn</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-muted">
            Hộp việc chỉ chứa việc đang mở thuộc vai trò bạn giữ. Mở một bản ghi và khởi động quy
            trình từ đó, rồi tải lại trang.
          </p>
        </div>
      ) : null}

      {me ? (
        <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {query ? `Kết quả cho “${query}”` : 'Việc đang mở'}
          </h2>
          <ListSearch
            basePath="/tasks"
            value={query}
            placeholder="Tìm theo tên việc hoặc quy trình"
            label="Tìm việc"
          />
        </div>
      ) : null}

      {me && items.length > 0 ? (
        <ul className="space-y-4">
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
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
                      {labelOrKey(me.roleLabels[item.task.assigneeRole], item.task.assigneeRole)}
                    </span>
                    {item.task.attempt > 1 ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
                        {`lần ${item.task.attempt}`}
                      </span>
                    ) : null}
                  </p>
                  <h2 className="mt-1.5 text-base font-semibold tracking-tight">
                    {item.task.title}
                  </h2>
                  <p className="mt-1 text-xs text-on-surface-muted">
                    {`${labelOrKey(definitionNames[item.instance.definitionKey], item.instance.definitionKey)} v${item.instance.definitionVersion} · ${labelOrKey(objectNames[item.instance.objectKey], item.instance.objectKey)}`}
                  </p>
                </div>
                <div className="text-right text-xs text-on-surface-muted">
                  <p>{`Giao lúc ${formatTimestamp(item.task.createdAt)}`}</p>
                  <p className="mt-1">{`Lần chạy ${item.instance.id.slice(0, 8)}…`}</p>
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

      <Pagination
        total={total}
        limit={PER_PAGE}
        offset={offset}
        basePath="/tasks"
        params={{ q: query || undefined }}
      />

      {me ? (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Đã có gì, còn thiếu gì</h2>
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
