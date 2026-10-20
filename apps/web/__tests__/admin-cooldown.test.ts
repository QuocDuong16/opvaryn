import { describe, expect, it } from 'vitest';

import { cooldownState } from '@/components/admin/cooldown';

const NOW = new Date('2026-10-20T09:00:00Z');

describe('cooldownState', () => {
  it('says nothing when the account can sign in normally', () => {
    const state = cooldownState(null, NOW);
    expect(state.locked).toBe(false);
    expect(state.clock).toBeNull();
    expect(state.until).toBeNull();
  });

  it('says nothing for an unreadable value', () => {
    const state = cooldownState('không phải ngày', NOW);
    expect(state.locked).toBe(false);
    expect(state.clock).toBeNull();
  });

  it('treats a moment that already passed as free', () => {
    const state = cooldownState('2026-10-20T08:59:00Z', NOW);
    expect(state.locked).toBe(false);
    expect(state.clock).toBeNull();
  });

  it('names the moment the wait ends, in the timezone of the organisation', () => {
    const state = cooldownState('2026-10-20T10:30:00Z', NOW);
    expect(state.locked).toBe(true);
    expect(state.until?.toISOString()).toBe('2026-10-20T10:30:00.000Z');
    expect(state.clock).toBe('17:30');
  });
});
