import type { DurationStats, ProcessMetricsOverview } from '@opvaryn/contracts';

/**
 * Formatting for the operational read model. Pure and tested: the numbers come from the
 * server, and turning seconds into something a person reads is the only thing that
 * happens here.
 */

const DAY_SECONDS = 24 * 60 * 60;

/** formatDuration renders a duration in seconds the way an operator reads it. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 giây';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} giây`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} phút`;
  }
  if (seconds < DAY_SECONDS) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes === 0 ? `${hours} giờ` : `${hours} giờ ${minutes} phút`;
  }
  const days = seconds / DAY_SECONDS;
  return `${days.toFixed(days < 10 ? 1 : 0).replace('.', ',')} ngày`;
}

/** formatRate renders a 0..1 rate as a percentage, or says there is no data yet. */
export function formatRate(rate: number | undefined | null): string {
  if (rate === undefined || rate === null || !Number.isFinite(rate)) {
    return 'chưa có dữ liệu';
  }
  return `${(rate * 100).toFixed(1).replace('.', ',')}%`;
}

/** durationLabel says what one duration summary rests on. */
export function durationLabel(stats: DurationStats): string {
  if (stats.samples === 0) {
    return 'chưa có mẫu nào trong cửa sổ này';
  }
  return `${formatDuration(stats.averageSeconds)} trung bình · ${formatDuration(
    stats.medianSeconds,
  )} trung vị · ${stats.samples} mẫu`;
}

/** finishedCount is how many instances reached a terminal state in the window. */
export function finishedCount(overview: ProcessMetricsOverview): number {
  return overview.instances.completed + overview.instances.rejected;
}

/** reworkedLabel explains the rework rate in words, because a share needs a numerator. */
export function reworkedLabel(overview: ProcessMetricsOverview): string {
  const reworked = Math.round((overview.reworkRate ?? 0) * overview.instances.started);
  return `${reworked} trên ${overview.instances.started} instance phải chạy lại`;
}
