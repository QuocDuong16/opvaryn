import type { BusinessObject, ObjectRecord } from '@opvaryn/contracts';

import { formatFieldValue, formatTimestamp } from '@/lib/format';

/**
 * RecordList renders the stored records of one business object. Columns follow the
 * field schema, so the table changes shape with the definition, not with code.
 */
export function RecordList({
  object,
  records,
}: {
  object: BusinessObject;
  records: ObjectRecord[];
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
        <p className="text-sm font-medium">Chưa có bản ghi nào</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-on-surface-muted">
          Nhập bản ghi đầu tiên ở biểu mẫu phía trên. Dữ liệu sẽ được validate theo schema của{' '}
          <code className="font-mono text-xs">{object.key}</code> trước khi lưu.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              #
            </th>
            {object.fields.map((field) => (
              <th key={field.key} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                {field.label}
              </th>
            ))}
            <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
              Tạo lúc
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface-raised/40">
          {records.map((record, index) => (
            <tr key={record.id}>
              <td className="px-4 py-3 font-mono text-xs text-on-surface-muted">
                {records.length - index}
              </td>
              {object.fields.map((field) => (
                <td key={field.key} className="px-4 py-3 align-top">
                  {formatFieldValue(field, record.values[field.key])}
                </td>
              ))}
              <td className="px-4 py-3 text-xs whitespace-nowrap text-on-surface-muted">
                {formatTimestamp(record.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
