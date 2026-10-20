import { formatClock } from '@/lib/format';

/**
 * The sign-in cooldown, as the administration screen shows it (ADR 0028). The API says when
 * the wait ends; this module turns that into what a person needs to read, and it is pure so
 * the rule can be tested without a screen.
 */

export interface CooldownState {
  /** True while the account is waiting out a sign-in cooldown. */
  locked: boolean;
  /** The moment the wait ends, or null when the account can sign in normally. */
  until: Date | null;
  /** The moment as it reads on a screen, or null when the account is not waiting. */
  clock: string | null;
}

const FREE: CooldownState = { locked: false, until: null, clock: null };

/**
 * cooldownState reads the moment the API reported as `lockedUntil`. A moment that already
 * passed means the wait is over, so the account is free — the screen must not keep a badge
 * that says otherwise.
 */
export function cooldownState(
  lockedUntil: string | null | undefined,
  now: Date = new Date(),
): CooldownState {
  if (!lockedUntil) {
    return FREE;
  }
  const until = new Date(lockedUntil);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
    return FREE;
  }
  return { locked: true, until, clock: formatClock(until) };
}
