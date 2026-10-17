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

/**
 * fieldNames maps a field key to the label a person reads, for one definition. The key is what
 * a condition or a metric stores; the label is what the screen says.
 */
export function fieldNames(object: {
  fields: readonly { key: string; label: string }[];
}): Map<string, string> {
  return new Map(object.fields.map((field) => [field.key, field.label]));
}

/** joinLabels renders several keys as one line, each replaced by its name when it has one. */
export function joinLabels(keys: readonly string[], labels: ReadonlyMap<string, string>): string {
  return keys.map((key) => labelOrKey(labels.get(key), key)).join(', ');
}

/**
 * keyFromLabel turns a human label into the key the system stores — "Họ tên nhân viên" becomes
 * ho_ten_nhan_vien. A designer types a name; nobody should have to know what snake_case means
 * (ADR 0018). The result is a suggestion: it is written into the form's key field, where it can
 * still be edited before saving.
 */
export function keyFromLabel(label: string): string {
  const ascii = label
    .normalize('NFD')
    // Combining marks carry the Vietnamese tones; the base letters stay.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

  const slug = ascii
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  if (slug === '') {
    return '';
  }
  // A key must start with a letter and be at least two characters long.
  const withLetter = /^[a-z]/.test(slug) ? slug : `k_${slug}`;
  return withLetter.length >= 2 ? withLetter : `${withLetter}_1`;
}

/**
 * designerRoleName is what the interface calls the role that may change definitions. The name is
 * data (`role_labels`); when nobody has named it, the sentence reads as prose rather than as a
 * key (ADR 0016).
 */
export function designerRoleName(catalogue: readonly RoleEntry[]): string {
  return labelOrKey(
    catalogue.find((entry) => entry.key === 'process_designer')?.label,
    'vai trò thiết kế quy trình',
  );
}
