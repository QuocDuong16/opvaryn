import Link from 'next/link';
import type { BusinessObject } from '@opvaryn/contracts';

import { formatTimestamp } from '@/lib/format';

/**
 * ObjectList renders the business object definitions stored in the database. The name leads —
 * a person picks a definition by what it is called, and the key stays visible underneath
 * because it is what forms, workflows and reports reference (ADR 0016).
 */
export function ObjectList({
  objects,
  filtered = false,
}: {
  objects: BusinessObject[];
  /** True when a search is narrowing the list, so the empty state can say so. */
  filtered?: boolean;
}) {
  if (objects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
        <p className="text-sm font-medium">
          {filtered ? 'Không có định nghĩa nào khớp từ khoá' : 'Chưa có định nghĩa dữ liệu nào'}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-on-surface-muted">
          {filtered
            ? 'Thử từ khoá khác, hoặc xoá lọc để xem tất cả.'
            : 'Tạo định nghĩa đầu tiên ở mục bên dưới.'}
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
              Tên
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Fields
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Cập nhật
            </th>
            <th scope="col" className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface-raised/40">
          {objects.map((object) => (
            <tr key={object.id}>
              <td className="px-4 py-3">
                <Link
                  href={`/objects/${object.key}`}
                  className="font-medium hover:text-accent-strong"
                >
                  {object.name}
                </Link>
                <p className="mt-0.5 font-mono text-[11px] text-on-surface-muted">{object.key}</p>
                {object.description ? (
                  <p className="mt-1 text-xs text-on-surface-muted">{object.description}</p>
                ) : null}
              </td>
              <td className="px-4 py-3 align-top text-on-surface-muted">
                {object.fields.length}
                <span className="ml-1 text-xs">
                  ({object.fields.filter((field) => field.required).length} bắt buộc)
                </span>
              </td>
              <td className="px-4 py-3 align-top text-xs text-on-surface-muted">
                {formatTimestamp(object.updatedAt)}
              </td>
              <td className="px-4 py-3 text-right align-top">
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
