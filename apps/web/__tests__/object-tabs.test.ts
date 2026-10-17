import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OBJECT_TAB,
  OBJECT_TABS,
  resolveObjectTab,
} from '@/components/objects/object-tabs';

describe('resolveObjectTab', () => {
  it('reads every tab the screen has from the URL', () => {
    for (const tab of OBJECT_TABS) {
      expect(resolveObjectTab(tab)).toBe(tab);
    }
  });

  it('opens the definition when the parameter is missing or unknown', () => {
    expect(DEFAULT_OBJECT_TAB).toBe('fields');
    expect(resolveObjectTab(undefined)).toBe('fields');
    expect(resolveObjectTab(null)).toBe('fields');
    expect(resolveObjectTab('')).toBe('fields');
    // A hand-typed URL must land somewhere honest instead of rendering nothing.
    expect(resolveObjectTab('nonsense')).toBe('fields');
  });
});
