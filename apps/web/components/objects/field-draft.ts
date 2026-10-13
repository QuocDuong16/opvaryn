import type { FieldDefinition, FieldOption, FieldType } from '@opvaryn/contracts';

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
}

export const EMPTY_FIELD_DRAFT: FieldDraft = {
  key: '',
  label: '',
  type: 'text',
  required: false,
  options: '',
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
    definitions.push(definition);
  }

  return definitions;
}
