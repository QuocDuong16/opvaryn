import { describe, expect, it } from 'vitest';

import { stageLabel } from '@/lib/stage';

describe('stageLabel', () => {
  it('names the stages the contract defines', () => {
    expect(stageLabel('mvp')).toBe('MVP V1');
    expect(stageLabel('production')).toBe('Production');
    expect(stageLabel('demo')).toBe('Demo build');
  });

  it('shows an unknown stage as it arrives', () => {
    expect(stageLabel('beta-2')).toBe('beta-2');
  });
});
