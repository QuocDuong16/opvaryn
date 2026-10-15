import Link from 'next/link';
import type { BusinessObject } from '@opvaryn/contracts';

import { formatTimestamp } from '@/lib/format';

/** ObjectList renders the business object definitions stored in the database. */
export function ObjectList({ objects }: { objects: BusinessObject[] }) {
  if (objects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
        <p className="text-sm font-medium">Chưa có business object nào</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-on-surface-muted">
          Tạo định nghĩa đầu tiên ở biểu mẫu bên cạnh, hoặc nạp bộ dữ liệu mẫu bằng Ví dụ:{' '}
          <code className="font-mono text-xs">purchase_request</code> hoặc{' '}
          <code className="font-mono text-xs">it_incident</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Key
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Tên
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Fields
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Tạo lúc
            </th>
            <th scope="col" className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface-raised/40">
          {objects.map((object) => (
            <tr key={object.id}>
              <td className="px-4 py-3 font-mono text-xs">{object.key}</td>
              <td className="px-4 py-3">
                <Link
                  href={`/objects/${object.key}`}
                  className="font-medium hover:text-accent-strong"
                >
                  {object.name}
                </Link>
                {object.description ? (
                  <p className="mt-0.5 text-xs text-on-surface-muted">{object.description}</p>
                ) : null}
              </td>
              <td className="px-4 py-3 text-on-surface-muted">
                {object.fields.length}
                <span className="ml-1 text-xs">
                  ({object.fields.filter((field) => field.required).length} bắt buộc)
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-on-surface-muted">
                {formatTimestamp(object.createdAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/objects/${object.key}`}
                  className="text-xs font-medium text-accent-strong hover:underline"
                >
                  Nhập bản ghi →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
