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

const DEMO_TOUR: readonly {
  href: string;
  stage: StatusKind;
  title: string;
  body: string;
}[] = [
  {
    href: '/objects',
    stage: 'live',
    title: 'Business Objects & bản ghi',
    body: 'Khai schema với field có kiểu, tạo định nghĩa và nhập bản ghi thật vào PostgreSQL.',
  },
  {
    href: '/forms',
    stage: 'live',
    title: 'Form Builder preview',
    body: 'Form nhập liệu sinh trực tiếp từ schema; thử submit để thấy validate ở server.',
  },
  {
    href: '/workflows',
    stage: 'mock',
    title: 'Workflow Designer',
    body: 'Sơ đồ hai quy trình mẫu với nhánh điều kiện và inspector node — chưa có runtime.',
  },
  {
    href: '/tasks',
    stage: 'mock',
    title: 'Task Inbox',
    body: 'Duyệt, trả về, từ chối trên dữ liệu mô phỏng kèm timeline và người giữ việc.',
  },
  {
    href: '/analytics',
    stage: 'mock',
    title: 'Analytics Studio',
    body: 'Chọn metric, dimension và chart trên số liệu fixture; lưu bố cục thuộc MVP.',
  },
  {
    href: '/apps',
    stage: 'live',
    title: 'Application showcase',
    body: 'Cùng một object dưới dạng list, detail, kanban và panel tích hợp — hai dạng xem đọc dữ liệu thật.',
  },
  {
    href: '/settings',
    stage: 'live',
    title: 'Cài đặt & môi trường demo',
    body: 'Endpoint đang chạy, cổng local và toolchain được pin cho buổi trình diễn.',
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
    body: 'Domain và interface đủ mở rộng, nhưng demo chỉ hiện thực hóa một tập use case an toàn và dùng được.',
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
    title: 'Demo minh họa tầm nhìn',
    body: 'Tính năng mô phỏng phải được gắn nhãn rõ ràng, không được trình bày như chức năng thật.',
  },
];

const DEMO_PLAN: readonly { time: string; title: string; body: string }[] = [
  {
    time: 'Tuần 1',
    title: 'Foundation & Design System',
    body: 'App shell, navigation, design tokens, domain và API contracts.',
  },
  {
    time: 'Tuần 2–3',
    title: 'Business Object & Form Builder',
    body: 'Schema editor, field types, validation, preview.',
  },
  {
    time: 'Tuần 4–5',
    title: 'Workflow & Task Experience',
    body: 'Visual graph, nhánh điều kiện, duyệt/từ chối/trả về, timeline và inbox.',
  },
  {
    time: 'Tuần 6',
    title: 'Analytics Studio',
    body: 'Metric, chart selector, dashboard được lưu theo bố cục.',
  },
  {
    time: 'Tuần 7',
    title: 'Application Builder Showcase',
    body: 'Một mini-app giả định, mock connector và màn hình administration.',
  },
  {
    time: 'Tuần 8',
    title: 'Polish & Vision Roadmap',
    body: 'Walkthrough, nhãn live/mock/concept, nội dung roadmap và test demo flows.',
  },
];

const STATUS_LEGEND: readonly { kind: StatusKind; body: string }[] = [
  {
    kind: 'live',
    body: 'Chạy thật: dữ liệu đi qua API Go và PostgreSQL, thao tác có hiệu lực thật.',
  },
  {
    kind: 'mock',
    body: 'Mô phỏng: giao diện thật nhưng dữ liệu và hành vi được giả lập cho buổi trình diễn.',
  },
  {
    kind: 'concept',
    body: 'Concept: minh họa tầm nhìn dài hạn, chưa có hành vi và chưa thuộc phạm vi demo.',
  },
];

export default async function OverviewPage() {
  const status = await loadPlatformStatus();

  return (
    <>
      <PageHeader
        eyebrow="01 / Product vision"
        title="OPVARYN — Business Operations Platform"
        lead="Một nền tảng xây dựng và điều phối hoạt động nội bộ, nơi tổ chức tự định nghĩa dữ liệu, quy trình, ứng dụng nghiệp vụ và báo cáo của mình. Trang này là điểm vào của bản demo tương tác."
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
          label="Luận điểm chính"
          value="Platform-first"
          note="Không đóng khung trong phiếu hoặc luồng duyệt."
        />
        <KpiCard label="Mốc demo" value="8 tuần" note="Bản trình diễn tương tác của tầm nhìn." />
        <KpiCard
          label="Mốc MVP V1"
          value="24 tuần"
          note="Ước lượng từ playbook, chưa phải cam kết."
        />
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Walkthrough bản demo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {DEMO_TOUR.map((stop, index) => (
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

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Kế hoạch 8 tuần của bản demo</h2>
        <ol className="space-y-3">
          {DEMO_PLAN.map((step) => (
            <li key={step.time} className="flex gap-4">
              <span className="w-20 shrink-0 pt-0.5 font-mono text-xs text-accent-strong">
                {step.time}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-sm text-on-surface-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
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
