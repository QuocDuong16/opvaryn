'use client';

import { useActionState, useState, type DragEvent } from 'react';
import type { MetricDefinition, MetricResult } from '@opvaryn/contracts';

import { saveDashboardAction } from '@/app/(workspace)/analytics/actions';
import {
  GRID_COLUMNS,
  MAX_WIDGETS,
  WIDGET_VIEW_LABELS,
  addWidget,
  isDefaultWidgets,
  moveWidget,
  removeWidget,
  reorderWidget,
  resizeWidget,
  serializeWidgets,
  updateWidget,
  type DashboardWidget,
  type WidgetView,
} from '@/components/analytics/dashboard-layout';
import { INITIAL_SAVE_DASHBOARD_STATE } from '@/components/analytics/dashboard-state';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { labelOrKey } from '@/lib/names';
import { cn } from '@/lib/utils';

const CONTROL_BUTTON =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors ' +
  'hover:bg-surface-overlay disabled:opacity-50';

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** AGGREGATION_LABELS names what a metric does, in words (ADR 0018). */
const AGGREGATION_LABELS: Record<string, string> = {
  count: 'Đếm',
  sum: 'Tổng',
  avg: 'Trung bình',
};

/** formatMetricValue renders a metric number: counts are integers, sums and averages are not. */
export function formatMetricValue(metric: MetricDefinition, value: number): string {
  return NUMBER_FORMAT.format(metric.aggregation === 'count' ? Math.round(value) : value);
}

/**
 * DashboardStudio arranges widgets over live metrics: drag to reorder, ↑↓ for keyboard
 * users, a width toggle, and one view per widget (a single number or the breakdown by
 * group). The numbers arrive as `results`, computed server-side for the signed-in user —
 * a metric is scoped like a record read, so two people can legitimately see two numbers.
 * The layout is validated by the same pure module that reads and writes the cookie.
 */
export function DashboardStudio({
  metrics,
  results,
  initialWidgets,
  fieldNames,
}: {
  metrics: readonly MetricDefinition[];
  /** One answered metric per key, computed server-side for this signed-in user. */
  results: Record<string, MetricResult>;
  initialWidgets: readonly DashboardWidget[];
  /** Field key to label, per object, so a widget says what it measures (ADR 0018). */
  fieldNames: Record<string, Record<string, string>>;
}) {
  const allowed = metrics.map((metric) => metric.key);
  const namesFor = (objectKey: string): Map<string, string> =>
    new Map(Object.entries(fieldNames[objectKey] ?? {}));
  const [widgets, setWidgets] = useState<DashboardWidget[]>(() => [...initialWidgets]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [saveState, saveAction] = useActionState(saveDashboardAction, INITIAL_SAVE_DASHBOARD_STATE);
  const [pendingMetric, setPendingMetric] = useState(allowed[0] ?? '');

  const atCap = widgets.length >= MAX_WIDGETS;

  function handleAdd() {
    const result = addWidget(widgets, pendingMetric, allowed, 'kpi');
    if (result.added) {
      setWidgets(result.widgets);
    }
  }

  function handleDragStart(index: number, event: DragEvent<HTMLLIElement>) {
    setDragging(index);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag without payload.
    event.dataTransfer.setData('text/plain', String(index));
  }

  function handleDrop(index: number) {
    if (dragging === null) {
      return;
    }
    setWidgets((current) => reorderWidget(current, dragging, index));
    setDragging(null);
  }

  if (metrics.length === 0) {
    return (
      <Card>
        <CardTitle>Chưa có chỉ số nào để hiển thị</CardTitle>
        <CardDescription>
          Bảng số liệu đọc chỉ số thật từ hệ thống. Tạo chỉ số đầu tiên ở biểu mẫu bên dưới (cần vai
          trò thiết kế quy trình hoặc quản trị hệ thống), rồi tải lại trang này.
        </CardDescription>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <label
          htmlFor="add-widget"
          className="text-xs tracking-wide text-on-surface-muted uppercase"
        >
          Thêm ô số liệu
        </label>
        <select
          id="add-widget"
          value={pendingMetric}
          onChange={(event) => setPendingMetric(event.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent-strong focus:outline-none"
        >
          {metrics.map((metric) => (
            <option key={metric.key} value={metric.key}>
              {metric.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleAdd} disabled={atCap} className={CONTROL_BUTTON}>
          {atCap ? `Đã đủ ${MAX_WIDGETS} widget` : 'Thêm'}
        </button>
        <span className="text-xs text-on-surface-muted">
          {`${widgets.length}/${MAX_WIDGETS} widget · kéo để đổi thứ tự`}
        </span>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {widgets.map((widget, index) => {
          const metric = metrics.find((candidate) => candidate.key === widget.metricKey);
          const result = results[widget.metricKey];
          if (!metric || !result) {
            return null;
          }
          return (
            <li
              key={widget.id}
              draggable
              onDragStart={(event) => handleDragStart(index, event)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(index)}
              className={cn(
                'rounded-xl border border-border bg-surface-raised p-4',
                widget.span === GRID_COLUMNS && 'sm:col-span-2',
                dragging === index && 'opacity-60',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{metric.name}</p>
                  <p className="mt-0.5 text-[11px] text-on-surface-muted">
                    {`${AGGREGATION_LABELS[metric.aggregation] ?? metric.aggregation}${
                      metric.measure
                        ? ` của ${labelOrKey(namesFor(metric.objectKey).get(metric.measure.key), metric.measure.key)}`
                        : ' bản ghi'
                    }${
                      metric.groupBy
                        ? ` · nhóm theo ${labelOrKey(namesFor(metric.objectKey).get(metric.groupBy.key), metric.groupBy.key)}`
                        : ''
                    }`}
                  </p>
                </div>
                <select
                  value={widget.view}
                  onChange={(event) =>
                    setWidgets((current) =>
                      updateWidget(
                        current,
                        widget.id,
                        { view: event.target.value as WidgetView },
                        allowed,
                      ),
                    )
                  }
                  aria-label={`Kiểu hiển thị của ${metric.name}`}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] focus:border-accent-strong focus:outline-none"
                >
                  {(Object.keys(WIDGET_VIEW_LABELS) as WidgetView[]).map((view) => (
                    <option key={view} value={view}>
                      {WIDGET_VIEW_LABELS[view]}
                    </option>
                  ))}
                </select>
              </div>

              <p className="mt-3 text-2xl font-semibold tracking-tight">
                {formatMetricValue(metric, result.total)}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-muted">
                {`trên ${result.records} bản ghi bạn được đọc`}
              </p>

              {widget.view === 'bars' && result.buckets.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {result.buckets.map((bucket) => {
                    const widest = result.buckets[0]?.value || 1;
                    const width = Math.max(4, Math.round((bucket.value / widest) * 100));
                    return (
                      <li key={bucket.key} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px]">{bucket.key || '—'}</span>
                          <span>{formatMetricValue(metric, bucket.value)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-surface-overlay">
                          <div
                            className="h-1.5 rounded-full bg-accent-strong"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {widget.view === 'bars' && result.buckets.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-on-surface-muted">
                  Metric này không nhóm theo field nào, nên không có phân rã để vẽ.
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWidgets((current) => moveWidget(current, widget.id, -1))}
                  disabled={index === 0}
                  aria-label={`Đưa ${metric.name} lên`}
                  className={CONTROL_BUTTON}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => setWidgets((current) => moveWidget(current, widget.id, 1))}
                  disabled={index === widgets.length - 1}
                  aria-label={`Đưa ${metric.name} xuống`}
                  className={CONTROL_BUTTON}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setWidgets((current) => resizeWidget(current, widget.id))}
                  className={CONTROL_BUTTON}
                >
                  {widget.span === 2 ? 'Thu hẹp' : 'Mở rộng'}
                </button>
                <button
                  type="button"
                  onClick={() => setWidgets((current) => removeWidget(current, widget.id))}
                  className={cn(CONTROL_BUTTON, 'text-danger')}
                >
                  Xoá
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form action={saveAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="layout" value={serializeWidgets(widgets)} />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
        >
          Lưu bố cục
        </button>
        <button
          type="button"
          onClick={() => setWidgets(initialWidgets.map((widget) => ({ ...widget })))}
          className={CONTROL_BUTTON}
        >
          Khôi phục bố cục đã lưu
        </button>
        <span className="text-xs text-on-surface-muted">
          {isDefaultWidgets(widgets, allowed)
            ? 'Đang dùng bố cục mặc định (metric đầu tiên, theo thứ tự).'
            : 'Bố cục đang khác mặc định — lưu để giữ cho trình duyệt này.'}
        </span>

        {saveState.status === 'error' ? (
          <p
            role="alert"
            className="w-full rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
          >
            {saveState.message}
          </p>
        ) : null}
        {saveState.status === 'saved' ? (
          <p
            role="status"
            className="w-full rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
          >
            {saveState.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
