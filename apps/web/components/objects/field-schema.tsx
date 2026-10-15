import type { BusinessObject } from '@opvaryn/contracts';

import { FIELD_TYPE_LABELS } from '@/lib/format';

/** FieldSchema renders the configured field definitions of one business object. */
export function FieldSchema({ object }: { object: BusinessObject }) {
  if (object.fields.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
        Object chưa có field nào. Schema được khai báo khi tạo object; chỉnh sửa schema sau khi có
        bản ghi thuộc phạm vi MVP.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Nhãn
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Kiểu
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Bắt buộc
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Lựa chọn
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface-raised/40">
          {object.fields.map((field) => (
            <tr key={field.key}>
              <td className="px-4 py-3">{field.label}</td>
              <td className="px-4 py-3 text-on-surface-muted">{FIELD_TYPE_LABELS[field.type]}</td>
              <td className="px-4 py-3">
                {field.required ? (
                  <span className="text-danger">Bắt buộc</span>
                ) : (
                  <span className="text-on-surface-muted">Tuỳ chọn</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-on-surface-muted">
                {field.options && field.options.length > 0
                  ? field.options.map((option) => option.label).join(' · ')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
