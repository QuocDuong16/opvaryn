import type { FieldCondition } from '@opvaryn/contracts';

/**
 * The condition of a field: the field is shown when it holds (ADR 0032). The rule is the
 * same as the one the server applies, so a form never shows a field the record will
 * refuse.
 */

/** evaluateCondition reports whether a field is shown. */
export function evaluateCondition(
  condition: FieldCondition | null | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) {
    return true;
  }
  const actual = values[condition.field];
  if (actual === undefined || actual === null || actual === '') {
    return false;
  }

  const expected = condition.value;
  switch (condition.op) {
    case 'eq':
      return sameValue(actual, expected);
    case 'ne':
      return !sameValue(actual, expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = asNumber(actual);
      const right = asNumber(expected);
      if (left === null || right === null) {
        return false;
      }
      if (condition.op === 'gt') {
        return left > right;
      }
      if (condition.op === 'gte') {
        return left >= right;
      }
      if (condition.op === 'lt') {
        return left < right;
      }
      return left <= right;
    }
    default:
      return false;
  }
}

/** sameValue compares two values the way the server does: numbers as numbers. */
function sameValue(actual: unknown, expected: unknown): boolean {
  const left = asNumber(actual);
  const right = asNumber(expected);
  if (left !== null && right !== null) {
    return left === right;
  }
  return String(actual) === String(expected);
}

/** asNumber reads a value as a number, when it is one. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && value.trim() !== '' ? parsed : null;
  }
  return null;
}
