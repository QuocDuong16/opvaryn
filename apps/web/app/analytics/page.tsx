import { DashboardStudio } from '@/components/analytics/dashboard-studio';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getDashboardWidgets } from '@/lib/dashboard';

export const metadata = { title: 'Analytics' };

const METRIC_DEFINITIONS: readonly { metric: string; definition: string; note: string }[] = [
  {
    metric: 'Cycle Time',
    definition: 'Thời gian từ submit đến hoàn thành / kết thúc',
    note: 'Chọn rõ terminal status nào được tính',
  },
  {
    metric: 'Step Processing Time',
    definition: 'Thời gian từ khi task được giao đến khi kết thúc',
    note: 'Tách waiting time và active time nếu đo được',
  },
  {
    metric: 'Approval Rate',
    definition: 'Instance approved / tổng instance đã có kết quả cuối',
    note: 'Định nghĩa mẫu số, loại trừ đang xử lý',
  },
  {
    metric: 'Rejection Rate',
    definition: 'Instance rejected cuối / tổng instance đã có kết quả',
    note: 'Không gộp returned và rejected',
  },
  {
    metric: 'SLA Breach Rate',
    definition: 'Task quá SLA / số task có SLA hợp lệ',
    note: 'Cần chính sách thời gian làm việc và ngày nghỉ',
  },
  {
    metric: 'Rework Rate',
    definition: 'Instance có ít nhất một vòng return / instance hợp lệ',
    note: 'Đếm instance khác với đếm số vòng trả về',
  },
];

export default async function AnalyticsPage() {
  // The layout is real user configuration stored in a cookie; only the metric
  // values are fixtures. The two are labeled separately in the studio.
  const widgets = await getDashboardWidgets();

  return (
    <>
      <PageHeader
        eyebrow="06 / Analytics studio"
        title="Analytics"
        lead="Self-service dashboard với metric có cấu trúc: chọn metric, dimension và chart, sắp bố cục widget rồi lưu lại — không viết SQL, không vượt quyền dữ liệu. Bố cục được lưu thật; số liệu là fixture."
        aside={<StatusBadge kind="mock" />}
      />

      <Card className="mb-6 border-warning/40">
        <CardTitle className="text-warning">Số liệu mô phỏng — bố cục dashboard thì thật</CardTitle>
        <CardDescription>
          Metric cần read model có kiểu, dựng từ event của process instance — thứ chưa tồn tại khi
          runtime chưa được viết (D05/D08), nên mọi con số ở đây là fixture. Phần bố cục thì đã hoạt
          động: kéo thả, đổi độ rộng, thêm/xoá widget và lưu bằng cookie của trình duyệt này.
        </CardDescription>
      </Card>

      <DashboardStudio initialWidgets={widgets} />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Định nghĩa metric làm việc (từ playbook)
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Metric
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Định nghĩa làm việc
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Lưu ý
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-raised/40">
              {METRIC_DEFINITIONS.map((row) => (
                <tr key={row.metric}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{row.metric}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{row.definition}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
