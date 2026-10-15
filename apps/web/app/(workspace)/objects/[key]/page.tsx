import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApiError,
  type BusinessObject,
  type BusinessObjectVersion,
  type ObjectRecord,
  type ProcessDefinition,
  type ProcessInstanceSummary,
} from '@opvaryn/contracts';

import { ObjectForm } from '@/components/forms/object-form';
import { FieldSchema } from '@/components/objects/field-schema';
import { recordLabels } from '@/components/objects/record-labels';
import { InstanceList } from '@/components/process/instance-list';
import { StartInstanceForm } from '@/components/process/start-instance-form';
import { RecordList } from '@/components/objects/record-list';
import { UpdateObjectForm } from '@/components/objects/update-object-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';

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
  let versions: BusinessObjectVersion[] = [];
  let records: ObjectRecord[] = [];
  let definitions: ProcessDefinition[] = [];
  let instances: ProcessInstanceSummary[] = [];
  let error: string | null = null;

  try {
    object = await api.getBusinessObject(key);
    [versions, records, definitions, instances] = await Promise.all([
      api.listBusinessObjectVersions(key),
      api.listObjectRecords(key),
      api.listProcessDefinitions(),
      api.listProcessInstances({ objectKey: key }),
    ]);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      notFound();
    }
    error = describeApiError(cause);
  }

  // Only definitions bound to this object: the engine evaluates conditions against
  // the record's values, so a definition for another object has nothing to read.
  const usableDefinitions = definitions.filter((definition) => definition.objectKey === key);

  if (!object) {
    return (
      <>
        <PageHeader
          eyebrow="02 / Dữ liệu"
          title={key}
          lead="Không đọc được định nghĩa này từ API."
        />
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            ← Về danh sách dữ liệu
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`02 / Dữ liệu · ${object.key}`}
        title={object.name}
        lead={
          object.description ??
          'Định nghĩa dữ liệu nghiệp vụ với field có kiểu rõ ràng. Form nhập liệu bên dưới được sinh trực tiếp từ phiên bản đang dùng.'
        }
      />

      <p className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/objects" className="text-on-surface-muted hover:text-on-surface">
          ← Tất cả business object
        </Link>
        <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-xs text-on-surface-muted">
          phiên bản đang dùng v{object.version}
        </span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              Field schema — v{object.version} ({object.fields.length})
            </h2>
            <FieldSchema object={object} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              Lịch sử phiên bản ({versions.length})
            </h2>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Phiên bản
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Publish lúc
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Bởi
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Fields
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Lựa chọn
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-raised/40">
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td className="px-4 py-3 font-mono text-xs">
                        v{version.version}
                        {version.version === object.version ? (
                          <span className="ml-2 rounded-full border border-success/40 px-2 py-0.5 text-[10px] text-success">
                            đang dùng
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-muted">
                        {formatTimestamp(version.publishedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-muted">
                        {version.publishedBy}
                      </td>
                      <td className="px-4 py-3 text-on-surface-muted">{version.fields.length}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-on-surface-muted">
                        {version.fields.map((field) => field.key).join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              Bản ghi đã lưu ({records.length})
            </h2>
            <RecordList versions={versions} records={records} />
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                Quy trình trên các bản ghi này ({instances.length})
              </h2>
              <StatusBadge kind="live" />
            </div>
            <p className="mb-3 text-xs text-on-surface-muted">
              Danh sách instance đọc theo phạm vi của bạn: instance hiện khi bản ghi của nó hiện.
              Instance đã kết thúc vẫn nằm đây và mở được, kể cả khi không còn việc nào trong inbox.
            </p>
            <InstanceList
              instances={instances}
              recordLabels={recordLabels(records, versions)}
              emptyHint="Chạy một quy trình ở biểu mẫu bên phải để thấy instance, bước đang chờ và người giữ việc."
            />
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardTitle>Nhập bản ghi</CardTitle>
            <CardDescription>
              Form sinh từ v{object.version}, validate ở server theo đúng field definition trước khi
              được lưu lại.
            </CardDescription>
            <div className="mt-4">
              <ObjectForm object={object} />
            </div>
          </Card>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              Chạy quy trình
            </h2>
            <StartInstanceForm
              definitions={usableDefinitions}
              records={records}
              fields={object.fields}
            />
          </div>

          <UpdateObjectForm object={object} />
        </aside>
      </div>
    </>
  );
}
