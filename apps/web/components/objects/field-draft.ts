import type {
  FieldColumn,
  FieldCondition,
  FieldDefinition,
  FieldOption,
  FieldType,
} from '@opvaryn/contracts';

/**
 * FieldDraft is one row of the schema editor. It mirrors FieldDefinition, except
 * that select options are edited as text (one option per line) because that is
 * faster to type than a nested list of inputs.
 */
export interface FieldDraft {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string;
  /** The expression of a computed field (ADR 0032). */
  formula: string;
  /** The condition that shows the field, written as `field op value` (ADR 0032). */
  visibleWhen: string;
  /** The columns of a table field, one per line, `key = Nhãn` (ADR 0032). */
  columns: string;
}

export const EMPTY_FIELD_DRAFT: FieldDraft = {
  key: '',
  label: '',
  type: 'text',
  required: false,
  options: '',
  formula: '',
  visibleWhen: '',
  columns: '',
};

/**
 * parseOptionLines reads one option per line, written `value = Nhãn`. The value
 * part is required; when the label is omitted it defaults to the value.
 */
export function parseOptionLines(text: string): FieldOption[] {
  const options: FieldOption[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      options.push({ value: trimmed, label: trimmed });
      continue;
    }
    const value = trimmed.slice(0, separator).trim();
    const label = trimmed.slice(separator + 1).trim();
    options.push({ value, label: label === '' ? value : label });
  }
  return options;
}

/**
 * parseColumnLines reads the columns of a table field, one per line, written
 * `key = Nhãn`. The type of a column is not written here: the first version of a table
 * holds text, and the server keeps the column kinds it is given.
 */
export function parseColumnLines(text: string): FieldColumn[] {
  const columns: FieldColumn[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const separator = trimmed.indexOf('=');
    const key = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
    const label = (separator === -1 ? key : trimmed.slice(separator + 1).trim()).trim();
    if (key === '') {
      continue;
    }
    columns.push({ key, label: label === '' ? key : label, type: 'text' });
  }
  return columns;
}

/**
 * parseConditionLine reads a visibility rule written as `field op value`, for example
 * `quantity > 10` (ADR 0032).
 */
export function parseConditionLine(text: string): FieldCondition | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const match = /^([a-z][a-z0-9_]*)\s*(eq|ne|gt|gte|lt|lte)\s*(.*)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const raw = match[3].trim();
  let value: unknown = raw;
  if (raw !== '') {
    const number = Number(raw);
    if (Number.isFinite(number)) {
      value = number;
    }
  }
  return { field: match[1], op: match[2] as FieldCondition['op'], value };
}

/**
 * fieldDraftsToDefinitions serializes editor rows for the API request. Blank rows
 * are dropped; partially filled rows are kept so the server can name the exact
 * problem instead of silently discarding work.
 */
export function fieldDraftsToDefinitions(drafts: FieldDraft[]): FieldDefinition[] {
  const definitions: FieldDefinition[] = [];

  for (const draft of drafts) {
    if (draft.key.trim() === '' && draft.label.trim() === '') {
      continue;
    }
    const definition: FieldDefinition = {
      key: draft.key.trim(),
      label: draft.label.trim(),
      type: draft.type,
      required: draft.required,
    };
    if (draft.type === 'select') {
      definition.options = parseOptionLines(draft.options);
    }
    if (draft.type === 'formula' && draft.formula.trim() !== '') {
      definition.formula = draft.formula.trim();
    }
    if (draft.type === 'table' && draft.columns.trim() !== '') {
      definition.columns = parseColumnLines(draft.columns);
    }
    if (draft.visibleWhen.trim() !== '') {
      const condition = parseConditionLine(draft.visibleWhen);
      if (condition) {
        definition.visibleWhen = condition;
      }
    }
    definitions.push(definition);
  }

  return definitions;
}

/**
 * definitionsToDrafts is the inverse, used when the schema editor opens on an
 * existing definition (publishing a new version). Options become `value = Nhãn`
 * lines again; the two functions round-trip, which their test pins down.
 */
export function definitionsToDrafts(fields: readonly FieldDefinition[]): FieldDraft[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required ?? false,
    options: (field.options ?? [])
      .map((option) =>
        option.label === option.value ? option.value : `${option.value} = ${option.label}`,
      )
      .join('\n'),
    formula: field.formula ?? '',
    visibleWhen: field.visibleWhen
      ? `${field.visibleWhen.field} ${field.visibleWhen.op} ${String(field.visibleWhen.value ?? '')}`
      : '',
    columns: (field.columns ?? [])
      .map((column) =>
        column.label === column.key ? column.key : `${column.key} = ${column.label}`,
      )
      .join('\n'),
  }));
}
