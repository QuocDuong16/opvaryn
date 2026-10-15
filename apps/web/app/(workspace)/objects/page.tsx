import type { BusinessObject } from '@opvaryn/contracts';

import { CreateObjectForm } from '@/components/objects/create-object-form';
import { ObjectList } from '@/components/objects/object-list';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Business Objects' };

export default async function ObjectsPage() {
  let objects: BusinessObject[] = [];
  let error: string | null = null;

  try {
    objects = await createServerApiClient().listBusinessObjects();
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="02 / Business objects"
        title="Business Objects"
        lead="Định nghĩa dữ liệu nghiệp vụ: các field có kiểu rõ ràng và khoá ổn định. Sửa định nghĩa là publish phiên bản mới; bản ghi cũ giữ nguyên định nghĩa lúc được tạo. Mở một định nghĩa để nhập bản ghi."
        aside={error ? undefined : <StatusBadge kind="live" />}
      />

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <p className="mt-4 text-sm text-on-surface-muted">
            Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
            Đã định nghĩa ({objects.length})
          </h2>
          <ObjectList objects={objects} />
        </section>

        <aside>
          <CreateObjectForm />
        </aside>
      </div>
    </>
  );
}
