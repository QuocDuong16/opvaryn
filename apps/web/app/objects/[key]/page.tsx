import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, type BusinessObject, type ObjectRecord } from '@opvaryn/contracts';

import { ObjectForm } from '@/components/forms/object-form';
import { FieldSchema } from '@/components/objects/field-schema';
import { RecordList } from '@/components/objects/record-list';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Business object ${key}` };
}

export default async function ObjectDetailPage({ params }: PageProps) {
  const { key } = await params;
  const api = createServerApiClient();

  let object: BusinessObject | null = null;
  let records: ObjectRecord[] = [];
  let error: string | null = null;

  try {
    object = await api.getBusinessObject(key);
    records = await api.listObjectRecords(key);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      notFound();
    }
    error = describeApiError(cause);
  }

  if (!object) {
    return (
      <>
        <PageHeader
          eyebrow="02 / Business objects"
          title={key}
          lead="Không đọc được định nghĩa này từ API."
          aside={<StatusBadge kind="mock" />}
        />
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            ← Về danh sách business object
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`02 / Business objects · ${object.key}`}
        title={object.name}
        lead={
          object.description ??
          'Định nghĩa dữ liệu nghiệp vụ với field có kiểu rõ ràng. Form nhập liệu bên dưới được sinh trực tiếp từ schema này.'
        }
        aside={<StatusBadge kind="live" />}
      />

      <p className="mb-6 text-sm">
        <Link href="/objects" className="text-on-surface-muted hover:text-on-surface">
          ← Tất cả business object
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              Field schema ({object.fields.length})
            </h2>
            <FieldSchema object={object} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              Bản ghi đã lưu ({records.length})
            </h2>
            <RecordList object={object} records={records} />
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardTitle>Nhập bản ghi</CardTitle>
            <CardDescription>
              Form sinh từ schema, validate ở server theo đúng field definition trước khi ghi vào
              PostgreSQL.
            </CardDescription>
            <div className="mt-4">
              <ObjectForm object={object} />
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
