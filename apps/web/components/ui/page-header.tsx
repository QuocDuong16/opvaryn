import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Section marker, e.g. "02 / BUSINESS OBJECTS". */
  eyebrow: string;
  title: string;
  lead: string;
  /** Optional right-hand slot, typically a StatusBadge. */
  aside?: ReactNode;
  className?: string;
}

/** PageHeader opens every screen with the same rhythm and marker. */
export function PageHeader({ eyebrow, title, lead, aside, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-8 flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
          {eyebrow}
        </p>
        {aside}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm leading-relaxed text-on-surface-muted">{lead}</p>
    </header>
  );
}
