import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TaskInbox } from '@/components/tasks/task-inbox';

export const metadata = { title: 'Tasks' };

const RUNTIME_GAPS: readonly { title: string; body: string }[] = [
  {
    title: 'Đã có trong engine',
    body: 'Resolver theo role (D08b), transition atomic bằng compare-and-swap, audit append-only kèm actor và lý do, từ chối terminal và trả về reset theo D08a.',
  },
  {
    title: 'Còn thiếu: identity',
    body: 'Engine tin actorRole do caller khai báo. Cần D09 (SSO hay local auth, phạm vi RBAC) trước khi inbox trở thành bề mặt thật.',
  },
  {
    title: 'Còn thiếu: đọc inbox',
    body: 'API hiện trả task theo instance. Endpoint "task mở của tôi theo role" và giao diện tương ứng là bước nối tiếp theo sau D09.',
  },
  {
    title: 'Chưa có: SLA và escalation',
    body: 'Timer và escalation thuộc V1.x; chưa có bảng hay cột nào cho chúng (ADR 0007 mục 12).',
  },
];

export default function TasksPage() {
  return (
    <>
      <PageHeader
        eyebrow="05 / Task inbox"
        title="Tasks"
        lead="Một nơi để nhận việc, duyệt, từ chối, yêu cầu chỉnh sửa và luôn biết ai đang giữ việc — kèm timeline sự kiện của từng instance. Dữ liệu dưới đây là mô phỏng trong phiên làm việc."
        aside={<StatusBadge kind="mock" />}
      />

      <Card className="mb-6 border-warning/40">
        <CardTitle className="text-warning">
          Màn hình còn dùng fixture — engine đã chạy thật ở API
        </CardTitle>
        <CardDescription>
          Duyệt, trả về và từ chối ở đây chỉ thay đổi state trong trình duyệt để minh hoạ trải
          nghiệm; tải lại trang là mất. Ở phía API thì engine đã thật: một quyết định là một
          transaction có compare-and-swap (người thứ hai nhận 409), từ chối là terminal, trả về tạo
          attempt mới, và mọi bước nằm trong event log. Nối inbox này vào engine cần identity (D09)
          để biết “bạn” là ai — đó là lý do màn hình còn ở dạng mô phỏng.
        </CardDescription>
      </Card>

      <TaskInbox />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Engine đã có gì, inbox còn thiếu gì
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {RUNTIME_GAPS.map((item) => (
            <Card key={item.title}>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-on-surface-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
