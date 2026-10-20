import { notFound } from 'next/navigation';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { LookupSourceForm, type LookupSource } from '@/components/admin/lookup-source-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';

/** How a write-back stands, in the words of the person who reads it. */
const WRITEBACK_STATUS_LABELS: Record<string, string> = {
  pending: 'Đang chờ',
  delivered: 'Đã gửi',
  failed: 'Không gửi được',
  conflict: 'Xung đột',
  rejected: 'Bị từ chối',
};

export const metadata = { title: 'Tra cứu ngoài' };

export default async function AdminLookupsPage() {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  let definitions: {
    key: string;
    name: string;
    fields: { key: string; label: string }[];
    allFields: { key: string; label: string }[];
  }[] = [];
  const sources: Record<string, LookupSource> = {};
  let writebacks: Awaited<
    ReturnType<ReturnType<typeof createServerApiClient>['listLookupWritebacks']>
  >['data'] = [];
  let error: string | null = null;
  try {
    const api = createServerApiClient();
    const objects = (await api.listBusinessObjects({ limit: 100 })).data;
    definitions = objects.map((object) => ({
      key: object.key,
      name: object.name,
      fields: object.fields
        .filter((field) => field.type === 'select')
        .map((field) => ({ key: field.key, label: field.label })),
      allFields: object.fields.map((field) => ({ key: field.key, label: field.label })),
    }));
    for (const object of objects) {
      const lookups = await api.listLookups(object.key).catch(() => ({ data: [] }));
      for (const lookup of lookups.data) {
        sources[`${object.key}.${lookup.fieldKey}`] = {
          url: lookup.url,
          writeUrl: lookup.writeUrl ?? '',
          writeFields: lookup.writeFields ?? [],
        };
      }
    }
    writebacks = (await api.listLookupWritebacks({ limit: 20 })).data;
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Tra cứu ngoài"
        lead='Một trường lựa chọn có thể lấy danh sách của mình từ hệ thống khác — danh mục nhà cung cấp, danh sách nhân viên. Nguồn trả về một tài liệu JSON nhỏ: {"options": [{"value": "…", "label": "…"}]}.'
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      {definitions.length === 0 && !error ? (
        <Card>
          <CardTitle>Chưa có loại dữ liệu nào</CardTitle>
          <CardDescription>Tạo một loại dữ liệu trước, rồi quay lại đây.</CardDescription>
        </Card>
      ) : null}

      <div className="space-y-4">
        {definitions.map((definition) => (
          <LookupSourceForm
            key={definition.key}
            objectKey={definition.key}
            objectName={definition.name}
            fields={definition.fields}
            allFields={definition.allFields}
            sources={sources}
          />
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Lần ghi gần đây</h2>
        <Card>
          <CardDescription>
            Mỗi lần một bản ghi được gửi tới hệ thống ngoài đều được ghi lại ở đây. Một lần đứng ở
            trạng thái <strong>Xung đột</strong> nghĩa là bản ghi đã được ai đó sửa trong lúc chờ,
            nên bản sửa của hệ thống ngoài chưa được áp dụng — cần người quyết định.
          </CardDescription>

          {writebacks.length === 0 ? (
            <p className="mt-4 text-sm text-on-surface-muted">Chưa có lần ghi nào được ghi lại.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Loại dữ liệu
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Trường
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Trạng thái
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Số lần thử
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Lý do
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tạo lúc
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-raised/40">
                  {writebacks.map((writeback) => (
                    <tr key={writeback.id}>
                      <td className="px-4 py-3 align-top text-xs">{writeback.objectKey}</td>
                      <td className="px-4 py-3 align-top text-xs">{writeback.fieldKey}</td>
                      <td className="px-4 py-3 align-top text-xs">
                        {WRITEBACK_STATUS_LABELS[writeback.status] ?? writeback.status}
                      </td>
                      <td className="px-4 py-3 align-top text-xs">{writeback.attempts}</td>
                      <td className="px-4 py-3 align-top text-xs text-on-surface-muted">
                        {writeback.lastError ?? '—'}
                      </td>
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap text-on-surface-muted">
                        {formatTimestamp(writeback.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
