import type { BusinessObject, FieldDefinition, ObjectRecord } from '@opvaryn/contracts';

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

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** formatTimestamp renders an API timestamp deterministically for server output. */
export function formatTimestamp(value: string): string {
  return TIMESTAMP_FORMAT.format(new Date(value));
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
    default:
      return String(value);
  }
}

/**
 * primaryFieldValue picks the value that identifies a record in a list: the first
 * text field by convention, falling back to the record id.
 */
export function primaryFieldValue(object: BusinessObject, record: ObjectRecord): string {
  const preferred = object.fields.find((field) => field.type === 'text') ?? object.fields[0];
  if (!preferred) {
    return record.id;
  }
  const rendered = formatFieldValue(preferred, record.values[preferred.key]);
  return rendered === '—' ? record.id : rendered;
}
