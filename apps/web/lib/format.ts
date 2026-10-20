import type { FieldDefinition, ObjectRecord } from '@opvaryn/contracts';

/** Vietnamese labels for the field types in the contract enum. */
export const FIELD_TYPE_LABELS: Record<FieldDefinition['type'], string> = {
  text: 'Văn bản',
  number: 'Số',
  date: 'Ngày',
  select: 'Lựa chọn',
  file: 'Tệp',
  rows: 'Danh sách dòng',
};

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const CLOCK_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** formatTimestamp renders an API timestamp deterministically for server output. */
export function formatTimestamp(value: string): string {
  return TIMESTAMP_FORMAT.format(new Date(value));
}

/**
 * formatClock renders the time of day of an instant, in the organisation's timezone. It is
 * the one place that decides how a moment reads on a screen.
 */
export function formatClock(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return CLOCK_FORMAT.format(date);
}

/**
 * formatDate renders an ISO date without timezone conversion: the value is a
 * calendar date, not an instant, so it must not shift across zones.
 */
export function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** formatFieldValue renders one stored value for display, following its field type. */
export function formatFieldValue(
  field: Pick<FieldDefinition, 'type' | 'options'>,
  value: unknown,
): string {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? NUMBER_FORMAT.format(value) : String(value);
    case 'date':
      return typeof value === 'string' ? formatDate(value) : String(value);
    case 'select': {
      const options = field.options ?? [];
      const match = options.find((option) => option.value === value);
      return match ? match.label : String(value);
    }
    case 'rows':
      return Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value);
    case 'file':
      // The stored value is the attachment identifier; a table shows the way in, not the id.
      return 'Tệp đính kèm';
    default:
      return String(value);
  }
}

/**
 * primaryFieldValue picks the value that identifies a record in a list: the first
 * text field by convention. It takes the field list rather than the object, because a
 * record is read with the definition version it was created under.
 *
 * A record without a readable name says so. It never prints its id: an identifier is
 * not a name, and a screen that shows one helps nobody (ADR 0018).
 */
export function primaryFieldValue(
  fields: readonly FieldDefinition[],
  record: ObjectRecord,
): string {
  const preferred = fields.find((field) => field.type === 'text') ?? fields[0];
  if (!preferred) {
    return 'Bản ghi chưa có tên';
  }
  const rendered = formatFieldValue(preferred, record.values[preferred.key]);
  return rendered === '—' ? 'Bản ghi chưa có tên' : rendered;
}
