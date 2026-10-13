import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { DEMO_WORKFLOWS } from '@/components/workflows/demo-definitions';
import { WorkflowCanvas } from '@/components/workflows/workflow-canvas';

export const metadata = { title: 'Workflows' };

const NODE_CATALOG: readonly { node: string; behavior: string; phase: string }[] = [
  { node: 'Start / End', behavior: 'Tạo và kết thúc instance, lưu kết quả terminal', phase: 'MVP' },
  { node: 'Human Task', behavior: 'Giao việc, duyệt hoặc trả về người thực hiện', phase: 'MVP' },
  {
    node: 'Condition / Branch',
    behavior: 'Rẽ nhánh bằng biểu thức trên context hợp lệ',
    phase: 'MVP',
  },
  {
    node: 'Notification',
    behavior: 'Tạo thông báo, không đổi kết quả approval',
    phase: 'MVP tối giản',
  },
  {
    node: 'Service Action',
    behavior: 'Gọi API, cập nhật dữ liệu ngoài có retry',
    phase: 'MVP giới hạn',
  },
  {
    node: 'Parallel / Join',
    behavior: 'Nhiều tác vụ đồng thời, chính sách ALL/ANY/QUORUM',
    phase: 'V1.x',
  },
  { node: 'Subprocess', behavior: 'Khởi tạo và liên kết quy trình con', phase: 'V1.x / V2' },
  { node: 'Timer / Escalation', behavior: 'Timeout, SLA, chuyển cấp hoặc giao lại', phase: 'V1.x' },
];

export default function WorkflowsPage() {
  return (
    <>
      <PageHeader
        eyebrow="04 / Workflow designer"
        title="Workflows"
        lead="Visual editor dạng directed graph để định nghĩa node, đường chuyển và quy tắc định tuyến theo role, phòng ban, ngưỡng giá trị hoặc dữ liệu. Sơ đồ dưới đây minh họa hai definition mẫu từ playbook."
        aside={<StatusBadge kind="mock" />}
      />

      <Card className="mb-6 border-warning/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-warning">Mô phỏng — chưa có workflow runtime</CardTitle>
            <CardDescription>
              Node, nhánh và version đều là dữ liệu mẫu đọc từ fixture, không có state machine chạy
              thật và không ghi vào database. Runtime chỉ được viết sau khi chốt Process Execution
              Contract (quyết định D05/D08 trong{' '}
              <code className="font-mono text-xs">operations-playbook/decisions.html</code>), vì
              lifecycle, concurrency và reject/return chưa có quy ước.
            </CardDescription>
          </div>
          <StatusBadge kind="mock" />
        </div>
      </Card>

      <div className="mb-8">
        <WorkflowCanvas definitions={DEMO_WORKFLOWS} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Node catalog theo lộ trình</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Node
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Hành vi
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Giai đoạn
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-raised/40">
              {NODE_CATALOG.map((row) => (
                <tr key={row.node}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{row.node}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{row.behavior}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-on-surface-muted">
                      {row.phase}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Definition ≠ Instance</CardTitle>
          <CardDescription>
            Một instance khi chạy gắn chặt với version definition đã publish tại thời điểm khởi tạo.
            Sửa definition tạo version mới; instance đang xử lý không tự đổi hành vi.
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Ba bất biến sẽ phải giữ khi làm runtime</CardTitle>
          <CardDescription>
            Version đã publish là bất biến; một transition có hiệu lực đúng một lần (idempotency và
            concurrency xử lý ở server); lỗi tích hợp không đảo ngược quyết định đã commit.
          </CardDescription>
        </Card>
      </section>
    </>
  );
}
