import { describe, expect, it } from 'vitest';

import { isAdmin } from '@/lib/access';
import { advancedVisible, parseAdvanced, toggleAdvanced } from '@/lib/advanced';

describe('isAdmin', () => {
  it('is true only for the administrator role', () => {
    expect(isAdmin(['admin'])).toBe(true);
    expect(isAdmin(['admin', 'giam_doc'])).toBe(true);
  });

  it('is false for everyone else, including a designer or a department head', () => {
    expect(isAdmin(['process_designer', 'truong_bo_phan'])).toBe(false);
    expect(isAdmin([])).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('advanced mode', () => {
  it('reads the cookie and treats anything unknown as off', () => {
    expect(parseAdvanced('on')).toBe('on');
    expect(parseAdvanced('off')).toBe('off');
    expect(parseAdvanced(undefined)).toBe('off');
    expect(parseAdvanced('yes')).toBe('off');
  });

  it('toggles between the two states', () => {
    expect(toggleAdvanced('off')).toBe('on');
    expect(toggleAdvanced('on')).toBe('off');
  });

  it('shows the build info only to an administrator with the switch on', () => {
    expect(advancedVisible(true, 'on')).toBe(true);
    expect(advancedVisible(true, 'off')).toBe(false);
    expect(advancedVisible(false, 'on')).toBe(false);
  });
});
