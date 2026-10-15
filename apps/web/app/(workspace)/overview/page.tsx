import Link from 'next/link';
import type { Meta } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { stageLabel } from '@/lib/stage';

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
    body: 'Tự định nghĩa dữ liệu với field có kiểu; sửa định nghĩa bằng cách publish phiên bản mới, và nhập bản ghi ngay trên đó.',
  },
  {
    href: '/forms',
    stage: 'live',
    title: 'Form builder',
    body: 'Mỗi định nghĩa có sẵn màn hình nhập liệu, dữ liệu được kiểm tra theo đúng phiên bản định nghĩa của bản ghi.',
  },
  {
    href: '/workflows',
    stage: 'live',
    title: 'Workflow designer',
    body: 'Kéo thả để vẽ quy trình, lưu nháp trong trình duyệt rồi publish thành phiên bản mới; quy trình đang chạy giữ nguyên phiên bản của nó.',
  },
  {
    href: '/tasks',
    stage: 'live',
    title: 'Task inbox',
    body: 'Chỉ hiện việc thuộc role của bạn; mở một việc để xem bản ghi, diễn biến và quyết định duyệt / trả về / từ chối.',
  },
  {
    href: '/analytics',
    stage: 'live',
    title: 'Analytics',
    body: 'Tự định nghĩa metric trên field của bản ghi (đếm, tổng, trung bình, lọc, nhóm) cùng số liệu vận hành của quy trình — con số chỉ tính trên dữ liệu bạn được đọc.',
  },
  {
    href: '/apps',
    stage: 'live',
    title: 'Application showcase',
    body: 'Cùng một dữ liệu dưới nhiều dạng xem: danh sách và chi tiết đọc dữ liệu thật; kanban và panel tích hợp chỉ là minh hoạ, tab cấu hình chưa hoạt động — mỗi dạng xem gắn nhãn riêng.',
  },
  {
    href: '/settings',
    stage: 'live',
    title: 'Cài đặt',
    body: 'Thông tin cho người vận hành: endpoint, cổng, và nhật ký gửi sự kiện ra hệ thống ngoài (kể cả các lần thử lại).',
  },
  {
    href: '/roadmap',
    stage: 'concept',
    title: 'Roadmap',
    body: 'Bốn phase, điều kiện nghiệm thu MVP V1 và những gì còn thiếu — kế hoạch, không phải tính năng đã có.',
  },
];

/**
 * What the product does not do yet. Kept next to the surfaces so the page never reads as
 * if the platform were finished; the roadmap page carries the detail and the phases.
 */
const NOT_YET: readonly { title: string; body: string }[] = [
  {
    title: 'OIDC / SSO',
    body: 'Đăng nhập hiện dùng tài khoản nội bộ. Kết nối với hệ thống đăng nhập của tổ chức (SSO) đang chờ chính hệ thống đó.',
  },
  {
    title: 'SLA và escalation',
    body: 'Hạn xử lý và tự động chuyển cấp cần một chính sách thời gian làm việc; chưa có, nên hệ thống không hiển thị hạn giả.',
  },
  {
    title: 'Integration Hub đầy đủ',
    body: 'Hiện gửi được sự kiện ra hệ thống khác kèm thử lại và nhật ký; chiều ngược lại (đọc dữ liệu từ hệ thống ngoài) thì chưa.',
  },
  {
    title: 'Kanban và connector thật',
    body: 'Kanban và panel tích hợp trong màn Ứng dụng chỉ là minh hoạ cho phần sẽ làm ở V2.',
  },
  {
    title: 'Tiện ích của trình soạn quy trình',
    body: 'Hoàn tác (undo/redo) và nhiều người cùng sửa một định nghĩa chưa có.',
  },
  {
    title: 'Song song và join',
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

export default async function OverviewPage() {
  const status = await loadPlatformStatus();

  return (
    <>
      <PageHeader
        eyebrow="01 / Tổng quan"
        title="OPVARYN — Business Operations Platform"
        lead="Một nền tảng xây dựng và điều phối hoạt động nội bộ, nơi tổ chức tự định nghĩa dữ liệu, quy trình, ứng dụng nghiệp vụ và báo cáo của mình. Bản MVP V1 đang chạy: ba quy trình pilot, phê duyệt thật, phân quyền theo role và bộ phận, báo cáo trên dữ liệu thật, và triển khai trong hạ tầng của tổ chức."
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
            <dd className="mt-1 font-mono text-sm">
              {status.meta ? stageLabel(status.meta.stage) : '—'}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <DependencyChip label="Máy chủ API" up={status.api} />
          <DependencyChip label="Cơ sở dữ liệu" up={status.database} />
        </div>

        {status.message ? (
          <div className="mt-5 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
            <p className="font-medium text-warning">API chưa sẵn sàng</p>
            <p className="mt-1 text-on-surface-muted">{status.message}</p>
            <p className="mt-2 text-sm text-on-surface-muted">
              Nếu tình trạng này kéo dài, báo cho người quản trị hệ thống.
            </p>
          </div>
        ) : null}
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Quy trình pilot"
          value="3"
          note="Duyệt mua hàng, xử lý sự cố IT và onboarding nhân sự."
        />
        <KpiCard
          label="Điều kiện nghiệm thu MVP V1"
          value="1–7"
          note="Chi tiết ở trang Lộ trình."
        />
        <KpiCard
          label="Triển khai"
          value="1 host"
          note="Một host nội bộ, có TLS, sao lưu định kỳ và đã diễn tập phục hồi."
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
