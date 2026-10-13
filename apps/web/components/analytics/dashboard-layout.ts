import { METRIC_CATALOG, type Dimension } from '@/components/analytics/demo-metrics';

/**
 * Dashboard layout model for the Analytics Studio.
 *
 * A layout is an ordered list of widgets the user arranges. The same module owns
 * validation and every transition (add, remove, move, resize), so the browser
 * state, the cookie and the server action all agree on one definition of a valid
 * layout. It is pure: no React, no cookies, no I/O — see `lib/dashboard.ts` for
 * persistence.
 */

export type WidgetKind = 'kpi' | 'chart' | 'table';
export type ChartKind = 'line' | 'bar';

export interface DashboardWidget {
  id: string;
  kind: WidgetKind;
  metricId: string;
  dimension: Dimension;
  /** Width in grid columns of the two-column dashboard grid. */
  span: 1 | 2;
  /** Only meaningful for `chart` widgets; kept so switching kind keeps the choice. */
  chartKind: ChartKind;
}

export const MAX_WIDGETS = 8;
export const MAX_SERIALIZED_LENGTH = 3500;
export const GRID_COLUMNS = 2;

const WIDGET_KINDS: readonly WidgetKind[] = ['kpi', 'chart', 'table'];
const CHART_KINDS: readonly ChartKind[] = ['line', 'bar'];
const DIMENSIONS: readonly Dimension[] = ['monthly', 'process'];

export const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
  kpi: 'KPI',
  chart: 'Chart',
  table: 'Table',
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  monthly: 'Theo tháng (6 kỳ gần nhất)',
  process: 'Theo quy trình (tháng này)',
};

export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  line: 'Line',
  bar: 'Bar',
};

export const DEFAULT_WIDGETS: readonly DashboardWidget[] = [
  {
    id: 'w1',
    kind: 'kpi',
    metricId: 'instances',
    dimension: 'monthly',
    span: 1,
    chartKind: 'line',
  },
  {
    id: 'w2',
    kind: 'chart',
    metricId: 'cycle_time',
    dimension: 'monthly',
    span: 2,
    chartKind: 'line',
  },
  {
    id: 'w3',
    kind: 'chart',
    metricId: 'approval_rate',
    dimension: 'monthly',
    span: 1,
    chartKind: 'bar',
  },
  {
    id: 'w4',
    kind: 'table',
    metricId: 'sla_breach',
    dimension: 'monthly',
    span: 1,
    chartKind: 'line',
  },
];

function isWidgetKind(value: unknown): value is WidgetKind {
  return typeof value === 'string' && (WIDGET_KINDS as readonly string[]).includes(value);
}

function isChartKind(value: unknown): value is ChartKind {
  return typeof value === 'string' && (CHART_KINDS as readonly string[]).includes(value);
}

function isDimension(value: unknown): value is Dimension {
  return typeof value === 'string' && (DIMENSIONS as readonly string[]).includes(value);
}

function metricExists(metricId: string): boolean {
  return METRIC_CATALOG.some((metric) => metric.id === metricId);
}

/**
 * normalizeWidgets turns untrusted input (a cookie, a server-action payload) into
 * a usable layout. Entries that reference an unknown metric, kind or dimension are
 * dropped rather than failing the whole layout, so a stale cookie still renders;
 * when nothing valid remains the caller gets the default layout instead of blanks.
 */
export function normalizeWidgets(value: unknown): DashboardWidget[] {
  if (!Array.isArray(value)) {
    return defaultWidgets();
  }

  const seenIds = new Set<string>();
  const widgets: DashboardWidget[] = [];

  for (const entry of value) {
    if (widgets.length >= MAX_WIDGETS) {
      break;
    }
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const metricId = typeof candidate.metricId === 'string' ? candidate.metricId.trim() : '';

    if (id === '' || id.length > 64 || seenIds.has(id) || !metricExists(metricId)) {
      continue;
    }
    if (!isWidgetKind(candidate.kind)) {
      continue;
    }

    seenIds.add(id);
    widgets.push({
      id,
      kind: candidate.kind,
      metricId,
      dimension: isDimension(candidate.dimension) ? candidate.dimension : 'monthly',
      span: candidate.span === 2 ? 2 : 1,
      chartKind: isChartKind(candidate.chartKind) ? candidate.chartKind : 'line',
    });
  }

  return widgets.length > 0 ? widgets : defaultWidgets();
}

/** parseWidgets reads the serialized form; anything unusable falls back to default. */
export function parseWidgets(raw: string | undefined | null): DashboardWidget[] {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_SERIALIZED_LENGTH) {
    return defaultWidgets();
  }
  try {
    return normalizeWidgets(JSON.parse(raw) as unknown);
  } catch {
    return defaultWidgets();
  }
}

/**
 * validateWidgetsStrict checks a payload that is about to be stored. Reading is
 * lenient (`normalizeWidgets` prunes broken entries so a stale cookie still
 * renders); writing is strict, because storing a payload the reader would prune
 * means the saved layout silently differs from what the user arranged.
 */
export function validateWidgetsStrict(
  value: unknown,
): { ok: true; widgets: DashboardWidget[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'Bố cục phải là một danh sách widget.' };
  }
  if (value.length === 0) {
    return { ok: false, reason: 'Dashboard cần ít nhất một widget.' };
  }
  if (value.length > MAX_WIDGETS) {
    return { ok: false, reason: `Chỉ lưu được tối đa ${MAX_WIDGETS} widget.` };
  }

  const seenIds = new Set<string>();
  const widgets: DashboardWidget[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, reason: 'Widget không đúng định dạng.' };
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';

    if (id === '' || id.length > 64) {
      return { ok: false, reason: 'Widget thiếu id hợp lệ.' };
    }
    if (seenIds.has(id)) {
      return { ok: false, reason: `Widget trùng id ${id}.` };
    }
    if (!isWidgetKind(candidate.kind)) {
      return { ok: false, reason: `Widget ${id} có kiểu hiển thị không hỗ trợ.` };
    }
    if (typeof candidate.metricId !== 'string' || !metricExists(candidate.metricId)) {
      return { ok: false, reason: `Widget ${id} tham chiếu metric không tồn tại.` };
    }
    if (!isDimension(candidate.dimension)) {
      return { ok: false, reason: `Widget ${id} có dimension không hợp lệ.` };
    }
    if (candidate.span !== 1 && candidate.span !== 2) {
      return { ok: false, reason: `Widget ${id} có độ rộng không hợp lệ.` };
    }
    if (!isChartKind(candidate.chartKind)) {
      return { ok: false, reason: `Widget ${id} có kiểu chart không hợp lệ.` };
    }

    seenIds.add(id);
    widgets.push({
      id,
      kind: candidate.kind,
      metricId: candidate.metricId,
      dimension: candidate.dimension,
      span: candidate.span,
      chartKind: candidate.chartKind,
    });
  }

  return { ok: true, widgets };
}

/** parseWidgetsStrict reads what the storage layer wrote, without falling back. */
export function parseWidgetsStrict(raw: string | undefined | null): DashboardWidget[] | null {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_SERIALIZED_LENGTH) {
    return null;
  }
  try {
    const result = validateWidgetsStrict(JSON.parse(raw) as unknown);
    return result.ok ? result.widgets : null;
  } catch {
    return null;
  }
}

/** serializeWidgets writes the compact form stored in the cookie. */
export function serializeWidgets(widgets: readonly DashboardWidget[]): string {
  const compact = widgets.map((widget) => ({
    id: widget.id,
    kind: widget.kind,
    metricId: widget.metricId,
    dimension: widget.dimension,
    span: widget.span,
    chartKind: widget.chartKind,
  }));
  return JSON.stringify(compact);
}

export function defaultWidgets(): DashboardWidget[] {
  return DEFAULT_WIDGETS.map((widget) => ({ ...widget }));
}

/** isDefaultWidgets reports whether a layout still matches the shipped default. */
export function isDefaultWidgets(widgets: readonly DashboardWidget[]): boolean {
  return serializeWidgets(widgets) === serializeWidgets(DEFAULT_WIDGETS);
}

function nextWidgetId(widgets: readonly DashboardWidget[]): string {
  let highest = 0;
  for (const widget of widgets) {
    const match = /^w(\d+)$/.exec(widget.id);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return `w${highest + 1}`;
}

/**
 * addWidget appends one widget for the metric. The cap keeps the cookie small and
 * the dashboard readable; callers surface the returned `added: false` instead of
 * silently doing nothing.
 */
export function addWidget(
  widgets: readonly DashboardWidget[],
  metricId: string,
  kind: WidgetKind = 'chart',
): { widgets: DashboardWidget[]; added: boolean } {
  if (widgets.length >= MAX_WIDGETS || !metricExists(metricId)) {
    return { widgets: [...widgets], added: false };
  }
  return {
    widgets: [
      ...widgets,
      {
        id: nextWidgetId(widgets),
        kind,
        metricId,
        dimension: 'monthly',
        span: 1,
        chartKind: 'line',
      },
    ],
    added: true,
  };
}

export function removeWidget(widgets: readonly DashboardWidget[], id: string): DashboardWidget[] {
  return widgets.filter((widget) => widget.id !== id);
}

/** moveWidget shifts one widget by `offset` positions, clamped to the ends. */
export function moveWidget(
  widgets: readonly DashboardWidget[],
  id: string,
  offset: number,
): DashboardWidget[] {
  const from = widgets.findIndex((widget) => widget.id === id);
  if (from === -1) {
    return [...widgets];
  }
  const to = Math.min(widgets.length - 1, Math.max(0, from + offset));
  return reorderWidget(widgets, from, to);
}

/** reorderWidget implements drag-and-drop: move the widget at `from` to `to`. */
export function reorderWidget(
  widgets: readonly DashboardWidget[],
  from: number,
  to: number,
): DashboardWidget[] {
  if (from === to || from < 0 || to < 0 || from >= widgets.length || to >= widgets.length) {
    return [...widgets];
  }
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** resizeWidget toggles a widget between half and full grid width. */
export function resizeWidget(widgets: readonly DashboardWidget[], id: string): DashboardWidget[] {
  return widgets.map((widget) =>
    widget.id === id ? { ...widget, span: widget.span === 2 ? 1 : 2 } : widget,
  );
}

/** updateWidget patches the metric/dimension/chart kind of one widget. */
export function updateWidget(
  widgets: readonly DashboardWidget[],
  id: string,
  patch: Partial<Pick<DashboardWidget, 'metricId' | 'dimension' | 'chartKind' | 'kind'>>,
): DashboardWidget[] {
  return widgets.map((widget) => {
    if (widget.id !== id) {
      return widget;
    }
    const next: DashboardWidget = { ...widget, ...patch };
    if (!metricExists(next.metricId)) {
      next.metricId = widget.metricId;
    }
    if (!isDimension(next.dimension)) {
      next.dimension = widget.dimension;
    }
    if (!isChartKind(next.chartKind)) {
      next.chartKind = widget.chartKind;
    }
    if (!isWidgetKind(next.kind)) {
      next.kind = widget.kind;
    }
    return next;
  });
}
