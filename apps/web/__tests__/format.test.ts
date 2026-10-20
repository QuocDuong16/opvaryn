import { describe, expect, it } from 'vitest';

import { formatFieldValue, primaryFieldValue } from '@/lib/format';

// The value a person reads must follow the kind of its field: a computed field is a
// number, and a table says how many rows it holds (ADR 0036).
describe('formatFieldValue', () => {
  it('reads a computed field as a number', () => {
    expect(formatFieldValue({ type: 'formula' }, 7500000)).toBe('7.500.000');
  });

  it('says how many rows a table holds', () => {
    expect(formatFieldValue({ type: 'table' }, [{ ten_mon: 'Màn hình' }])).toBe('1 dòng');
  });

  it('reads a number as a number', () => {
    expect(formatFieldValue({ type: 'number' }, 2500000)).toBe('2.500.000');
  });

  it('shows a dash when there is no value', () => {
    expect(formatFieldValue({ type: 'text' }, undefined)).toBe('—');
  });
});

// A record is named by its first text field; a table or a computed field is not a name.
describe('primaryFieldValue', () => {
  it('prefers the first text field', () => {
    const value = primaryFieldValue(
      [
        { key: 'items', label: 'Danh mục', type: 'table', required: false },
        { key: 'title', label: 'Nội dung', type: 'text', required: false },
      ],
      {
        id: 'r1',
        objectKey: 'o',
        objectVersion: 1,
        values: { title: 'Mua màn hình' },
        canEdit: false,
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
    );

    expect(value).toBe('Mua màn hình');
  });
});
