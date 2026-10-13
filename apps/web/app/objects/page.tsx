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
        lead="Định nghĩa dữ liệu nghiệp vụ: schema, field có kiểu rõ ràng và key ổn định. Đây là lát cắt chạy thật đầu tiên của demo — dữ liệu đi qua API Go và lưu trong PostgreSQL."
        aside={<StatusBadge kind={error ? 'mock' : 'live'} />}
      />

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-on-surface-muted">
            make docker-up{'\n'}cd apps/api &amp;&amp; go run ./cmd/migrate{'\n'}make dev
          </pre>
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
