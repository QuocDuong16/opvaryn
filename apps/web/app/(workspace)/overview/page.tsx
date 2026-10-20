import Link from 'next/link';
import {
  ApiError,
  type InboxItem,
  type Meta,
  type Me,
  type ProcessInstanceSummary,
} from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge';
import { isAdmin } from '@/lib/access';
import { advancedVisible } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { labelOrKey } from '@/lib/names';
import { stageLabel } from '@/lib/stage';

export const metadata = { title: 'Tổng quan' };

const RECENT_LIMIT = 5;

const STATE_LABELS: Record<string, string> = {
  running: 'Đang chạy',
  completed: 'Hoàn tất',
  rejected: 'Bị từ chối',
};

/** Shortcuts to the work a person does here; each one is a real screen, not a teaser. */
const SHORTCUTS: readonly { href: string; title: string; body: string }[] = [
  {
    href: '/objects',
    title: 'Nhập dữ liệu',
    body: 'Mở một loại dữ liệu để thêm bản ghi mới.',
  },
  {
    href: '/tasks',
    title: 'Xử lý việc đang chờ',
    body: 'Duyệt, trả về hoặc từ chối những việc thuộc vai trò của bạn.',
  },
  {
    href: '/analytics',
    title: 'Xem báo cáo',
    body: 'Chỉ số trên dữ liệu bạn được đọc, và bảng số liệu tự sắp.',
  },
];

/** Shown only with advanced mode on: how the build stands, for whoever runs the system. */
const SURFACES: readonly {
  href: string;
  stage: StatusKind;
  title: string;
  body: string;
}[] = [
  {
    href: '/objects',
    stage: 'live',
    title: 'Dữ liệu',
    body: 'Định nghĩa có phiên bản và bản ghi; sửa định nghĩa là phát hành phiên bản mới.',
  },
  {
    href: '/forms',
    stage: 'live',
    title: 'Nhập liệu',
    body: 'Màn hình nhập sinh từ định nghĩa; dữ liệu kiểm tra theo phiên bản của bản ghi.',
  },
  {
    href: '/workflows',
    stage: 'live',
    title: 'Quy trình',
    body: 'Sơ đồ kéo thả trên bản nháp, phát hành thành phiên bản mới; lần chạy giữ phiên bản của nó.',
  },
  {
    href: '/tasks',
    stage: 'live',
    title: 'Việc của tôi',
    body: 'Việc đang mở theo role; quyết định ghi lại kèm người thực hiện và lý do.',
  },
  {
    href: '/analytics',
    stage: 'live',
    title: 'Báo cáo',
    body: 'Metric tự định nghĩa trên field của bản ghi, cộng chỉ số vận hành quy trình.',
  },
  {
    href: '/apps',
    stage: 'live',
    title: 'Ứng dụng',
    body: 'Nhiều dạng xem trên cùng dữ liệu; kanban và panel tích hợp là minh hoạ.',
  },
  {
    href: '/admin',
    stage: 'live',
    title: 'Quản trị',
    body: 'Tài khoản, phòng ban và vai trò của tổ chức; chỉ người giữ vai trò quản trị thấy.',
  },
  {
    href: '/settings',
    stage: 'live',
    title: 'Vận hành',
    body: 'Endpoint, cổng, phiên bản công cụ và nhật ký gửi sự kiện ra ngoài.',
  },
  {
    href: '/roadmap',
    stage: 'concept',
    title: 'Lộ trình',
    body: 'Các mốc tiếp theo và những gì chưa có — kế hoạch, không phải tính năng đã có.',
  },
];

const NOT_YET: readonly { title: string; body: string }[] = [
  {
    title: 'SSO',
    body: 'Đăng nhập hiện dùng tài khoản nội bộ; kết nối hệ thống đăng nhập của tổ chức đang chờ chính hệ thống đó.',
  },
  {
    title: 'Hạn xử lý và chuyển cấp',
    body: 'Cần một chính sách thời gian làm việc; chưa có, nên hệ thống không hiển thị hạn giả.',
  },
  {
    title: 'Kết nối hai chiều',
    body: 'Hiện gửi được sự kiện ra hệ thống khác kèm thử lại và nhật ký; đọc dữ liệu từ hệ thống ngoài thì chưa.',
  },
  {
    title: 'Kanban và panel tích hợp thật',
    body: 'Trong màn Ứng dụng, hai phần này chỉ là minh hoạ cho phần sẽ làm ở V2.',
  },
  {
    title: 'Tiện ích trình soạn quy trình',
    body: 'Hoàn tác và nhiều người cùng sửa một định nghĩa chưa có.',
  },
  {
    title: 'Nhiều nhánh song song',
    body: 'Chưa hỗ trợ nhiều nhánh chạy song song và gộp nhánh.',
  },
];

const STATUS_LEGEND: readonly { kind: StatusKind; body: string }[] = [
  {
    kind: 'live',
    body: 'Chạy thật: dữ liệu được lưu lại, thao tác có hiệu lực thật.',
  },
  {
    kind: 'mock',
    body: 'Mô phỏng: giao diện thật nhưng dữ liệu và hành vi được giả lập để minh hoạ.',
  },
  {
    kind: 'concept',
    body: 'Concept: minh họa tầm nhìn dài hạn, chưa có hành vi và chưa thuộc phạm vi V1.',
  },
];

interface Overview {
  me: Me | null;
  inbox: InboxItem[];
  /** How many open tasks the person has, behind the few the page shows. */
  inboxTotal: number;
  instances: ProcessInstanceSummary[];
  /** Definition key to its name, so a run is named rather than keyed. */
  definitionNames: Record<string, string>;
  error: string | null;
  /** True when the inbox could not be read: an empty inbox and a failed read differ. */
  inboxFailed: boolean;
}

async function loadOverview(): Promise<Overview> {
  const api = createServerApiClient();

  let me: Me;
  try {
    me = await api.getMe();
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      // The proxy already sends anonymous callers to the sign-in screen; a session that
      // expired between the two calls lands here.
      return {
        me: null,
        inbox: [],
        inboxTotal: 0,
        instances: [],
        definitionNames: {},
        error: 'Phiên làm việc đã hết hạn.',
        inboxFailed: true,
      };
    }
    return {
      me: null,
      inbox: [],
      instances: [],
      definitionNames: {},
      inboxTotal: 0,
      error: describeApiError(cause),
      inboxFailed: true,
    };
  }

  // Each part fails on its own: a slow list must not blank the whole page. A failed read
  // is not an empty list, though — it is reported, so nobody is told "you have no work"
  // when the truth is "the system could not answer".
  const [inboxResult, instancesResult] = await Promise.all([
    api
      .listInboxTasks({ limit: RECENT_LIMIT })
      .then((page) => ({ items: page.data, total: page.total }))
      .catch(() => null),
    api
      .listProcessInstances({}, { limit: RECENT_LIMIT })
      .then((page) => page.data)
      .catch(() => null),
  ]);
  const inbox = inboxResult?.items ?? [];
  // The badge counts every open task, not only the few the page shows.
  const inboxTotal = inboxResult?.total ?? 0;
  const instances = instancesResult ?? [];
  const inboxFailed = inboxResult === null;

  // A screen names things: the process by its name, the record by its own label (built from
  // the version it was created under, ADR 0006). Both lookups are best-effort — a missing
  // name falls back to the key rather than blanking the table.
  const definitions = (await api.listProcessDefinitions({ limit: 100 }).catch(() => ({ data: [] })))
    .data;
  const definitionNames = Object.fromEntries(definitions.map((item) => [item.key, item.name]));

  return { me, inbox, inboxTotal, instances, definitionNames, error: null, inboxFailed };
}

export default async function OverviewPage() {
  const [overview, advanced] = await Promise.all([loadOverview(), getAdvancedMode()]);
  const { me, inbox, inboxTotal, instances, definitionNames, error, inboxFailed } = overview;
  const showAdvanced = advancedVisible(isAdmin(me?.roles), advanced);

  if (!me) {
    return (
      <>
        <PageHeader
          eyebrow="01 / Tổng quan"
          title="Tổng quan"
          lead="Việc đang chờ bạn và lối vào các phần chính."
        />
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Không mở được trang này</CardTitle>
          <CardDescription>{error ?? 'Không đọc được phiên làm việc.'}</CardDescription>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Đăng nhập lại
          </Link>
        </Card>
      </>
    );
  }

  const recent = instances.slice(0, RECENT_LIMIT);

  return (
    <>
      <PageHeader
        eyebrow="01 / Tổng quan"
        title={`Xin chào, ${me.name}`}
        lead={`Bộ phận ${me.departmentName || '—'} · ${
          me.roles.map((role) => labelOrKey(me.roleLabels[role], role)).join(', ') || '—'
        }. Dưới đây là việc đang chờ bạn và những chỗ bạn hay dùng.`}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Việc đang chờ bạn</CardTitle>
            <CardDescription>
              Chỉ những việc thuộc vai trò bạn giữ, mới nhất ở trên đầu.
            </CardDescription>
          </div>
          <span className="rounded-full border border-warning/40 px-2.5 py-0.5 text-xs font-medium text-warning">
            {inboxTotal} việc
          </span>
        </div>

        {inboxFailed ? (
          <p className="mt-4 rounded-lg border border-warning/40 px-4 py-6 text-center text-sm text-on-surface-muted">
            Không đọc được danh sách việc lúc này. Thử lại sau ít phút.
          </p>
        ) : inbox.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-on-surface-muted">
            Không có việc nào đang chờ bạn.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {inbox.map((item) => (
              <li key={item.task.id}>
                <Link
                  href={`/tasks/${item.instance.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 hover:text-accent-strong"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.task.title}</span>
                    <span className="block text-xs text-on-surface-muted">
                      {`${item.recordName ?? 'Bản ghi chưa có tên hiển thị'} · từ ${formatTimestamp(item.task.createdAt)}`}
                    </span>
                  </span>
                  <span className="text-xs font-medium">Xử lý →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {inboxTotal > inbox.length ? (
          <Link
            href="/tasks"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            Xem tất cả {inboxTotal} việc →
          </Link>
        ) : null}
      </Card>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        {SHORTCUTS.map((shortcut) => (
          <Link key={shortcut.href} href={shortcut.href} className="group">
            <Card className="h-full transition-colors group-hover:border-border-strong">
              <CardTitle>{shortcut.title}</CardTitle>
              <CardDescription>{shortcut.body}</CardDescription>
            </Card>
          </Link>
        ))}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Lần chạy gần đây</h2>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-on-surface-muted">
            Chưa có quy trình nào được khởi động trong phạm vi bạn đọc được.
          </p>
        ) : (
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
                    Bản ghi
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Khởi động
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface-raised/40">
                {recent.map((summary) => (
                  <tr key={summary.instance.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/tasks/${summary.instance.id}`}
                        className="font-medium hover:text-accent-strong"
                      >
                        {labelOrKey(
                          definitionNames[summary.instance.definitionKey],
                          summary.instance.definitionKey,
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {STATE_LABELS[summary.instance.state] ?? summary.instance.state}
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-muted">
                      {summary.recordName ?? 'Bản ghi chưa có tên hiển thị'}
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-muted">
                      {formatTimestamp(summary.instance.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showAdvanced ? <AdvancedSection /> : null}
    </>
  );
}

/**
 * The administrator's view of the build itself: platform status, every screen with its label,
 * what is not built yet, and the label legend. It sits below the work and appears only with
 * advanced mode on (ADR 0015).
 */
async function AdvancedSection() {
  let meta: Meta | null = null;
  let reachable = false;
  try {
    const api = createServerApiClient();
    meta = await api.getMeta();
    const readiness = await api.getReadiness();
    reachable = readiness.status === 'ok';
  } catch {
    meta = null;
  }

  return (
    <section className="mt-10 border-t border-border pt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Thông tin hệ thống</h2>
        <span className="font-mono text-[11px] tracking-wide text-on-surface-muted uppercase">
          Chế độ nâng cao
        </span>
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Trạng thái nền tảng</CardTitle>
            <CardDescription>Đọc trực tiếp từ hệ thống đang chạy.</CardDescription>
          </div>
          <StatusBadge kind={reachable ? 'live' : 'mock'} />
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Phiên bản</dt>
            <dd className="mt-1 font-mono text-sm">{meta?.version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Giai đoạn</dt>
            <dd className="mt-1 font-mono text-sm">{meta ? stageLabel(meta.stage) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Máy chủ API</dt>
            <dd className="mt-1 text-sm">{reachable ? 'sẵn sàng' : 'chưa kết nối'}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Cơ sở dữ liệu</dt>
            <dd className="mt-1 text-sm">{reachable ? 'sẵn sàng' : 'chưa kết nối'}</dd>
          </div>
        </dl>
      </Card>

      <h3 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
        Các màn hình
      </h3>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {SURFACES.map((surface) => (
          <Link key={surface.href} href={surface.href} className="group">
            <Card className="h-full transition-colors group-hover:border-border-strong">
              <div className="flex items-start justify-between gap-3">
                <CardTitle>{surface.title}</CardTitle>
                <StatusBadge kind={surface.stage} />
              </div>
              <CardDescription>{surface.body}</CardDescription>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
          Chưa có trong V1
        </h3>
        <StatusBadge kind="concept" />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {NOT_YET.map((item) => (
          <Card key={item.title}>
            <CardTitle>{item.title}</CardTitle>
            <CardDescription>{item.body}</CardDescription>
          </Card>
        ))}
      </div>

      <h3 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
        Quy ước nhãn trạng thái
      </h3>
      <div className="grid gap-4 sm:grid-cols-3">
        {STATUS_LEGEND.map((entry) => (
          <Card key={entry.kind}>
            <StatusBadge kind={entry.kind} />
            <CardDescription>{entry.body}</CardDescription>
          </Card>
        ))}
      </div>
    </section>
  );
}
