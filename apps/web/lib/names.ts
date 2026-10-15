import type { RoleEntry } from '@opvaryn/contracts';

/**
 * Names for the things the engine identifies by key. A key (`truong_bo_phan`, `ky_thuat`) is
 * what the database and the API compare; a person reading a screen must see the name. Where
 * nobody has named something yet, the key is still shown — hiding it would hide the role.
 */

/** labelOrKey returns the name when there is one, and the key otherwise. */
export function labelOrKey(label: string | undefined, key: string): string {
  const trimmed = label?.trim();
  return trimmed ? trimmed : key;
}

/** roleLabels indexes the role catalogue by key. */
export function roleLabels(entries: readonly RoleEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.key, entry.label]));
}

/** nameLabels indexes objects or definitions by key. */
export function nameLabels(items: readonly { key: string; name: string }[]): Map<string, string> {
  return new Map(items.map((item) => [item.key, item.name]));
}

/** joinLabels renders several keys as one line, each replaced by its name when it has one. */
export function joinLabels(keys: readonly string[], labels: ReadonlyMap<string, string>): string {
  return keys.map((key) => labelOrKey(labels.get(key), key)).join(', ');
}
