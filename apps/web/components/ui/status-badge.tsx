import { cn } from '@/lib/utils';

/**
 * Delivery status of a screen or feature. Every demo surface must declare one:
 * the playbook requires that simulated behavior is never presented as real.
 */
export type StatusKind = 'live' | 'mock' | 'concept';

const LABELS: Record<StatusKind, string> = {
  live: 'Live',
  mock: 'Mock',
  concept: 'Concept',
};

const TITLES: Record<StatusKind, string> = {
  live: 'Chạy thật: dữ liệu thật qua API và database',
  mock: 'Mô phỏng: giao diện thật nhưng dữ liệu/hành vi giả lập',
  concept: 'Concept: minh họa tầm nhìn, chưa có hành vi thật',
};

const STYLES: Record<StatusKind, string> = {
  live: 'border-success/40 text-success',
  mock: 'border-warning/40 text-warning',
  concept: 'border-border-strong text-on-surface-muted',
};

export function StatusBadge({ kind, className }: { kind: StatusKind; className?: string }) {
  return (
    <span
      title={TITLES[kind]}
      className={cn(
        'inline-flex w-max items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STYLES[kind],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {LABELS[kind]}
    </span>
  );
}
