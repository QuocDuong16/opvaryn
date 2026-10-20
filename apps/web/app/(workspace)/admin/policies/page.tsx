import { notFound } from 'next/navigation';
import type { WorkPolicy } from '@opvaryn/contracts';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { WorkPolicyForm } from '@/components/admin/work-policy-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Chính sách việc' };

export default async function AdminPoliciesPage() {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  let objects: { key: string; name: string; policy: WorkPolicy }[] = [];
  let error: string | null = null;
  try {
    const api = createServerApiClient();
    const definitions = (await api.listBusinessObjects({ limit: 100 })).data;
    objects = await Promise.all(
      definitions.map(async (object) => ({
        key: object.key,
        name: object.name,
        policy: await api.getWorkPolicy(object.key).catch(() => ({
          objectKey: object.key,
          defaultDueHours: 0,
          defaultPriority: 'normal',
          escalationRole: '',
        })),
      })),
    );
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Chính sách việc"
        lead="Mỗi loại việc có đồng hồ riêng: số giờ làm việc để hoàn thành, mức ưu tiên mặc định, và vai trò nhận việc khi quá hạn. Một bước của quy trình có thể khai riêng, khi đó phần khai của bước được dùng."
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      {objects.length === 0 && !error ? (
        <Card>
          <CardTitle>Chưa có loại việc nào</CardTitle>
          <CardDescription>
            Tạo một loại dữ liệu trước, rồi quay lại đây để đặt chính sách của nó.
          </CardDescription>
        </Card>
      ) : null}

      <div className="space-y-4">
        {objects.map((object) => (
          <WorkPolicyForm
            key={object.key}
            objectKey={object.key}
            objectName={object.name}
            policy={object.policy}
          />
        ))}
      </div>
    </>
  );
}
