import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

export const metadata = { title: 'Roadmap' };

const PHASES: readonly {
  tag: string;
  name: string;
  title: string;
  scope: string;
  goal: string;
  tone: 'accent' | 'blue' | 'purple' | 'amber';
}[] = [
  {
    tag: 'MVP V1 · Core product',
    name: 'MVP V1',
    title: 'Nền tảng vận hành tối thiểu',
    scope:
      'Business Objects, Forms, Human Workflow, Task Inbox, RBAC/Audit, Analytics cơ bản, API Integration giới hạn.',
    goal: 'Mục tiêu: giao được 2–3 quy trình thật.',
    tone: 'accent',
  },
  {
    tag: 'V1.x · Operations Expansion',
    name: 'V1.x',
    title: 'Nhiều hành vi quy trình hơn',
    scope:
      'Parallel approval, delegation, escalation, SLA, webhooks/schedules, document generation, calculated metrics và reporting nâng cao.',
    goal: 'Mục tiêu: mở rộng năng lực engine, không chồng thêm hệ thống.',
    tone: 'blue',
  },
  {
    tag: 'V2 · Application Platform',
    name: 'V2',
    title: 'Application Builder',
    scope:
      'Dynamic List/Detail/Form/Kanban, quan hệ dữ liệu, actions theo role và trạng thái, dashboard nhúng, cross-process automation, template library.',
    goal: 'Mục tiêu: tự dựng mini-app theo nghiệp vụ.',
    tone: 'purple',
  },
  {
    tag: 'V3 · Intelligent Operations',
    name: 'V3',
    title: 'Process Intelligence & AI',
    scope:
      'AI hỗ trợ dựng form/quy trình, anomaly detection, process mining, gợi ý tối ưu và cấu hình bằng ngôn ngữ tự nhiên.',
    goal: 'Mục tiêu: phân tích và tối ưu quy trình có dữ liệu thực.',
    tone: 'amber',
  },
];

const MVP_ACCEPTANCE: readonly string[] = [
  'Admin tạo Business Object, form và workflow mới mà không sửa code.',
  'Nhân viên tạo bản ghi, submit, theo dõi trạng thái và nhận phản hồi.',
  'Có approval, conditional branch, reject / return / resubmit.',
  'Quyền thực thi và quyền đọc dữ liệu được kiểm tra server-side, có audit.',
  'Có ít nhất một tích hợp API thực vận hành và xử lý lỗi rõ ràng.',
  'Người quản lý tự cấu hình dashboard cơ bản với metric được cấp quyền.',
  'Restart và retry không mất workflow state hoặc tạo side effect trùng.',
];

const OUT_OF_MVP: readonly { title: string; body: string }[] = [
  {
    title: 'Full Application Builder',
    body: 'Chỉ làm vertical slice trên demo, V2 mới xây runtime tổng quát.',
  },
  {
    title: 'Workflow tự do vô hạn',
    body: 'Không hỗ trợ mọi BPMN pattern trong V1, ưu tiên các node thật sự cần.',
  },
  {
    title: 'Enterprise analytics tự do',
    body: 'Metric catalog giới hạn, không mở raw SQL cho end-user.',
  },
  {
    title: 'AI / Auto Optimization',
    body: 'Chưa đủ tín hiệu và dữ liệu đáng tin để tối ưu bằng AI.',
  },
  {
    title: 'Multi-tenant SaaS',
    body: 'Đầu tiên dành cho một tổ chức nội bộ.',
  },
  {
    title: 'Connector marketplace',
    body: 'Một vài adapter tốt hơn hàng chục connector chưa kiểm thử.',
  },
];

const OPEN_DECISIONS: readonly { id: string; topic: string; blocked: string }[] = [
  {
    id: 'D06',
    topic: 'Analytics — embedded BI hay query builder giới hạn tự viết',
    blocked: 'Dashboard có số liệu thật',
  },
  {
    id: 'D10',
    topic: 'Deployment & backup — hạ tầng, monitoring, khôi phục, staging',
    blocked: 'Chạy ngoài môi trường local',
  },
];

/**
 * DECIDED mirrors the ADRs that closed a playbook decision, so the page does not
 * keep listing a settled question as a blocker.
 */
const DECIDED: readonly { id: string; topic: string; adr: string }[] = [
  { id: 'D04', topic: 'Rule DSL: condition JSON có allowlist', adr: 'ADR 0007' },
  { id: 'D05', topic: 'Workflow runtime tự xây trên PostgreSQL', adr: 'ADR 0005' },
  { id: 'D07', topic: 'Ba quy trình pilot (mua hàng, sự cố IT, onboarding)', adr: 'ADR 0008' },
  {
    id: 'D08',
    topic: 'Approval semantics: reject terminal, return reset, resolver theo role',
    adr: 'ADR 0005',
  },
  { id: 'D09', topic: 'Local auth + RBAC theo role và bộ phận', adr: 'ADR 0008' },
];

const PLANS: readonly { resource: string; demo: string; mvp: string }[] = [
  { resource: '1 dev full-time + AI', demo: '6–10 tuần', mvp: '20–30 tuần' },
  { resource: '2 dev full-time + AI', demo: '4–7 tuần', mvp: '14–22 tuần' },
  { resource: '3 dev chuyên môn hóa', demo: '4–6 tuần', mvp: '12–18 tuần' },
  { resource: '1 dev part-time 15–20h/tuần', demo: '12–24 tuần', mvp: '40–70 tuần' },
];

export default function RoadmapPage() {
  return (
    <>
      <PageHeader
        eyebrow="08 / Roadmap"
        title="Roadmap"
        lead="Lộ trình từ bản demo này tới nền tảng vận hành thật, lấy nguyên từ operations playbook. Các phase dưới đây là kế hoạch, không phải tính năng đã có; ngày tháng là ước lượng, không phải deadline đã cam kết."
        aside={<StatusBadge kind="concept" />}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Bản demo đang ở đâu</CardTitle>
            <CardDescription>
              Mốc 1 của lộ trình — kế hoạch 8 tuần — đã dựng xong trong repo này, và phần MVP V1
              đang được triển khai tiếp trên cùng nền đó.
            </CardDescription>
          </div>
          <StatusBadge kind="live" />
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
              Đã chạy thật (live)
            </dt>
            <dd className="mt-1 text-sm">
              Business object và bản ghi: schema, form sinh từ schema, validate ở server, lưu
              PostgreSQL. Đăng nhập và phân quyền theo role + bộ phận. Inbox theo người, duyệt / trả
              về / từ chối qua engine có event log. Bố cục dashboard lưu trong cookie.
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
              Mô phỏng (mock)
            </dt>
            <dd className="mt-1 text-sm">
              Trình thiết kế workflow trong web (định nghĩa hiện publish qua API), số liệu
              analytics, kanban và connector — giao diện thật, dữ liệu fixture.
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Chưa có</dt>
            <dd className="mt-1 text-sm">
              Trình thiết kế quy trình trong web, OIDC, read model analytics, tích hợp thật, SLA và
              escalation, deployment — phần còn lại của MVP V1 và V1.x.
            </dd>
          </div>
        </dl>
      </Card>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Bốn phase</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PHASES.map((phase) => (
            <Card key={phase.name}>
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-xs tracking-wide text-accent-strong uppercase">
                  {phase.tag}
                </span>
                <StatusBadge kind="concept" />
              </div>
              <h3 className="mt-3 text-base font-semibold tracking-tight">{phase.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-muted">{phase.scope}</p>
              <p className="mt-3 text-sm font-medium">{phase.goal}</p>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-on-surface-muted">
          MVP V1 ≈ OPVARYN Core, V2 ≈ OPVARYN Studio trong cấu trúc thương hiệu. V1.x / V2 / V3 là
          định hướng, không có cam kết ngày phát hành; ưu tiên phải được xem lại sau pilot.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Điều kiện nghiệm thu MVP V1</h2>
        <Card>
          <CardDescription>
            Danh sách tiêu chí từ playbook để một bản phát hành được coi là dùng được — khác với
            tiêu chuẩn của bản demo. Hiện đã đáp ứng mục 3 (approval, nhánh điều kiện, reject /
            return) và mục 4 (kiểm tra quyền ở server, có audit); mục 1–2 đúng nhưng thao tác qua
            API chứ chưa có trình thiết kế trong web; mục 5–7 còn thiếu.
          </CardDescription>
          <ol className="mt-4 space-y-2.5">
            {MVP_ACCEPTANCE.map((item, index) => (
              <li key={item} className="flex gap-3 text-sm">
                <span className="w-5 shrink-0 font-mono text-xs text-on-surface-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Chủ động để ngoài MVP</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {OUT_OF_MVP.map((item) => (
            <Card key={item.title}>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-on-surface-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Quyết định đang mở chặn tiến độ
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Mã
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Nội dung cần chốt
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Đang chặn
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-raised/40">
              {OPEN_DECISIONS.map((decision) => (
                <tr key={decision.id}>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{decision.id}</td>
                  <td className="px-4 py-3">{decision.topic}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{decision.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-on-surface-muted">
          Chi tiết và trạng thái từng quyết định nằm ở{' '}
          <code className="font-mono">operations-playbook/decisions.html</code>; repo này không tự
          chọn hướng thay cho bạn.
        </p>

        <h3 className="mt-6 mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
          Đã chốt và đang chạy
        </h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DECIDED.map((decision) => (
            <li
              key={decision.id}
              className="rounded-lg border border-border bg-surface-raised/40 px-3 py-2.5"
            >
              <p className="text-sm">
                <span className="mr-2 font-mono text-xs text-on-surface-muted">{decision.id}</span>
                {decision.topic}
              </p>
              <p className="mt-1 text-xs text-on-surface-muted">{decision.adr}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Ước lượng theo nguồn lực</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Nguồn lực
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Demo
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  MVP (từ đầu)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-raised/40">
              {PLANS.map((plan) => (
                <tr key={plan.resource}>
                  <td className="px-4 py-3">{plan.resource}</td>
                  <td className="px-4 py-3 font-mono text-xs">{plan.demo}</td>
                  <td className="px-4 py-3 font-mono text-xs">{plan.mvp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <span className="font-mono text-xs tracking-wide text-on-surface-muted uppercase">
              Khởi động 13/10/2026
            </span>
            <p className="mt-2 text-lg font-semibold tracking-tight">08/12/2026</p>
            <p className="mt-1 text-xs text-on-surface-muted">
              Mục tiêu demo 8 tuần, không phải deadline đã cam kết.
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <span className="font-mono text-xs tracking-wide text-on-surface-muted uppercase">
              Nếu phạm vi không đổi lớn
            </span>
            <p className="mt-2 text-lg font-semibold tracking-tight">30/03/2027</p>
            <p className="mt-1 text-xs text-on-surface-muted">
              Mục tiêu MVP 24 tuần; playbook khuyến nghị dự phòng đến 30 tuần.
            </p>
          </div>
        </div>
      </section>

      <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-xs leading-relaxed text-on-surface-muted">
        Nguồn: <code className="font-mono">operations-playbook/roadmap.html</code> (phase và
        non-goals), <code className="font-mono">demo-mvp.html</code> (điều kiện nghiệm thu, ước
        lượng) và <code className="font-mono">decisions.html</code> (quyết định mở). Khi playbook
        thay đổi, trang này cập nhật theo — playbook vẫn là nguồn yêu cầu.
      </p>
    </>
  );
}
