import Link from 'next/link';
import type { Meta } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Tổng quan' };

interface PlatformStatus {
  api: boolean;
  database: boolean;
  meta: Meta | null;
  message: string | null;
}

async function loadPlatformStatus(): Promise<PlatformStatus> {
  const api = createServerApiClient();
  try {
    const [meta, readiness] = await Promise.all([api.getMeta(), api.getReadiness()]);
    return {
      api: true,
      database: readiness.status === 'ok',
      meta,
      message: null,
    };
  } catch (cause) {
    return { api: false, database: false, meta: null, message: describeApiError(cause) };
  }
}

/**
 * The screens of the product, each with the label its own content earns: a screen that
 * reads real rows is `live`, a screen that draws simulated data is `mock`, a screen that
 * only describes the plan is `concept` (AGENTS.md).
 */
const SURFACES: readonly {
  href: string;
  stage: StatusKind;
  title: string;
  body: string;
}[] = [
  {
    href: '/objects',
    stage: 'live',
    title: 'Business Objects & bản ghi',
    body: 'Khai schema với field có kiểu, publish định nghĩa theo phiên bản bất biến và nhập bản ghi thật vào PostgreSQL.',
  },
  {
    href: '/forms',
    stage: 'live',
    title: 'Form builder',
    body: 'Form nhập liệu sinh trực tiếp từ schema; validate ở server theo đúng phiên bản định nghĩa mà bản ghi được tạo dưới.',
  },
  {
    href: '/workflows',
    stage: 'live',
    title: 'Workflow designer',
    body: 'Canvas kéo thả trên bản nháp của trình duyệt rồi publish thành phiên bản mới; bản đã publish là bất biến và instance giữ phiên bản lúc start.',
  },
  {
    href: '/tasks',
    stage: 'live',
    title: 'Task inbox',
    body: 'Việc đang mở thuộc đúng các role người đăng nhập giữ; mở một việc để xem bản ghi, timeline sự kiện và quyết định duyệt / trả về / từ chối.',
  },
  {
    href: '/analytics',
    stage: 'live',
    title: 'Analytics',
    body: 'Metric tự định nghĩa trên field của object (đếm / tổng / trung bình, lọc, nhóm) chạy trên projection có kiểu, cộng số liệu vận hành của engine — tất cả theo phạm vi đọc.',
  },
  {
    href: '/apps',
    stage: 'live',
    title: 'Application showcase',
    body: 'Cùng một object dưới nhiều dạng xem: danh sách và chi tiết đọc dữ liệu thật; kanban và panel connector là mô phỏng, tab cấu hình là concept — mỗi view gắn nhãn riêng.',
  },
  {
    href: '/settings',
    stage: 'live',
    title: 'Cài đặt',
    body: 'Endpoint đang chạy, cổng và toolchain được pin, cùng nhật ký giao webhook ra ngoài (kể cả lần thử lại).',
  },
  {
    href: '/roadmap',
    stage: 'concept',
    title: 'Roadmap',
    body: 'Bốn phase, điều kiện nghiệm thu MVP V1 và những gì còn thiếu — kế hoạch, không phải tính năng đã có.',
  },
];

const PRINCIPLES: readonly { title: string; body: string }[] = [
  {
    title: 'Không giới hạn trong "phiếu"',
    body: 'Form chỉ là một giao diện nhập liệu; quy trình có thể khởi tạo từ người dùng, lịch, webhook, event hoặc API.',
  },
  {
    title: 'Definition ≠ Instance',
    body: 'Định nghĩa và lần chạy là hai thực thể riêng, có versioning để thay đổi cấu hình không phá quy trình đang xử lý.',
  },
  {
    title: 'Platform-first, không over-engineer',
    body: 'Domain và interface đủ mở rộng, nhưng V1 chỉ hiện thực hóa một tập use case an toàn và dùng được.',
  },
  {
    title: 'Data & security by design',
    body: 'Field có kiểu rõ ràng, audit, quyền theo dữ liệu và analytics-ready được tính từ đầu, không bổ sung về sau.',
  },
  {
    title: 'MVP phải xử lý nghiệp vụ thật',
    body: 'V1 không phải một bộ UI: workflow phải chạy đúng, quyền hợp lệ, dữ liệu bền vững và theo dõi được.',
  },
  {
    title: 'Nhãn trạng thái phải trung thực',
    body: 'Phần mô phỏng được gắn nhãn rõ ràng và không bao giờ được trình bày như chức năng thật — theo cả hai chiều.',
  },
];

/**
 * What the product does not do yet. Kept next to the surfaces so the page never reads as
 * if the platform were finished; the roadmap page carries the detail and the phases.
 */
const NOT_YET: readonly { title: string; body: string }[] = [
  {
    title: 'OIDC / SSO',
    body: 'Đăng nhập hiện dùng tài khoản nội bộ có role và bộ phận. Cắm IdP của tổ chức đang chờ chính IdP đó.',
  },
  {
    title: 'SLA và escalation',
    body: 'Hạn xử lý, timer và tự động chuyển cấp cần một chính sách thời gian làm việc — thuộc V1.x, nên không có hạn giả nào được hiển thị.',
  },
  {
    title: 'Integration Hub đầy đủ',
    body: 'Hiện có webhook ra ngoài kèm retry và nhật ký giao; adapter hai chiều với mapping thì chưa.',
  },
  {
    title: 'Kanban và connector thật',
    body: 'Hai dạng xem này trong Application showcase là mô phỏng để minh hoạ Application Builder (V2).',
  },
  {
    title: 'Tiện ích của trình soạn quy trình',
    body: 'Undo/redo và nhiều người cùng sửa một định nghĩa cần khoá lạc quan — chưa nằm trong V1.',
  },
  {
    title: 'Song song và join',
    body: 'Nhiều nhánh cùng lúc, gộp nhánh và điều kiện join nằm ngoài phạm vi đã chốt của ADR 0007.',
  },
];

const STATUS_LEGEND: readonly { kind: StatusKind; body: string }[] = [
  {
    kind: 'live',
    body: 'Chạy thật: dữ liệu đi qua API Go và PostgreSQL, thao tác có hiệu lực thật.',
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

export default async function OverviewPage() {
  const status = await loadPlatformStatus();

  return (
    <>
      <PageHeader
        eyebrow="01 / Tổng quan"
        title="OPVARYN — Business Operations Platform"
        lead="Một nền tảng xây dựng và điều phối hoạt động nội bộ, nơi tổ chức tự định nghĩa dữ liệu, quy trình, ứng dụng nghiệp vụ và báo cáo của mình. MVP V1 đang chạy trong repo này: ba quy trình pilot, engine duyệt thật, phân quyền theo role và bộ phận, analytics trên projection có kiểu, và triển khai một host có backup."
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Trạng thái nền tảng</CardTitle>
            <CardDescription>
              Đọc trực tiếp từ API đang chạy, không có dữ liệu giả ở khối này.
            </CardDescription>
          </div>
          <StatusBadge kind={status.api ? 'live' : 'mock'} />
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Sản phẩm</dt>
            <dd className="mt-1 font-medium">{status.meta?.name ?? 'OPVARYN'}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Phiên bản</dt>
            <dd className="mt-1 font-mono text-sm">{status.meta?.version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Giai đoạn</dt>
            <dd className="mt-1 font-mono text-sm">{status.meta?.stage ?? '—'}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <DependencyChip label="API (Go)" up={status.api} />
          <DependencyChip label="PostgreSQL" up={status.database} />
        </div>

        {status.message ? (
          <div className="mt-5 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
            <p className="font-medium text-warning">API chưa sẵn sàng</p>
            <p className="mt-1 text-on-surface-muted">{status.message}</p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-on-surface-muted">
              make docker-up{'\n'}cd apps/api &amp;&amp; go run ./cmd/migrate
            </pre>
          </div>
        ) : null}
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Quy trình pilot"
          value="3"
          note="Duyệt mua hàng, xử lý sự cố IT và onboarding nhân sự (D07)."
        />
        <KpiCard
          label="Điều kiện nghiệm thu MVP V1"
          value="1–7"
          note="Có bằng chứng chạy được trong repo; chi tiết ở trang Roadmap."
        />
        <KpiCard
          label="Triển khai"
          value="1 host"
          note="Docker Compose, TLS qua Caddy, backup có diễn tập phục hồi (ADR 0009)."
        />
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Các màn hình của sản phẩm</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SURFACES.map((stop, index) => (
            <Link key={stop.href} href={stop.href} className="group">
              <Card className="h-full transition-colors group-hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">
                    <span className="mr-2 font-mono text-xs text-accent-strong">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {stop.title}
                  </p>
                  <StatusBadge kind={stop.stage} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-muted">{stop.body}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Chưa có trong V1</h2>
          <StatusBadge kind="concept" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {NOT_YET.map((item) => (
            <Card key={item.title}>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-on-surface-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Nguyên tắc đã thống nhất</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((principle) => (
            <Card key={principle.title}>
              <h3 className="text-sm font-semibold">{principle.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-on-surface-muted">
                {principle.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Quy ước nhãn trạng thái</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {STATUS_LEGEND.map((entry) => (
            <Card key={entry.kind}>
              <StatusBadge kind={entry.kind} />
              <p className="mt-3 text-sm leading-relaxed text-on-surface-muted">{entry.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

function DependencyChip({ label, up }: { label: string; up: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
      <span aria-hidden className={`size-1.5 rounded-full ${up ? 'bg-success' : 'bg-danger'}`} />
      {label}: {up ? 'sẵn sàng' : 'chưa kết nối'}
    </span>
  );
}

function KpiCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <p className="text-xs tracking-wide text-on-surface-muted uppercase">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-on-surface-muted">{note}</p>
    </Card>
  );
}
