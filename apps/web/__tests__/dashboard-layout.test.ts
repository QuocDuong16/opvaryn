import { describe, expect, it } from 'vitest';

import {
  addWidget,
  DEFAULT_WIDGETS,
  defaultWidgets,
  isDefaultWidgets,
  MAX_WIDGETS,
  moveWidget,
  normalizeWidgets,
  parseWidgets,
  parseWidgetsStrict,
  removeWidget,
  reorderWidget,
  resizeWidget,
  serializeWidgets,
  updateWidget,
  validateWidgetsStrict,
  type DashboardWidget,
} from '@/components/analytics/dashboard-layout';

function widget(id: string, overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id,
    kind: 'chart',
    metricId: 'cycle_time',
    dimension: 'monthly',
    span: 1,
    chartKind: 'line',
    ...overrides,
  };
}

describe('defaultWidgets', () => {
  it('returns a fresh copy so callers cannot mutate the shipped default', () => {
    const copy = defaultWidgets();
    copy[0]!.metricId = 'approval_rate';

    expect(DEFAULT_WIDGETS[0]?.metricId).toBe('instances');
    expect(isDefaultWidgets(DEFAULT_WIDGETS)).toBe(true);
  });
});

describe('normalizeWidgets', () => {
  it('falls back to the default layout when the value is not a list', () => {
    expect(normalizeWidgets({ id: 'w1' })).toEqual(defaultWidgets());
    expect(normalizeWidgets(null)).toEqual(defaultWidgets());
  });

  it('drops entries that reference an unknown metric', () => {
    const result = normalizeWidgets([widget('w1'), widget('w2', { metricId: 'nope' })]);

    expect(result.map((entry) => entry.id)).toEqual(['w1']);
  });

  it('drops entries with an unknown kind, a missing id or a duplicate id', () => {
    const result = normalizeWidgets([
      widget('w1'),
      { ...widget('w2'), kind: 'pie' },
      { ...widget(''), metricId: 'instances' },
      widget('w1', { metricId: 'instances' }),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(['w1']);
  });

  it('coerces unusable fields instead of dropping the widget', () => {
    const result = normalizeWidgets([
      {
        id: 'w9',
        kind: 'chart',
        metricId: 'cycle_time',
        dimension: 'quarterly',
        span: 4,
        chartKind: 'scatter',
      },
    ]);

    expect(result[0]).toEqual({
      id: 'w9',
      kind: 'chart',
      metricId: 'cycle_time',
      dimension: 'monthly',
      span: 1,
      chartKind: 'line',
    });
  });

  it('caps the number of widgets', () => {
    const many = Array.from({ length: MAX_WIDGETS + 3 }, (_, index) => widget(`w${index + 1}`));

    expect(normalizeWidgets(many)).toHaveLength(MAX_WIDGETS);
  });

  it('returns the default layout when nothing survives validation', () => {
    expect(normalizeWidgets([{ id: 'x', kind: 'pie', metricId: 'nope' }])).toEqual(
      defaultWidgets(),
    );
  });
});

describe('parseWidgets and serializeWidgets', () => {
  it('round-trips a layout without losing order or settings', () => {
    const layout = [
      widget('w1', { kind: 'kpi', metricId: 'instances', span: 2 }),
      widget('w2', { dimension: 'process', chartKind: 'bar' }),
    ];

    expect(parseWidgets(serializeWidgets(layout))).toEqual(layout);
  });

  it('falls back to the default for blank, broken or oversized cookies', () => {
    expect(parseWidgets(undefined)).toEqual(defaultWidgets());
    expect(parseWidgets('  ')).toEqual(defaultWidgets());
    expect(parseWidgets('{not json')).toEqual(defaultWidgets());
    expect(parseWidgets('x'.repeat(4000))).toEqual(defaultWidgets());
  });
});

describe('layout transitions', () => {
  it('adds a widget with a fresh id and refuses unknown metrics', () => {
    const added = addWidget([widget('w1')], 'instances', 'kpi');

    expect(added.added).toBe(true);
    expect(added.widgets.map((entry) => entry.id)).toEqual(['w1', 'w2']);
    expect(added.widgets[1]).toMatchObject({ kind: 'kpi', metricId: 'instances' });

    expect(addWidget([widget('w1')], 'nope').added).toBe(false);
  });

  it('refuses to add past the cap', () => {
    const full = defaultWidgets().concat(
      Array.from({ length: MAX_WIDGETS }, (_, index) => widget(`x${index}`)),
    );

    expect(addWidget(full, 'instances')).toEqual({ widgets: full, added: false });
  });

  it('removes only the addressed widget', () => {
    const result = removeWidget([widget('w1'), widget('w2')], 'w1');

    expect(result.map((entry) => entry.id)).toEqual(['w2']);
  });

  it('moves a widget within bounds and clamps at the ends', () => {
    const layout = [widget('w1'), widget('w2'), widget('w3')];

    expect(moveWidget(layout, 'w3', -1).map((entry) => entry.id)).toEqual(['w1', 'w3', 'w2']);
    expect(moveWidget(layout, 'w1', -1).map((entry) => entry.id)).toEqual(['w1', 'w2', 'w3']);
    expect(moveWidget(layout, 'w1', 5).map((entry) => entry.id)).toEqual(['w2', 'w3', 'w1']);
    expect(moveWidget(layout, 'missing', 1)).toEqual(layout);
  });

  it('reorders by index for drag and drop and ignores invalid indexes', () => {
    const layout = [widget('w1'), widget('w2'), widget('w3')];

    expect(reorderWidget(layout, 2, 0).map((entry) => entry.id)).toEqual(['w3', 'w1', 'w2']);
    expect(reorderWidget(layout, 0, 0)).toEqual(layout);
    expect(reorderWidget(layout, -1, 2)).toEqual(layout);
    expect(reorderWidget(layout, 0, 9)).toEqual(layout);
  });

  it('never mutates the layout it was given', () => {
    const layout = [widget('w1'), widget('w2')];
    const before = serializeWidgets(layout);

    reorderWidget(layout, 0, 1);
    resizeWidget(layout, 'w1');
    updateWidget(layout, 'w1', { metricId: 'approval_rate' });
    removeWidget(layout, 'w1');

    expect(serializeWidgets(layout)).toBe(before);
  });

  it('toggles the width and keeps the other widget settings', () => {
    const result = resizeWidget([widget('w1', { span: 1, metricId: 'rework_rate' })], 'w1');

    expect(result[0]).toMatchObject({ span: 2, metricId: 'rework_rate' });
    expect(resizeWidget(result, 'w1')[0]?.span).toBe(1);
  });

  it('applies a valid patch and rejects an unknown metric', () => {
    const result = updateWidget([widget('w1')], 'w1', {
      dimension: 'process',
      chartKind: 'bar',
    });
    expect(result[0]).toMatchObject({ dimension: 'process', chartKind: 'bar' });

    const guarded = updateWidget(result, 'w1', { metricId: 'does_not_exist' });
    expect(guarded[0]?.metricId).toBe('cycle_time');
  });
});

describe('validateWidgetsStrict', () => {
  it('accepts a layout and returns canonical widgets', () => {
    const result = validateWidgetsStrict([
      { ...widget('w1'), extra: 'ignored by the canonical form' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.widgets).toEqual([widget('w1')]);
    }
  });

  it.each([
    ['a payload that is not a list', { id: 'w1' }],
    ['an empty dashboard', []],
    ['too many widgets', Array.from({ length: MAX_WIDGETS + 1 }, (_, i) => widget(`w${i}`))],
    ['a widget without an id', [{ ...widget('w1'), id: '  ' }]],
    ['a duplicate id', [widget('w1'), widget('w1')]],
    ['an unknown metric', [widget('w1', { metricId: 'nope' })]],
    ['an unknown kind', [{ ...widget('w1'), kind: 'pie' }]],
    ['an unusable dimension', [widget('w1', { dimension: 'quarterly' as never })]],
    ['an unusable span', [{ ...widget('w1'), span: 3 }]],
    ['an unusable chart kind', [{ ...widget('w1'), chartKind: 'scatter' }]],
  ])('rejects %s', (_name, payload) => {
    const result = validateWidgetsStrict(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('rejects rather than prunes, so a saved layout equals what was arranged', () => {
    const result = validateWidgetsStrict([widget('w1'), widget('w2', { metricId: 'nope' })]);

    expect(result.ok).toBe(false);
  });
});

describe('parseWidgetsStrict', () => {
  it('reads back what serializeWidgets wrote', () => {
    const layout = [widget('w1', { span: 2, kind: 'kpi', metricId: 'instances' })];

    expect(parseWidgetsStrict(serializeWidgets(layout))).toEqual(layout);
  });

  it('returns null for anything it cannot trust', () => {
    expect(parseWidgetsStrict(undefined)).toBeNull();
    expect(parseWidgetsStrict('')).toBeNull();
    expect(parseWidgetsStrict('{')).toBeNull();
    expect(parseWidgetsStrict('[]')).toBeNull();
    expect(parseWidgetsStrict('x'.repeat(4000))).toBeNull();
  });
});
