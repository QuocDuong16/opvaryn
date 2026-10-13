import { describe, expect, it } from 'vitest';
import type { BusinessObject, FieldType } from '@opvaryn/contracts';

import { recordValuesFromForm } from '@/components/forms/record-values';

function objectWithFields(fields: readonly { key: string; type: FieldType }[]): BusinessObject {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    key: 'purchase_request',
    name: 'Đề nghị mua hàng',
    fields: fields.map((field) => ({ ...field, label: field.key, required: false })),
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
  };
}

function formDataOf(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

describe('recordValuesFromForm', () => {
  const object = objectWithFields([
    { key: 'title', type: 'text' },
    { key: 'estimated_amount', type: 'number' },
    { key: 'needed_by', type: 'date' },
    { key: 'department', type: 'select' },
    { key: 'items', type: 'rows' },
  ]);

  it('converts each control by its field type', () => {
    const values = recordValuesFromForm(
      object,
      formDataOf({
        title: '  MacBook Pro 14  ',
        estimated_amount: '52900000',
        needed_by: '2026-11-01',
        department: 'ky_thuat',
        items: 'MacBook Pro 14\n  AppleCare+  \n\n',
      }),
    );

    expect(values).toEqual({
      title: 'MacBook Pro 14',
      estimated_amount: 52900000,
      needed_by: '2026-11-01',
      department: 'ky_thuat',
      items: ['MacBook Pro 14', 'AppleCare+'],
    });
  });

  it('omits blank inputs so the server decides what is required', () => {
    const values = recordValuesFromForm(
      object,
      formDataOf({ title: 'Chỉ có tiêu đề', estimated_amount: '   ', items: '' }),
    );

    expect(values).toEqual({ title: 'Chỉ có tiêu đề' });
  });

  it('passes a non-numeric number through so the API names the problem', () => {
    const values = recordValuesFromForm(object, formDataOf({ estimated_amount: '52,9 triệu' }));

    expect(values.estimated_amount).toBe('52,9 triệu');
  });

  it('ignores form keys that are not fields of the object', () => {
    const values = recordValuesFromForm(
      object,
      formDataOf({ title: 'Hợp lệ', objectKey: 'purchase_request', injected: 'x' }),
    );

    expect(values).toEqual({ title: 'Hợp lệ' });
  });
});
