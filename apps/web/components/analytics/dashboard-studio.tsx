'use client';

import { useActionState, useState, type DragEvent } from 'react';
import { useFormStatus } from 'react-dom';

import { saveDashboardAction } from '@/app/analytics/actions';
import {
  addWidget,
  CHART_KIND_LABELS,
  DIMENSION_LABELS,
  defaultWidgets,
  MAX_WIDGETS,
  moveWidget,
  removeWidget,
  reorderWidget,
  resizeWidget,
  serializeWidgets,
  updateWidget,
  WIDGET_KIND_LABELS,
  type ChartKind,
  type DashboardWidget,
  type WidgetKind,
} from '@/components/analytics/dashboard-layout';
import { INITIAL_SAVE_DASHBOARD_STATE } from '@/components/analytics/dashboard-state';
import {
  deltaBetween,
  formatMetricValue,
  METRIC_CATALOG,
  seriesFor,
  type Dimension,
  type MetricDefinition,
  type MetricPoint,
} from '@/components/analytics/demo-metrics';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';

const CONTROL_BUTTON =
  'rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-overlay disabled:opacity-40 disabled:hover:bg-transparent';

const SELECT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm ' +
  'text-on-surface focus:border-accent-strong focus:outline-none';

const WIDGET_KINDS: readonly WidgetKind[] = ['kpi', 'chart', 'table'];

/**
 * DashboardStudio is the Analytics Studio: a grid of widgets the viewer arranges.
 *
 * Two different things are on this screen and they are labeled separately: the
 * numbers come from fixtures (`mock` — a real dashboard needs typed read models),
 * while the layout itself is real and saved in a browser cookie through a server
 * action (`live`).
 */
export function DashboardStudio({ initialWidgets }: { initialWidgets: DashboardWidget[] }) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(initialWidgets);
  const [newMetricId, setNewMetricId] = useState(METRIC_CATALOG[0]?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [saveState, saveAction] = useActionState(saveDashboardAction, INITIAL_SAVE_DASHBOARD_STATE);

  function handleAdd() {
    const result = addWidget(widgets, newMetricId, 'chart');
    if (!result.added) {
      setNotice(`Dashboard đã đủ ${MAX_WIDGETS} widget hoặc metric không hợp lệ.`);
      return;
    }
    setWidgets(result.widgets);
    setNotice(null);
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null);
      return;
    }
    setWidgets((current) => reorderWidget(current, draggedIndex, index));
    setDraggedIndex(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface-raised p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium tracking-wide text-on-surface-muted uppercase">
            Thêm widget
            <select
              value={newMetricId}
              onChange={(event) => setNewMetricId(event.target.value)}
              className={SELECT_CLASS}
            >
              {METRIC_CATALOG.map((metric) => (
                <option key={metric.id} value={metric.id}>
                  {metric.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={handleAdd} className={cn(CONTROL_BUTTON, 'px-3 py-2')}>
            + Thêm
          </button>
          <button
            type="button"
            onClick={() => {
              setWidgets(defaultWidgets());
              setNotice(null);
            }}
            className={cn(CONTROL_BUTTON, 'px-3 py-2')}
          >
            Bố cục mặc định
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-on-surface-muted">
            Số liệu <StatusBadge kind="mock" />
          </span>
          <span className="flex items-center gap-2 text-xs text-on-surface-muted">
            Bố cục lưu thật <StatusBadge kind="live" />
          </span>

          <form action={saveAction} className="flex items-center gap-2">
            <input type="hidden" name="layout" value={serializeWidgets(widgets)} />
            <SaveButton />
          </form>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning"
        >
          {notice}
        </p>
      ) : null}

      {saveState.status !== 'idle' && saveState.message ? (
        <p
          role={saveState.status === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            saveState.status === 'error'
              ? 'border-danger/40 text-danger'
              : 'border-success/40 text-success',
          )}
        >
          {saveState.message}
        </p>
      ) : null}

      <ul className="grid gap-4 lg:grid-cols-2">
        {widgets.map((widget, index) => {
          const metric = METRIC_CATALOG.find((item) => item.id === widget.metricId);
          if (!metric) {
            return null;
          }
          const series = seriesFor(metric, widget.dimension);

          return (
            <li
              key={widget.id}
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragEnd={() => setDraggedIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, index)}
              className={cn(
                'rounded-xl border border-border bg-surface-raised p-4',
                widget.span === 2 && 'lg:col-span-2',
                draggedIndex === index && 'opacity-60',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden
                    title="Kéo để đổi vị trí"
                    className="cursor-grab pt-0.5 text-on-surface-muted select-none"
                  >
                    ⠿
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{metric.label}</p>
                    <p className="text-[11px] text-on-surface-muted">
                      {WIDGET_KIND_LABELS[widget.kind]} · {DIMENSION_LABELS[widget.dimension]}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setWidgets(moveWidget(widgets, widget.id, -1))}
                    disabled={index === 0}
                    aria-label={`Chuyển ${metric.label} lên trước`}
                    className={CONTROL_BUTTON}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => setWidgets(moveWidget(widgets, widget.id, 1))}
                    disabled={index === widgets.length - 1}
                    aria-label={`Chuyển ${metric.label} xuống sau`}
                    className={CONTROL_BUTTON}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setWidgets(resizeWidget(widgets, widget.id))}
                    aria-label={`Đổi độ rộng ${metric.label}`}
                    className={CONTROL_BUTTON}
                  >
                    {widget.span === 2 ? '1 cột' : '2 cột'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWidgets(removeWidget(widgets, widget.id))}
                    disabled={widgets.length === 1}
                    title={widgets.length === 1 ? 'Dashboard cần ít nhất một widget' : undefined}
                    aria-label={`Xoá ${metric.label}`}
                    className={cn(CONTROL_BUTTON, 'text-danger')}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                  Hiển thị
                  <select
                    value={widget.kind}
                    onChange={(event) =>
                      setWidgets(
                        updateWidget(widgets, widget.id, {
                          kind: event.target.value as WidgetKind,
                        }),
                      )
                    }
                    className={SELECT_CLASS}
                  >
                    {WIDGET_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {WIDGET_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                  Metric
                  <select
                    value={widget.metricId}
                    onChange={(event) =>
                      setWidgets(updateWidget(widgets, widget.id, { metricId: event.target.value }))
                    }
                    className={SELECT_CLASS}
                  >
                    {METRIC_CATALOG.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                  Dimension
                  <select
                    value={widget.dimension}
                    onChange={(event) =>
                      setWidgets(
                        updateWidget(widgets, widget.id, {
                          dimension: event.target.value as Dimension,
                        }),
                      )
                    }
                    className={SELECT_CLASS}
                  >
                    {(Object.keys(DIMENSION_LABELS) as Dimension[]).map((value) => (
                      <option key={value} value={value}>
                        {DIMENSION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>

                {widget.kind === 'chart' ? (
                  <label className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                    Chart
                    <select
                      value={widget.chartKind}
                      onChange={(event) =>
                        setWidgets(
                          updateWidget(widgets, widget.id, {
                            chartKind: event.target.value as ChartKind,
                          }),
                        )
                      }
                      className={SELECT_CLASS}
                    >
                      {(Object.keys(CHART_KIND_LABELS) as ChartKind[]).map((value) => (
                        <option key={value} value={value}>
                          {CHART_KIND_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="mt-4">
                {widget.kind === 'kpi' ? (
                  <KpiBody metric={metric} dimension={widget.dimension} />
                ) : widget.kind === 'chart' ? (
                  <MetricChart metric={metric} series={series} kind={widget.chartKind} />
                ) : (
                  <SeriesTable metric={metric} series={series} />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-relaxed text-on-surface-muted">
        Kéo thả widget để đổi thứ tự, dùng ↑ ↓ cho bàn phím, đổi độ rộng bằng nút 1 cột / 2 cột. Bố
        cục được lưu bằng cookie của trình duyệt này; khi có identity (D09) nó sẽ chuyển sang lưu
        theo người dùng trong database.
      </p>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : 'Lưu bố cục'}
    </button>
  );
}

function KpiBody({ metric, dimension }: { metric: MetricDefinition; dimension: Dimension }) {
  const series = seriesFor(metric, dimension);
  const current = series[series.length - 1]?.value ?? 0;
  const delta = dimension === 'monthly' ? deltaBetween(metric, series) : null;

  return (
    <div>
      <p className="text-2xl font-semibold tracking-tight">{formatMetricValue(metric, current)}</p>
      <p
        className={cn(
          'mt-1 text-xs',
          delta === null
            ? 'text-on-surface-muted'
            : delta.improvement
              ? 'text-success'
              : 'text-warning',
        )}
      >
        {delta ? delta.label : 'Không so sánh kỳ trước ở chế độ theo quy trình'}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-on-surface-muted">{metric.description}</p>
    </div>
  );
}

function SeriesTable({
  metric,
  series,
}: {
  metric: MetricDefinition;
  series: readonly MetricPoint[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs tracking-wide text-on-surface-muted uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Kỳ / nhóm
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Giá trị
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              So với kỳ trước
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {series.map((point, index) => {
            const previous = index > 0 ? series[index - 1].value : null;
            return (
              <tr key={point.label}>
                <td className="px-3 py-2">{point.label}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {formatMetricValue(metric, point.value)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-on-surface-muted">
                  {previous === null
                    ? '—'
                    : `${point.value >= previous ? '+' : '−'}${formatMetricValue(
                        metric,
                        Math.abs(point.value - previous),
                      )}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const CHART_PADDING = { top: 16, right: 16, bottom: 32, left: 48 };

function MetricChart({
  metric,
  series,
  kind,
}: {
  metric: MetricDefinition;
  series: readonly MetricPoint[];
  kind: ChartKind;
}) {
  if (series.length === 0) {
    return null;
  }

  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const maxValue = Math.ceil(Math.max(...series.map((point) => point.value)) * 1.15);
  const stepX = series.length > 1 ? plotWidth / (series.length - 1) : 0;
  const barWidth = Math.max(18, plotWidth / series.length - 18);

  const x = (index: number) => CHART_PADDING.left + index * stepX;
  const barX = (index: number) =>
    CHART_PADDING.left +
    (plotWidth / series.length) * index +
    (plotWidth / series.length - barWidth) / 2;
  const y = (value: number) => CHART_PADDING.top + plotHeight - (value / maxValue) * plotHeight;

  const linePoints = series.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const gridValues = [0, maxValue / 2, maxValue];

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={`Biểu đồ ${kind === 'line' ? 'đường' : 'cột'} cho ${metric.label} (dữ liệu mô phỏng)`}
      className="w-full"
    >
      {gridValues.map((value) => (
        <g key={value}>
          <line
            x1={CHART_PADDING.left}
            y1={y(value)}
            x2={CHART_WIDTH - CHART_PADDING.right}
            y2={y(value)}
            strokeWidth={1}
            className="stroke-border"
          />
          <text
            x={CHART_PADDING.left - 8}
            y={y(value) + 4}
            textAnchor="end"
            className="fill-on-surface-muted text-[10px]"
          >
            {formatMetricValue(metric, Math.round(value * 10) / 10)}
          </text>
        </g>
      ))}

      {kind === 'line' ? (
        <>
          <polyline
            points={linePoints}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-accent-strong"
          />
          {series.map((point, index) => (
            <circle
              key={point.label}
              cx={x(index)}
              cy={y(point.value)}
              r={4}
              className="fill-surface stroke-accent-strong"
              strokeWidth={2}
            />
          ))}
        </>
      ) : (
        series.map((point, index) => (
          <rect
            key={point.label}
            x={barX(index)}
            y={y(point.value)}
            width={barWidth}
            height={CHART_PADDING.top + plotHeight - y(point.value)}
            rx={4}
            className="fill-accent/70"
          />
        ))
      )}

      {series.map((point, index) => (
        <text
          key={point.label}
          x={kind === 'line' ? x(index) : barX(index) + barWidth / 2}
          y={CHART_HEIGHT - 10}
          textAnchor="middle"
          className="fill-on-surface-muted text-[11px]"
        >
          {point.label}
        </text>
      ))}
    </svg>
  );
}
