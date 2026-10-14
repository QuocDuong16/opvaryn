import { describe, expect, it } from 'vitest';

import {
  MAX_WIDGETS,
  addWidget,
  defaultWidgets,
  isDefaultWidgets,
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

/** The metric keys the server would pass in; a layout may only reference these. */
const ALLOWED = ['instances', 'cycle_time', 'approval_rate'];

function widget(id: string, overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return { id, metricKey: 'cycle_time', view: 'kpi', span: 1, ...overrides };
}

describe('defaultWidgets', () => {
  it('arranges the metrics that exist, without repeating a fixture list', () => {
    const widgets = defaultWidgets(ALLOWED);

    expect(widgets.map((entry) => entry.metricKey)).toEqual(ALLOWED);
    expect(widgets[1]?.view).toBe('bars');
    expect(widgets[1]?.span).toBe(2);
  });

  it('returns nothing when no metric exists, because there is nothing to show', () => {
    expect(defaultWidgets([])).toEqual([]);
  });

  it('is a fresh copy, so a caller cannot mutate the default', () => {
    const widgets = defaultWidgets(ALLOWED);
    widgets[0]!.metricKey = 'approval_rate';

    expect(defaultWidgets(ALLOWED)[0]?.metricKey).toBe('instances');
    expect(isDefaultWidgets(defaultWidgets(ALLOWED), ALLOWED)).toBe(true);
    expect(isDefaultWidgets(widgets, ALLOWED)).toBe(false);
  });
});

describe('normalizeWidgets', () => {
  it('falls back to the default layout when the value is not a list', () => {
    expect(normalizeWidgets({ id: 'w1' }, ALLOWED)).toEqual(defaultWidgets(ALLOWED));
    expect(normalizeWidgets(null, ALLOWED)).toEqual(defaultWidgets(ALLOWED));
  });

  it('drops entries that reference a metric that no longer exists', () => {
    const result = normalizeWidgets([widget('w1'), widget('w2', { metricKey: 'gone' })], ALLOWED);

    expect(result.map((entry) => entry.id)).toEqual(['w1']);
  });

  it('drops entries with an unknown view, a missing id or a duplicate id', () => {
    const result = normalizeWidgets(
      [
        widget('w1'),
        { ...widget('w2'), view: 'pie' },
        { ...widget(''), metricKey: 'instances' },
        widget('w1'),
      ],
      ALLOWED,
    );

    expect(result.map((entry) => entry.id)).toEqual(['w1']);
  });

  it('clamps the span to half or full width', () => {
    const result = normalizeWidgets([widget('w1', { span: 7 as unknown as 2 })], ALLOWED);

    expect(result[0]?.span).toBe(1);
  });

  it('stops at the widget cap', () => {
    const many = Array.from({ length: MAX_WIDGETS + 3 }, (_, index) => widget(`w${index + 1}`));
    const result = normalizeWidgets(many, ALLOWED);

    expect(result).toHaveLength(MAX_WIDGETS);
  });
});

describe('parseWidgets and serializeWidgets', () => {
  it('round-trips a layout', () => {
    const layout = [widget('w1', { view: 'bars', span: 2 }), widget('w2')];

    expect(parseWidgets(serializeWidgets(layout), ALLOWED)).toEqual(layout);
  });

  it('falls back to the default for an absent, blank, broken or oversized payload', () => {
    expect(parseWidgets(undefined, ALLOWED)).toEqual(defaultWidgets(ALLOWED));
    expect(parseWidgets('  ', ALLOWED)).toEqual(defaultWidgets(ALLOWED));
    expect(parseWidgets('{not json', ALLOWED)).toEqual(defaultWidgets(ALLOWED));
    expect(parseWidgets('x'.repeat(4000), ALLOWED)).toEqual(defaultWidgets(ALLOWED));
  });
});

describe('validateWidgetsStrict', () => {
  it('accepts a well-formed layout', () => {
    const result = validateWidgetsStrict([widget('w1'), widget('w2', { span: 2 })], ALLOWED);

    expect(result.ok).toBe(true);
  });

  it('rejects an empty list, a duplicate id and an unknown metric', () => {
    expect(validateWidgetsStrict([], ALLOWED).ok).toBe(false);
    expect(validateWidgetsStrict([widget('w1'), widget('w1')], ALLOWED).ok).toBe(false);
    const unknown = validateWidgetsStrict([widget('w1', { metricKey: 'gone' })], ALLOWED);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.reason).toContain('không tồn tại');
    }
  });

  it('rejects an unknown view and an invalid span', () => {
    expect(validateWidgetsStrict([{ ...widget('w1'), view: 'pie' }], ALLOWED).ok).toBe(false);
    expect(validateWidgetsStrict([{ ...widget('w1'), span: 3 }], ALLOWED).ok).toBe(false);
  });

  it('rejects more widgets than the cap allows', () => {
    const many = Array.from({ length: MAX_WIDGETS + 1 }, (_, index) => widget(`w${index + 1}`));

    expect(validateWidgetsStrict(many, ALLOWED).ok).toBe(false);
  });
});

describe('parseWidgetsStrict', () => {
  it('reads what the writer stored', () => {
    const layout = [widget('w1')];

    expect(parseWidgetsStrict(serializeWidgets(layout), ALLOWED)).toEqual(layout);
  });

  it('answers null for anything it would not have written', () => {
    expect(parseWidgetsStrict(undefined, ALLOWED)).toBeNull();
    expect(parseWidgetsStrict('', ALLOWED)).toBeNull();
    expect(parseWidgetsStrict('{', ALLOWED)).toBeNull();
    expect(parseWidgetsStrict('[]', ALLOWED)).toBeNull();
    expect(parseWidgetsStrict('x'.repeat(4000), ALLOWED)).toBeNull();
  });
});

describe('transitions', () => {
  it('adds a widget for a metric that exists, and refuses an unknown one', () => {
    const added = addWidget([], 'instances', ALLOWED, 'bars');

    expect(added.added).toBe(true);
    expect(added.widgets[0]).toMatchObject({ metricKey: 'instances', view: 'bars', id: 'w1' });
    expect(addWidget([], 'gone', ALLOWED).added).toBe(false);
  });

  it('refuses to add past the cap', () => {
    const many = Array.from({ length: MAX_WIDGETS }, (_, index) => widget(`w${index + 1}`));

    expect(addWidget(many, 'instances', ALLOWED).added).toBe(false);
  });

  it('numbers new widgets after the highest existing one', () => {
    const added = addWidget([widget('w4')], 'instances', ALLOWED);

    expect(added.widgets[1]?.id).toBe('w5');
  });

  it('removes, reorders and moves widgets, clamping to the ends', () => {
    const layout = [widget('w1'), widget('w2'), widget('w3')];

    expect(removeWidget(layout, 'w2').map((entry) => entry.id)).toEqual(['w1', 'w3']);
    expect(reorderWidget(layout, 0, 2).map((entry) => entry.id)).toEqual(['w2', 'w3', 'w1']);
    expect(reorderWidget(layout, 0, 9).map((entry) => entry.id)).toEqual(['w1', 'w2', 'w3']);
    expect(moveWidget(layout, 'w3', -1).map((entry) => entry.id)).toEqual(['w1', 'w3', 'w2']);
    expect(moveWidget(layout, 'w1', -5).map((entry) => entry.id)).toEqual(['w1', 'w2', 'w3']);
    expect(moveWidget(layout, 'nope', 1).map((entry) => entry.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('toggles the width of one widget only', () => {
    const layout = [widget('w1'), widget('w2')];

    expect(resizeWidget(layout, 'w2').map((entry) => entry.span)).toEqual([1, 2]);
    expect(resizeWidget(layout, 'w2').map((entry) => entry.id)).toEqual(['w1', 'w2']);
  });

  it('updates the metric and the view, ignoring values it would have to prune', () => {
    const layout = [widget('w1')];

    expect(updateWidget(layout, 'w1', { view: 'bars' }, ALLOWED)[0]?.view).toBe('bars');
    expect(updateWidget(layout, 'w1', { metricKey: 'instances' }, ALLOWED)[0]?.metricKey).toBe(
      'instances',
    );
    // A metric that does not exist, or a view that is not supported, keeps the old value
    // instead of being written and then pruned by the reader.
    expect(updateWidget(layout, 'w1', { metricKey: 'gone' }, ALLOWED)[0]?.metricKey).toBe(
      'cycle_time',
    );
    expect(updateWidget(layout, 'w1', { view: 'pie' as unknown as 'kpi' }, ALLOWED)[0]?.view).toBe(
      'kpi',
    );
    // Another widget is untouched.
    expect(
      updateWidget([widget('w1'), widget('w2')], 'w1', { view: 'bars' }, ALLOWED)[1]?.view,
    ).toBe('kpi');
  });
});
