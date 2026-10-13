'use client';

import { useMemo, useState } from 'react';

import {
  deltaBetween,
  formatMetricValue,
  METRIC_CATALOG,
  seriesFor,
  type Dimension,
  type MetricDefinition,
  type MetricPoint,
} from '@/components/analytics/demo-metrics';
import { cn } from '@/lib/utils';

type ChartKind = 'line' | 'bar';

const DIMENSION_LABELS: Record<Dimension, string> = {
  monthly: 'Theo tháng (6 kỳ gần nhất)',
  process: 'Theo quy trình (tháng này)',
};

/**
 * DashboardStudio is the Analytics Studio demo: pick a metric, a dimension and a
 * chart kind, then read the result. It computes from fixtures only — a real
 * dashboard needs typed read models from process events, which arrive with the
 * runtime — so the save-layout action is deliberately disabled.
 */
export function DashboardStudio() {
  const [metricId, setMetricId] = useState(METRIC_CATALOG[0]?.id ?? '');
  const [dimension, setDimension] = useState<Dimension>('monthly');
  const [chartKind, setChartKind] = useState<ChartKind>('line');

  const metric = METRIC_CATALOG.find((item) => item.id === metricId) ?? METRIC_CATALOG[0];

  const series = useMemo(() => (metric ? seriesFor(metric, dimension) : []), [metric, dimension]);

  if (!metric) {
    return null;
  }

  // The month-over-month delta only makes sense for the monthly dimension; the
  // process dimension has groups, not a previous period.
  const delta = dimension === 'monthly' ? deltaBetween(metric, series) : null;
  const current = series[series.length - 1]?.value ?? 0;
  const volumeMetric = METRIC_CATALOG.find((item) => item.id === 'instances');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {METRIC_CATALOG.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMetricId(item.id)}
            aria-pressed={item.id === metric.id}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              item.id === metric.id
                ? 'border-accent-strong/50 bg-accent/10 text-on-surface'
                : 'border-border text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-medium tracking-wide text-on-surface-muted uppercase">
          Dimension
          <select
            value={dimension}
            onChange={(event) => setDimension(event.target.value as Dimension)}
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-on-surface normal-case focus:border-accent-strong focus:outline-none"
          >
            {(Object.keys(DIMENSION_LABELS) as Dimension[]).map((value) => (
              <option key={value} value={value}>
                {DIMENSION_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium tracking-wide text-on-surface-muted uppercase">
          Chart
          <select
            value={chartKind}
            onChange={(event) => setChartKind(event.target.value as ChartKind)}
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-on-surface normal-case focus:border-accent-strong focus:outline-none"
          >
            <option value="line">Line</option>
            <option value="bar">Bar</option>
          </select>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            disabled
            title="Lưu bố cục thuộc MVP: cần read model có kiểu và quyền theo dataset."
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-on-surface-muted opacity-60"
          >
            Lưu dashboard (MVP)
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={metric.label}
          value={formatMetricValue(metric, current)}
          note={delta ? delta.label : '—'}
          tone={delta ? (delta.improvement ? 'good' : 'bad') : 'neutral'}
        />
        <KpiCard
          label="Instance tháng này"
          value={
            volumeMetric
              ? formatMetricValue(volumeMetric, volumeMetric.monthly.at(-1)?.value ?? 0)
              : '—'
          }
          note="Mẫu số dùng cho mọi tỷ lệ phía trên"
        />
        <KpiCard
          label="Dataset"
          value="mô phỏng"
          note="Chưa nối read model — số liệu trong trang này là fixture"
          tone="neutral"
        />
      </div>

      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold tracking-tight">{metric.label}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-on-surface-muted">
              {metric.description}
            </p>
          </div>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
            {DIMENSION_LABELS[dimension]}
          </span>
        </div>

        <div className="mt-4">
          <MetricChart metric={metric} series={series} kind={chartKind} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Kỳ / nhóm
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Giá trị
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                So với kỳ trước
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface-raised/40">
            {series.map((point, index) => {
              const previous = index > 0 ? series[index - 1].value : null;
              return (
                <tr key={point.label}>
                  <td className="px-4 py-2.5">{point.label}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {formatMetricValue(metric, point.value)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-on-surface-muted">
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
    </div>
  );
}

function KpiCard({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-warning' : 'text-on-surface-muted';

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <p className="text-xs tracking-wide text-on-surface-muted uppercase">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
      <p className={cn('mt-1 text-xs', toneClass)}>{note}</p>
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
