import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Card is the standard raised surface for demo content. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface-raised p-5', className)}
      {...props}
    />
  );
}

/** CardTitle renders the heading line inside a Card. */
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold tracking-tight', className)} {...props} />;
}

/** CardDescription is the muted supporting line under a CardTitle. */
export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('mt-1 text-sm text-on-surface-muted', className)} {...props} />;
}
