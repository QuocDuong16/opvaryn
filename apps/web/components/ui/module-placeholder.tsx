import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge';

interface ModulePlaceholderProps {
  eyebrow: string;
  title: string;
  lead: string;
  stage: StatusKind;
  /** What this module will do, taken from the playbook module map. */
  features: readonly string[];
  /** Scope reminder: what belongs to the demo and what waits for the MVP. */
  note: string;
}

/**
 * ModulePlaceholder is the shared skeleton screen for demo modules whose feature
 * work has not started. It states the planned capability and its honest status
 * instead of pretending to implement it.
 */
export function ModulePlaceholder({
  eyebrow,
  title,
  lead,
  stage,
  features,
  note,
}: ModulePlaceholderProps) {
  return (
    <>
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
            {eyebrow}
          </p>
          <StatusBadge kind={stage} />
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-on-surface-muted">{lead}</p>
      </div>

      <Card>
        <CardTitle>Phạm vi dự kiến</CardTitle>
        <CardDescription>Lấy từ bản đồ module trong operations playbook.</CardDescription>
        <ul className="mt-4 space-y-2 text-sm">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2.5">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="mt-6 rounded-lg border border-dashed border-border-strong px-4 py-3 text-xs leading-relaxed text-on-surface-muted">
        {note}
      </p>
    </>
  );
}
