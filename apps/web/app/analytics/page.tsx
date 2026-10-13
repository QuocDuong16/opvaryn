import { ModulePlaceholder } from '@/components/ui/module-placeholder';

export const metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return (
    <ModulePlaceholder
      eyebrow="06 / Analytics studio"
      title="Analytics"
      stage="mock"
      lead="Self-service dashboard với metric có cấu trúc: người quản lý chọn metric, dimension, filter và chart rồi lưu bố cục — không cần viết SQL và không vượt quyền dữ liệu."
      features={[
        'Metric catalog giới hạn: cycle time, approval rate, SLA breach, rework…',
        'Widget KPI, line, bar, pie/donut và table',
        'Kéo thả, resize và lưu bố cục dashboard',
        'Query được scope theo quyền, không mở raw SQL cho end-user',
      ]}
      note="Metric cần read model có kiểu từ event và instance — việc này chỉ có ý nghĩa sau khi workflow runtime chạy thật. Dashboard trong demo dùng dữ liệu mô phỏng và phải gắn nhãn Mock."
    />
  );
}
