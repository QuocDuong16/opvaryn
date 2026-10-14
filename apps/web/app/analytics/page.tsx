import Link from 'next/link';
import {
  ApiError,
  type BusinessObject,
  type MetricDefinition,
  type MetricResult,
  type ProcessDefinition,
  type ProcessMetricsOverview,
} from '@opvaryn/contracts';

import { CreateMetricForm } from '@/components/analytics/create-metric-form';
import { DashboardStudio } from '@/components/analytics/dashboard-studio';
import {
  durationLabel,
  finishedCount,
  formatRate,
  reworkedLabel,
} from '@/components/analytics/process-metrics';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { getDashboardWidgets } from '@/lib/dashboard';

export const metadata = { title: 'Analytics' };

const WINDOW_CHOICES = [7, 30, 90, 365] as const;

interface PageProps {
  searchParams: Promise<{ definition?: string; window?: string }>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { definition, window: windowParam } = await searchParams;
  const api = createServerApiClient();

  let metrics: MetricDefinition[] = [];
  let objects: BusinessObject[] = [];
  let definitions: ProcessDefinition[] = [];
  let error: string | null = null;
  let needsSignIn = false;

  try {
    [metrics, objects, definitions] = await Promise.all([
      api.listMetrics(),
      api.listBusinessObjects(),
      api.listProcessDefinitions(),
    ]);
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

  // The operational overview is a second, fixed catalogue (ADR 0011). It is answered with
  // the same session, so its numbers are scoped to what this person may see — and it may
  // fail on its own: a broken overview must not blank the dashboard.
  const windowDays = Number.parseInt(windowParam ?? '', 10);
  let overview: ProcessMetricsOverview | null = null;
  let overviewError: string | null = null;
  try {
    overview = await api.getProcessMetrics({
      ...(definition ? { definitionKey: definition } : {}),
      ...(Number.isFinite(windowDays) ? { windowDays } : {}),
    });
  } catch (cause) {
    overviewError = describeApiError(cause);
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

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Vận hành quy trình</h2>
          <StatusBadge kind="live" />
        </div>

        {overviewError ? (
          <Card className="border-warning/40">
            <CardTitle className="text-warning">Không đọc được số liệu vận hành</CardTitle>
            <CardDescription>{overviewError}</CardDescription>
          </Card>
        ) : null}

        {overview ? (
          <>
            <p className="mb-3 max-w-3xl text-sm text-on-surface-muted">
              {`Engine trong ${overview.windowDays} ngày gần nhất, tính trên process_instances và process_tasks — không phải field của bản ghi, nên đây là bộ metric cố định (ADR 0011). Mọi con số theo phạm vi bạn được đọc: người khác có thể thấy số khác, và đó là thiết kế.`}
            </p>

            <form
              method="get"
              className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3"
            >
              <label className="text-xs">
                <span className="font-medium tracking-wide uppercase">Quy trình</span>
                <select
                  name="definition"
                  defaultValue={overview.definitionKey}
                  className="mt-1.5 block rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent-strong focus:outline-none"
                >
                  <option value="">Tất cả quy trình</option>
                  {definitions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="font-medium tracking-wide uppercase">Cửa sổ</span>
                <select
                  name="window"
                  defaultValue={String(overview.windowDays)}
                  className="mt-1.5 block rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent-strong focus:outline-none"
                >
                  {WINDOW_CHOICES.map((days) => (
                    <option key={days} value={days}>
                      {`${days} ngày`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-overlay"
              >
                Xem
              </button>
            </form>

            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Instance đã chạy', value: String(overview.instances.started) },
                { label: 'Hoàn tất', value: String(overview.instances.completed) },
                { label: 'Bị từ chối', value: String(overview.instances.rejected) },
                { label: 'Đang chạy', value: String(overview.instances.running) },
              ].map((item) => (
                <Card key={item.label}>
                  <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                    {item.label}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight">{item.value}</dd>
                </Card>
              ))}
            </dl>

            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                  Cycle time
                </dt>
                <dd className="mt-1 text-sm">{durationLabel(overview.cycleTime)}</dd>
                <p className="mt-1 text-xs text-on-surface-muted">
                  {`từ lúc start tới lúc kết thúc · ${finishedCount(overview)} instance đã kết thúc`}
                </p>
              </Card>
              <Card>
                <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                  Thời gian một bước
                </dt>
                <dd className="mt-1 text-sm">{durationLabel(overview.stepTime)}</dd>
                <p className="mt-1 text-xs text-on-surface-muted">
                  từ lúc giao việc tới lúc có quyết định
                </p>
              </Card>
              <Card>
                <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                  Tỉ lệ duyệt
                </dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight">
                  {formatRate(overview.approvalRate)}
                </dd>
                <p className="mt-1 text-xs text-on-surface-muted">
                  hoàn tất / (hoàn tất + bị từ chối)
                </p>
              </Card>
              <Card>
                <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                  Tỉ lệ phải chạy lại
                </dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight">
                  {formatRate(overview.reworkRate)}
                </dd>
                <p className="mt-1 text-xs text-on-surface-muted">{reworkedLabel(overview)}</p>
              </Card>
            </dl>

            <Card className="mt-4 border-warning/40">
              <CardTitle className="text-warning">SLA chưa có</CardTitle>
              <CardDescription>
                Tỉ lệ vi phạm SLA cần một chính sách thời gian làm việc (giờ hành chính, ngày nghỉ)
                mà engine chưa có — timer và escalation thuộc V1.x (ADR 0007 mục 12). Vì vậy bảng
                này không hiển thị hạn giả: chỉ những gì đo được mới xuất hiện.
              </CardDescription>
            </Card>
          </>
        ) : null}
      </section>
    </>
  );
}
