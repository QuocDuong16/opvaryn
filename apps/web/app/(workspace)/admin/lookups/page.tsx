import { notFound } from 'next/navigation';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { LookupSourceForm } from '@/components/admin/lookup-source-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Tra cứu ngoài' };

export default async function AdminLookupsPage() {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  let definitions: { key: string; name: string; fields: { key: string; label: string }[] }[] = [];
  const sources: Record<string, string> = {};
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
    }));
    for (const object of objects) {
      const lookups = await api.listLookups(object.key).catch(() => ({ data: [] }));
      for (const lookup of lookups.data) {
        sources[`${object.key}.${lookup.fieldKey}`] = lookup.url;
      }
    }
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
            sources={sources}
          />
        ))}
      </div>
    </>
  );
}
