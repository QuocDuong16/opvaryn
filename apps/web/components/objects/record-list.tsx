import type { BusinessObjectVersion, ObjectRecord } from '@opvaryn/contracts';

import { fieldsForVersion, groupRecordsByVersion } from '@/components/objects/record-grouping';
import { formatFieldValue, formatTimestamp } from '@/lib/format';

/**
 * RecordList renders the stored records of one business object, grouped by the
 * definition version they were created under. Each group gets its own columns,
 * because a record is read with the schema that was in force when it was written
 * (playbook invariant 1) — an edit shows up as a new group, not as rewritten data.
 */
export function RecordList({
  versions,
  records,
}: {
  versions: readonly BusinessObjectVersion[];
  records: ObjectRecord[];
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
        <p className="text-sm font-medium">Chưa có bản ghi nào</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-on-surface-muted">
          Nhập bản ghi đầu tiên ở biểu mẫu phía trên. Dữ liệu sẽ được validate theo schema của phiên
          bản mới nhất trước khi lưu.
        </p>
      </div>
    );
  }

  const groups = groupRecordsByVersion(records, versions);
  const latest = versions[0]?.version;

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const fields = fieldsForVersion(group);
        const isLatest = group.versionNumber === latest;

        return (
          <section key={group.version?.id ?? 'orphaned'}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-on-surface-muted">
              {group.version ? (
                <>
                  <span className="font-mono">v{group.version.version}</span>
                  <span>
                    publish {formatTimestamp(group.version.publishedAt)} bởi{' '}
                    {group.version.publishedBy}
                  </span>
                  {isLatest ? (
                    <span className="rounded-full border border-success/40 px-2 py-0.5 text-success">
                      phiên bản đang dùng
                    </span>
                  ) : (
                    <span className="rounded-full border border-border px-2 py-0.5">
                      phiên bản cũ — bản ghi giữ nguyên schema
                    </span>
                  )}
                </>
              ) : (
                <span className="text-warning">
                  Bản ghi không tìm thấy phiên bản tương ứng — hiển thị thô để không mất dữ liệu
                </span>
              )}
              <span>· {group.records.length} bản ghi</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      #
                    </th>
                    {fields.map((field) => (
                      <th
                        key={field.key}
                        scope="col"
                        className="px-4 py-3 font-medium whitespace-nowrap"
                      >
                        {field.label}
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                      Tạo lúc
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-raised/40">
                  {group.records.map((record, index) => (
                    <tr key={record.id}>
                      <td className="px-4 py-3 font-mono text-xs text-on-surface-muted">
                        {group.records.length - index}
                      </td>
                      {fields.map((field) => (
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
          </section>
        );
      })}
    </div>
  );
}
