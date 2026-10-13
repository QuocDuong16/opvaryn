import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TaskInbox } from '@/components/tasks/task-inbox';

export const metadata = { title: 'Tasks' };

const MVP_REQUIREMENTS: readonly { title: string; body: string }[] = [
  {
    title: 'Resolver người duyệt',
    body: 'Ai nhận việc phải được xác định và đóng băng tại thời điểm tạo task — không tính lại theo org chart mỗi lần mở inbox.',
  },
  {
    title: 'Transition atomic',
    body: 'Duyệt hai lần trên hai tab chỉ được tạo một kết quả. Cần compare-and-swap hoặc khoá ở server, không xử lý ở UI.',
  },
  {
    title: 'Audit đầy đủ',
    body: 'Actor, thời điểm, trạng thái cũ/mới, lý do từ chối và correlation ID của lần chạy phải lưu cùng transition.',
  },
  {
    title: 'Kết quả terminal rõ ràng',
    body: 'Rejected là terminal hay đưa về người lập; return có reset các bước đã duyệt hay không — chính là D08.',
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
        <CardTitle className="text-warning">Mô phỏng — không có state machine thật</CardTitle>
        <CardDescription>
          Duyệt, trả về và từ chối ở đây chỉ thay đổi state trong trình duyệt để minh hoạ trải
          nghiệm; tải lại trang là mất. Runtime thật cần Process Execution Contract (D05/D08) trước,
          vì thứ tự và tính duy nhất của transition phải được enforce ở server.
        </CardDescription>
      </Card>

      <TaskInbox />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Điều kiện để inbox này trở thành thật
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {MVP_REQUIREMENTS.map((item) => (
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
