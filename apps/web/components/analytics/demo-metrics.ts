/**
 * Demo analytics fixtures and the pure functions behind the dashboard studio.
 *
 * The metric catalog mirrors the playbook definitions (section 03 of
 * modules.html). Values are illustrative: a real dashboard reads typed read
 * models built from process events, which do not exist before the workflow
 * runtime does.
 */

export type MetricUnit = 'percent' | 'days' | 'hours' | 'count';

export interface MetricPoint {
  label: string;
  value: number;
}

export interface MetricDefinition {
  id: string;
  label: string;
  unit: MetricUnit;
  description: string;
  /** Whether a rising value means the process is doing better. */
  goodDirection: 'up' | 'down';
  monthly: readonly MetricPoint[];
  byProcess: readonly MetricPoint[];
}

export type Dimension = 'monthly' | 'process';

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export const METRIC_CATALOG: readonly MetricDefinition[] = [
  {
    id: 'instances',
    label: 'Số instance',
    unit: 'count',
    description: 'Số process instance được khởi tạo trong kỳ.',
    goodDirection: 'up',
    monthly: [
      { label: 'T5', value: 312 },
      { label: 'T6', value: 348 },
      { label: 'T7', value: 361 },
      { label: 'T8', value: 402 },
      { label: 'T9', value: 388 },
      { label: 'T10', value: 421 },
    ],
    byProcess: [
      { label: 'Mua hàng', value: 286 },
      { label: 'Sự cố IT', value: 135 },
    ],
  },
  {
    id: 'cycle_time',
    label: 'Cycle time trung bình',
    unit: 'days',
    description: 'Thời gian từ submit đến khi instance đạt trạng thái kết thúc.',
    goodDirection: 'down',
    monthly: [
      { label: 'T5', value: 4.2 },
      { label: 'T6', value: 3.8 },
      { label: 'T7', value: 3.5 },
      { label: 'T8', value: 3.1 },
      { label: 'T9', value: 2.8 },
      { label: 'T10', value: 2.6 },
    ],
    byProcess: [
      { label: 'Mua hàng', value: 3.4 },
      { label: 'Sự cố IT', value: 1.2 },
    ],
  },
  {
    id: 'approval_rate',
    label: 'Approval rate',
    unit: 'percent',
    description: 'Instance được duyệt trên tổng instance đã có kết quả cuối.',
    goodDirection: 'up',
    monthly: [
      { label: 'T5', value: 78 },
      { label: 'T6', value: 81 },
      { label: 'T7', value: 84 },
      { label: 'T8', value: 86 },
      { label: 'T9', value: 88 },
      { label: 'T10', value: 89 },
    ],
    byProcess: [
      { label: 'Mua hàng', value: 86 },
      { label: 'Sự cố IT', value: 94 },
    ],
  },
  {
    id: 'rejection_rate',
    label: 'Rejection rate',
    unit: 'percent',
    description: 'Instance bị từ chối cuối trên tổng instance đã có kết quả. Không gộp returned.',
    goodDirection: 'down',
    monthly: [
      { label: 'T5', value: 9 },
      { label: 'T6', value: 8 },
      { label: 'T7', value: 7 },
      { label: 'T8', value: 6 },
      { label: 'T9', value: 5 },
      { label: 'T10', value: 4 },
    ],
    byProcess: [
      { label: 'Mua hàng', value: 5 },
      { label: 'Sự cố IT', value: 2 },
    ],
  },
  {
    id: 'sla_breach',
    label: 'SLA breach rate',
    unit: 'percent',
    description: 'Task vượt SLA trên số task có SLA hợp lệ — cần chính sách thời gian làm việc.',
    goodDirection: 'down',
    monthly: [
      { label: 'T5', value: 22 },
      { label: 'T6', value: 19 },
      { label: 'T7', value: 16 },
      { label: 'T8', value: 14 },
      { label: 'T9', value: 12 },
      { label: 'T10', value: 11 },
    ],
    byProcess: [
      { label: 'Mua hàng', value: 12 },
      { label: 'Sự cố IT', value: 8 },
    ],
  },
  {
    id: 'rework_rate',
    label: 'Rework rate',
    unit: 'percent',
    description: 'Instance có ít nhất một vòng trả về trên tổng instance hợp lệ.',
    goodDirection: 'down',
    monthly: [
      { label: 'T5', value: 18 },
      { label: 'T6', value: 16 },
      { label: 'T7', value: 15 },
      { label: 'T8', value: 13 },
      { label: 'T9', value: 11 },
      { label: 'T10', value: 10 },
    ],
    byProcess: [
      { label: 'Mua hàng', value: 11 },
      { label: 'Sự cố IT', value: 8 },
    ],
  },
];

export function seriesFor(metric: MetricDefinition, dimension: Dimension): MetricPoint[] {
  return dimension === 'monthly' ? [...metric.monthly] : [...metric.byProcess];
}

export function formatMetricValue(metric: MetricDefinition, value: number): string {
  switch (metric.unit) {
    case 'percent':
      return `${NUMBER.format(value)}%`;
    case 'days':
      return `${NUMBER.format(value)} ngày`;
    case 'hours':
      return `${NUMBER.format(value)} giờ`;
    default:
      return NUMBER.format(value);
  }
}

export interface MetricDelta {
  absolute: number;
  direction: 'up' | 'down' | 'flat';
  /** Whether the movement is an improvement for this metric. */
  improvement: boolean;
  label: string;
}

/** deltaBetween compares the last two points of a series. */
export function deltaBetween(
  metric: MetricDefinition,
  series: readonly MetricPoint[],
): MetricDelta | null {
  if (series.length < 2) {
    return null;
  }
  const current = series[series.length - 1].value;
  const previous = series[series.length - 2].value;
  const absolute = current - previous;

  if (absolute === 0) {
    return { absolute: 0, direction: 'flat', improvement: false, label: 'không đổi' };
  }

  const direction = absolute > 0 ? 'up' : 'down';
  const improvement = (direction === 'up') === (metric.goodDirection === 'up');
  const sign = absolute > 0 ? '+' : '−';
  const magnitude = Math.abs(absolute);

  return {
    absolute,
    direction,
    improvement,
    label: `${sign}${NUMBER.format(magnitude)} so với kỳ trước`,
  };
}
