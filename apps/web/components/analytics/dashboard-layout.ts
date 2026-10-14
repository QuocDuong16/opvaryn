/**
 * Dashboard layout model for the Analytics screen (D06).
 *
 * A layout is an ordered list of widgets over *metric keys*. Metrics are real
 * definitions answered by the API, so the layout is validated against the metric keys
 * that currently exist — passed in by the caller rather than imported, because the list
 * comes from the server and changes while the app runs.
 *
 * The same module owns validation and every transition (add, remove, move, resize), so
 * the browser state, the cookie and the server action agree on one definition of a valid
 * layout. It is pure: no React, no cookies, no I/O — see `lib/dashboard.ts` for storage.
 */

export type WidgetView = 'kpi' | 'bars';

export interface DashboardWidget {
  id: string;
  /** The metric this widget shows; must exist when the layout is written. */
  metricKey: string;
  view: WidgetView;
  /** Width in grid columns of the two-column dashboard grid. */
  span: 1 | 2;
}

export const MAX_WIDGETS = 8;
export const MAX_SERIALIZED_LENGTH = 3500;
export const GRID_COLUMNS = 2;

const WIDGET_VIEWS: readonly WidgetView[] = ['kpi', 'bars'];

export const WIDGET_VIEW_LABELS: Record<WidgetView, string> = {
  kpi: 'Một con số',
  bars: 'Phân rã theo nhóm',
};

export const DEFAULT_WIDGET_LIMIT = 4;

function isWidgetView(value: unknown): value is WidgetView {
  return typeof value === 'string' && (WIDGET_VIEWS as readonly string[]).includes(value);
}

function metricExists(allowed: readonly string[], key: string): boolean {
  return allowed.includes(key);
}

/**
 * defaultWidgets arranges the first few metrics that exist, so a fresh dashboard shows
 * real numbers instead of nothing. With no metrics there is no default: an empty list is
 * the honest answer, and the screen says how to create one.
 */
export function defaultWidgets(allowed: readonly string[]): DashboardWidget[] {
  return allowed.slice(0, DEFAULT_WIDGET_LIMIT).map((metricKey, index) => ({
    id: `w${index + 1}`,
    metricKey,
    view: index === 1 ? 'bars' : 'kpi',
    span: index === 1 ? 2 : 1,
  }));
}

/**
 * normalizeWidgets turns untrusted input (a cookie, a server-action payload) into a
 * usable layout. Entries that reference a metric that no longer exists, or an unknown
 * view, are dropped rather than failing the whole layout, so a stale cookie still
 * renders; when nothing valid remains the caller gets the default layout instead of
 * blanks.
 */
export function normalizeWidgets(value: unknown, allowed: readonly string[]): DashboardWidget[] {
  if (!Array.isArray(value)) {
    return defaultWidgets(allowed);
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
    const metricKey = typeof candidate.metricKey === 'string' ? candidate.metricKey.trim() : '';

    if (id === '' || id.length > 64 || seenIds.has(id) || !metricExists(allowed, metricKey)) {
      continue;
    }
    if (!isWidgetView(candidate.view)) {
      continue;
    }

    seenIds.add(id);
    widgets.push({
      id,
      metricKey,
      view: candidate.view,
      span: candidate.span === 2 ? 2 : 1,
    });
  }

  return widgets.length > 0 ? widgets : defaultWidgets(allowed);
}

/** parseWidgets reads the serialized form; anything unusable falls back to default. */
export function parseWidgets(
  raw: string | undefined | null,
  allowed: readonly string[],
): DashboardWidget[] {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_SERIALIZED_LENGTH) {
    return defaultWidgets(allowed);
  }
  try {
    return normalizeWidgets(JSON.parse(raw) as unknown, allowed);
  } catch {
    return defaultWidgets(allowed);
  }
}

/**
 * validateWidgetsStrict checks a payload that is about to be stored. Reading is lenient
 * (`normalizeWidgets` prunes broken entries so a stale cookie still renders); writing is
 * strict, because storing a payload the reader would prune means the saved layout
 * silently differs from what the user arranged.
 */
export function validateWidgetsStrict(
  value: unknown,
  allowed: readonly string[],
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
    if (typeof candidate.metricKey !== 'string' || !metricExists(allowed, candidate.metricKey)) {
      return { ok: false, reason: `Widget ${id} tham chiếu metric không tồn tại.` };
    }
    if (!isWidgetView(candidate.view)) {
      return { ok: false, reason: `Widget ${id} có kiểu hiển thị không hỗ trợ.` };
    }
    if (candidate.span !== 1 && candidate.span !== 2) {
      return { ok: false, reason: `Widget ${id} có độ rộng không hợp lệ.` };
    }

    seenIds.add(id);
    widgets.push({
      id,
      metricKey: candidate.metricKey,
      view: candidate.view,
      span: candidate.span,
    });
  }

  return { ok: true, widgets };
}

/** parseWidgetsStrict reads what the storage layer wrote, without falling back. */
export function parseWidgetsStrict(
  raw: string | undefined | null,
  allowed: readonly string[],
): DashboardWidget[] | null {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_SERIALIZED_LENGTH) {
    return null;
  }
  try {
    const result = validateWidgetsStrict(JSON.parse(raw) as unknown, allowed);
    return result.ok ? result.widgets : null;
  } catch {
    return null;
  }
}

/** serializeWidgets writes the compact form stored in the cookie. */
export function serializeWidgets(widgets: readonly DashboardWidget[]): string {
  return JSON.stringify(
    widgets.map((widget) => ({
      id: widget.id,
      metricKey: widget.metricKey,
      view: widget.view,
      span: widget.span,
    })),
  );
}

/** isDefaultWidgets reports whether a layout still matches the shipped default. */
export function isDefaultWidgets(
  widgets: readonly DashboardWidget[],
  allowed: readonly string[],
): boolean {
  return serializeWidgets(widgets) === serializeWidgets(defaultWidgets(allowed));
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
 * addWidget appends one widget for the metric. The cap keeps the cookie small and the
 * dashboard readable; callers surface the returned `added: false` instead of silently
 * doing nothing.
 */
export function addWidget(
  widgets: readonly DashboardWidget[],
  metricKey: string,
  allowed: readonly string[],
  view: WidgetView = 'kpi',
): { widgets: DashboardWidget[]; added: boolean } {
  if (widgets.length >= MAX_WIDGETS || !metricExists(allowed, metricKey)) {
    return { widgets: [...widgets], added: false };
  }
  return {
    widgets: [...widgets, { id: nextWidgetId(widgets), metricKey, view, span: 1 }],
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

/**
 * updateWidget patches the metric or the view of one widget. A patch that would point at
 * a metric that does not exist, or name an unsupported view, is ignored rather than
 * applied and then pruned by the reader.
 */
export function updateWidget(
  widgets: readonly DashboardWidget[],
  id: string,
  patch: Partial<Pick<DashboardWidget, 'metricKey' | 'view'>>,
  allowed: readonly string[],
): DashboardWidget[] {
  return widgets.map((widget) => {
    if (widget.id !== id) {
      return widget;
    }
    const next: DashboardWidget = { ...widget, ...patch };
    if (!metricExists(allowed, next.metricKey)) {
      next.metricKey = widget.metricKey;
    }
    if (!isWidgetView(next.view)) {
      next.view = widget.view;
    }
    return next;
  });
}
