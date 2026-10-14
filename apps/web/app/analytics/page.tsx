import Link from 'next/link';
import {
  ApiError,
  type BusinessObject,
  type MetricDefinition,
  type MetricResult,
} from '@opvaryn/contracts';

import { CreateMetricForm } from '@/components/analytics/create-metric-form';
import { DashboardStudio } from '@/components/analytics/dashboard-studio';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { getDashboardWidgets } from '@/lib/dashboard';

export const metadata = { title: 'Analytics' };

const PLANNED_METRICS: readonly { metric: string; definition: string; note: string }[] = [
  {
    metric: 'Cycle Time',
    definition: 'Thời gian từ submit đến hoàn thành / kết thúc',
    note: 'Cần read model trên event log của instance; metric hiện tại chỉ đo field của bản ghi',
  },
  {
    metric: 'Step Processing Time',
    definition: 'Thời gian từ khi task được giao đến khi kết thúc',
    note: 'Cần tách waiting time và active time từ process_tasks',
  },
  {
    metric: 'Approval / Rejection Rate',
    definition: 'Instance approved hoặc rejected cuối / tổng instance có kết quả',
    note: 'Cần đếm theo trạng thái instance, không chỉ theo bản ghi',
  },
  {
    metric: 'SLA Breach Rate',
    definition: 'Task quá SLA / số task có SLA hợp lệ',
    note: 'Chờ chính sách thời gian làm việc; SLA chưa có trong engine (ADR 0007 mục 12)',
  },
  {
    metric: 'Rework Rate',
    definition: 'Instance có ít nhất một vòng return / instance hợp lệ',
    note: 'Đếm instance khác với đếm số vòng trả về — cần event, không chỉ bản ghi',
  },
];

export default async function AnalyticsPage() {
  const api = createServerApiClient();

  let metrics: MetricDefinition[] = [];
  let objects: BusinessObject[] = [];
  let error: string | null = null;
  let needsSignIn = false;

  try {
    [metrics, objects] = await Promise.all([api.listMetrics(), api.listBusinessObjects()]);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      needsSignIn = true;
    } else {
      error = describeApiError(cause);
    }
  }

  // Every metric is answered for the signed-in user, so the numbers on screen are the
  // numbers that person may see (ADR 0008) — the dashboard does not widen anything.
  const results: Record<string, MetricResult> = {};
  const answered = await Promise.all(
    metrics.map(async (metric) => {
      try {
        return await api.getMetricResult(metric.key);
      } catch {
        return null;
      }
    }),
  );
  for (const result of answered) {
    if (result) {
      results[result.metric.key] = result;
    }
  }

  const widgets = await getDashboardWidgets(metrics.map((metric) => metric.key));

  return (
    <>
      <PageHeader
        eyebrow="06 / Analytics studio"
        title="Analytics"
        lead="Dashboard tự cấu hình trên metric thật: metric định nghĩa bằng field của business object (đếm, tổng, trung bình, lọc và nhóm), chạy trên projection có kiểu và trả về đúng phạm vi dữ liệu bạn được đọc. Số liệu và bố cục đều thật."
        aside={<StatusBadge kind={error || needsSignIn ? 'mock' : 'live'} />}
      />

      {needsSignIn ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Cần đăng nhập để xem số liệu</CardTitle>
          <CardDescription>
            Metric chạy theo phạm vi của người đang đăng nhập, nên API cần session.
          </CardDescription>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Đăng nhập
          </Link>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được metric</CardTitle>
          <CardDescription>{error}</CardDescription>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-on-surface-muted">
            make docker-up{'\n'}cd apps/api &amp;&amp; go run ./cmd/migrate{'\n'}make seed-demo
            {'\n'}
            make dev
          </pre>
        </Card>
      ) : null}

      {!needsSignIn && !error ? (
        <>
          <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                {`Dashboard (${metrics.length} metric)`}
              </h2>
              <StatusBadge kind="live" />
            </div>
            <DashboardStudio metrics={metrics} results={results} initialWidgets={widgets} />
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Tạo metric</h2>
            <Card>
              <CardDescription>
                Metric là cấu hình: tạo và sửa cần role{' '}
                <code className="font-mono text-xs">process_designer</code> hoặc{' '}
                <code className="font-mono text-xs">admin</code>. Field lấy từ chính định nghĩa
                business object, bộ lọc dùng đúng ngôn ngữ điều kiện của nhánh quy trình (D04), và
                service là nơi từ chối những gì không hợp lệ — không có đường nào để viết SQL.
              </CardDescription>
              <div className="mt-5">
                <CreateMetricForm objects={objects} />
              </div>
            </Card>
          </section>

          <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {`Metric đã định nghĩa (${metrics.length})`}
              </h2>
              <StatusBadge kind="live" />
            </div>
            {metrics.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center">
                <p className="text-sm font-medium">Chưa có metric nào</p>
                <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-muted">
                  Tạo metric đầu tiên ở biểu mẫu phía trên, hoặc nạp bộ dữ liệu mẫu bằng{' '}
                  <code className="font-mono text-xs">make seed-demo</code> để có metric mẫu trên dữ
                  liệu thật.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Metric
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Cách tính
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Lọc / nhóm
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Hiện tại
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-surface-raised/40">
                    {metrics.map((metric) => {
                      const result = results[metric.key];
                      return (
                        <tr key={metric.key}>
                          <td className="px-4 py-3 align-top">
                            <span className="font-medium">{metric.name}</span>
                            <span className="mt-0.5 block font-mono text-[11px] text-on-surface-muted">
                              {`${metric.key} · ${metric.objectKey}`}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top font-mono text-xs">
                            {`${metric.aggregation}${metric.measure ? `(${metric.measure.key})` : ''}`}
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-on-surface-muted">
                            {metric.filter
                              ? `${metric.filter.field} ${metric.filter.op} ${String(metric.filter.value)}`
                              : 'không lọc'}
                            {metric.groupBy ? ` · nhóm theo ${metric.groupBy.key}` : ''}
                          </td>
                          <td className="px-4 py-3 align-top text-xs">
                            {result ? (
                              <>
                                <span className="font-semibold">{result.total}</span>
                                <span className="text-on-surface-muted">
                                  {` trên ${result.records} bản ghi`}
                                </span>
                              </>
                            ) : (
                              <span className="text-warning">không đọc được kết quả</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Metric vận hành quy trình — chưa làm
          </h2>
          <StatusBadge kind="concept" />
        </div>
        <p className="mb-3 max-w-3xl text-sm text-on-surface-muted">
          Các metric dưới đây đo <em>thời gian và trạng thái của quy trình</em>, không phải field
          của bản ghi: chúng cần một read model trên event log và task (ADR 0007), nên nằm ngoài
          phạm vi query builder hiện tại (D06). Danh sách này là định nghĩa làm việc từ playbook.
        </p>
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
              {PLANNED_METRICS.map((row) => (
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
