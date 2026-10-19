import { describe, expect, it } from 'vitest';
import type { ProcessMetricsOverview } from '@opvaryn/contracts';

import {
  durationLabel,
  finishedCount,
  formatDuration,
  formatRate,
  reworkedLabel,
} from '@/components/analytics/process-metrics';

function overview(overrides: Partial<ProcessMetricsOverview> = {}): ProcessMetricsOverview {
  return {
    windowDays: 30,
    definitionKey: '',
    instances: { started: 10, completed: 6, rejected: 2, running: 2 },
    cycleTime: { averageSeconds: 7200, medianSeconds: 5400, samples: 8 },
    stepTime: { averageSeconds: 900, medianSeconds: 600, samples: 12 },
    approvalRate: 0.75,
    reworkRate: 0.3,
    generatedAt: '2026-10-14T12:00:00Z',
    ...overrides,
  };
}

describe('formatDuration', () => {
  it('picks the unit a person would say', () => {
    expect(formatDuration(45)).toBe('45 giây');
    expect(formatDuration(600)).toBe('10 phút');
    expect(formatDuration(3600)).toBe('1 giờ');
    expect(formatDuration(7200)).toBe('2 giờ');
    expect(formatDuration(5400)).toBe('1 giờ 30 phút');
    expect(formatDuration(172800)).toBe('2,0 ngày');
    expect(formatDuration(20 * 86400)).toBe('20 ngày');
  });

  it('never shows a negative or broken duration', () => {
    expect(formatDuration(0)).toBe('0 giây');
    expect(formatDuration(-5)).toBe('0 giây');
    expect(formatDuration(Number.NaN)).toBe('0 giây');
  });
});

describe('formatRate', () => {
  it('renders a rate as a Vietnamese percentage', () => {
    expect(formatRate(0.75)).toBe('75,0%');
    expect(formatRate(2 / 3)).toBe('66,7%');
    expect(formatRate(1)).toBe('100,0%');
    expect(formatRate(0)).toBe('0,0%');
  });

  it('says there is no data instead of inventing a zero', () => {
    expect(formatRate(undefined)).toBe('chưa có dữ liệu');
    expect(formatRate(null)).toBe('chưa có dữ liệu');
  });
});

describe('durationLabel', () => {
  it('names how many samples a duration rests on', () => {
    expect(durationLabel({ averageSeconds: 7200, medianSeconds: 5400, samples: 8 })).toBe(
      '2 giờ trung bình · 1 giờ 30 phút trung vị · 8 mẫu',
    );
  });

  it('says so when the window has no samples', () => {
    expect(durationLabel({ averageSeconds: 0, medianSeconds: 0, samples: 0 })).toBe(
      'chưa có mẫu nào trong cửa sổ này',
    );
  });
});

describe('finishedCount and reworkedLabel', () => {
  it('counts only the terminal states', () => {
    expect(finishedCount(overview())).toBe(8);
  });

  it('turns the rework rate back into a numerator a reader can check', () => {
    expect(reworkedLabel(overview())).toBe('3 trên 10 lần chạy phải chạy lại');
  });

  it('reads as zero when the rate is absent', () => {
    expect(
      reworkedLabel(
        overview({
          reworkRate: undefined,
          instances: { started: 0, completed: 0, rejected: 0, running: 0 },
        }),
      ),
    ).toBe('0 trên 0 lần chạy phải chạy lại');
  });
});
