import { describe, expect, it } from 'vitest';

import {
  definitionsToDrafts,
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
        formula: '',
        visibleWhen: '',
        columns: [],
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

  it('keeps the kind of every column of a table', () => {
    const definitions = fieldDraftsToDefinitions([
      {
        ...EMPTY_FIELD_DRAFT,
        key: 'items',
        label: 'Danh sách món',
        type: 'table',
        columns: [
          { key: 'ten_mon', label: 'Tên món', type: 'text' },
          { key: 'gia', label: 'Giá', type: 'number' },
          { key: 'ngay', label: 'Ngày', type: 'date' },
        ],
      },
    ]);

    expect(definitions[0]?.columns).toEqual([
      { key: 'ten_mon', label: 'Tên món', type: 'text' },
      { key: 'gia', label: 'Giá', type: 'number' },
      { key: 'ngay', label: 'Ngày', type: 'date' },
    ]);
  });

  it('drops a column without a key and keeps the rest', () => {
    const definitions = fieldDraftsToDefinitions([
      {
        ...EMPTY_FIELD_DRAFT,
        key: 'items',
        label: 'Danh sách món',
        type: 'table',
        columns: [
          { key: '', label: 'Chưa đặt tên', type: 'text' },
          { key: 'gia', label: 'Giá', type: 'number' },
        ],
      },
    ]);

    expect(definitions[0]?.columns).toEqual([{ key: 'gia', label: 'Giá', type: 'number' }]);
  });
});

describe('definitionsToDrafts', () => {
  it('round-trips a definition through the editor rows', () => {
    const definitions = [
      { key: 'title', label: 'Nội dung', type: 'text' as const, required: true },
      { key: 'amount', label: 'Số tiền', type: 'number' as const, required: false },
      {
        key: 'department',
        label: 'Bộ phận',
        type: 'select' as const,
        required: true,
        options: [
          { value: 'ky_thuat', label: 'Kỹ thuật' },
          { value: 'kinh_doanh', label: 'Kinh doanh' },
        ],
      },
    ];

    expect(fieldDraftsToDefinitions(definitionsToDrafts(definitions))).toEqual(definitions);
  });

  it('writes an option whose label matches its value as a bare line', () => {
    const drafts = definitionsToDrafts([
      {
        key: 'state',
        label: 'Trạng thái',
        type: 'select',
        required: false,
        options: [
          { value: 'in_use', label: 'in_use' },
          { value: 'retired', label: 'Đã thanh lý' },
        ],
      },
    ]);

    expect(drafts[0]?.options).toBe('in_use\nretired = Đã thanh lý');
  });

  it('treats a missing required flag as optional', () => {
    const drafts = definitionsToDrafts([
      { key: 'note', label: 'Ghi chú', type: 'text', required: false },
    ]);
    expect(drafts[0]?.required).toBe(false);
  });

  it('brings the columns of a table back with their kind', () => {
    const drafts = definitionsToDrafts([
      {
        key: 'items',
        label: 'Danh sách món',
        type: 'table',
        required: false,
        columns: [
          { key: 'gia', label: 'Giá', type: 'number' },
          { key: 'ngay', label: 'Ngày', type: 'date' },
        ],
      },
    ]);

    expect(drafts[0]?.columns).toEqual([
      { key: 'gia', label: 'Giá', type: 'number' },
      { key: 'ngay', label: 'Ngày', type: 'date' },
    ]);
  });
});
