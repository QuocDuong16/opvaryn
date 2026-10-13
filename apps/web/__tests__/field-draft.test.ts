import { describe, expect, it } from 'vitest';

import {
  EMPTY_FIELD_DRAFT,
  fieldDraftsToDefinitions,
  parseOptionLines,
} from '@/components/objects/field-draft';

describe('parseOptionLines', () => {
  it('reads value = label lines', () => {
    expect(parseOptionLines('kinh_doanh = Kinh doanh\nky_thuat = Kỹ thuật')).toEqual([
      { value: 'kinh_doanh', label: 'Kinh doanh' },
      { value: 'ky_thuat', label: 'Kỹ thuật' },
    ]);
  });

  it('falls back to the value when no label is given', () => {
    expect(parseOptionLines('normal')).toEqual([{ value: 'normal', label: 'normal' }]);
  });

  it('skips blank lines and trims both sides', () => {
    expect(parseOptionLines('\n  urgent = Gấp  \n\n')).toEqual([{ value: 'urgent', label: 'Gấp' }]);
  });
});

describe('fieldDraftsToDefinitions', () => {
  it('drops untouched rows', () => {
    expect(fieldDraftsToDefinitions([EMPTY_FIELD_DRAFT])).toEqual([]);
  });

  it('serializes a select row with its options', () => {
    const definitions = fieldDraftsToDefinitions([
      {
        key: ' department ',
        label: ' Bộ phận ',
        type: 'select',
        required: true,
        options: 'ky_thuat = Kỹ thuật',
      },
    ]);

    expect(definitions).toEqual([
      {
        key: 'department',
        label: 'Bộ phận',
        type: 'select',
        required: true,
        options: [{ value: 'ky_thuat', label: 'Kỹ thuật' }],
      },
    ]);
  });

  it('keeps a partially filled row so the server can name the problem', () => {
    const definitions = fieldDraftsToDefinitions([
      { ...EMPTY_FIELD_DRAFT, key: 'amount', label: '' },
    ]);

    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.key).toBe('amount');
  });

  it('never attaches options to non-select fields', () => {
    const definitions = fieldDraftsToDefinitions([
      { ...EMPTY_FIELD_DRAFT, key: 'note', label: 'Ghi chú', options: 'a = A' },
    ]);

    expect(definitions[0]?.options).toBeUndefined();
  });
});
