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
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';

interface PageProps {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ q?: string; offset?: string; ioffset?: string }>;
}

/** Records per page on the detail screen; the API does the slicing. */
const RECORDS_PER_PAGE = 25;
const INSTANCES_PER_PAGE = 10;

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Business object ${key}` };
}

export default async function ObjectDetailPage({ params, searchParams }: PageProps) {
  const { key } = await params;
  const { q, offset: rawOffset, ioffset: rawInstanceOffset } = await searchParams;
  const api = createServerApiClient();

  const query = (q ?? '').trim();
  const offset = pageOffset(rawOffset, RECORDS_PER_PAGE);
  const instanceOffset = pageOffset(rawInstanceOffset, INSTANCES_PER_PAGE);

  let object: BusinessObject | null = null;
  let versions: BusinessObjectVersion[] = [];
  let records: ObjectRecord[] = [];
  let recordTotal = 0;
  let definitions: ProcessDefinition[] = [];
  let instances: ProcessInstanceSummary[] = [];
  let instanceTotal = 0;
  let error: string | null = null;

  try {
    object = await api.getBusinessObject(key);
    const [versionList, recordPage, definitionPage, instancePage] = await Promise.all([
      api.listBusinessObjectVersions(key),
      api.listObjectRecords(key, { q: query || undefined, limit: RECORDS_PER_PAGE, offset }),
      api.listProcessDefinitions({ limit: 100 }),
      api.listProcessInstances(
        { objectKey: key },
        { limit: INSTANCES_PER_PAGE, offset: instanceOffset },
      ),
    ]);
    versions = versionList;
    records = recordPage.data;
    recordTotal = recordPage.total;
    definitions = definitionPage.data;
    instances = instancePage.data;
    instanceTotal = instancePage.total;
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
        eyebrow="02 / Dữ liệu"
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                {`Bản ghi đã lưu (${recordTotal})`}
              </h2>
              <ListSearch
                basePath={`/objects/${object.key}`}
                value={query}
                placeholder="Tìm trong giá trị của bản ghi"
                label="Tìm bản ghi"
                keep={{ ioffset: instanceOffset > 0 ? String(instanceOffset) : undefined }}
              />
            </div>
            <RecordList versions={versions} records={records} filtered={query !== ''} />
            <Pagination
              total={recordTotal}
              limit={RECORDS_PER_PAGE}
              offset={offset}
              basePath={`/objects/${object.key}`}
              params={{
                q: query || undefined,
                ioffset: instanceOffset > 0 ? String(instanceOffset) : undefined,
              }}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              {`Quy trình trên các bản ghi này (${instanceTotal})`}
            </h2>
            <p className="mb-3 text-xs text-on-surface-muted">
              Danh sách này đọc theo phạm vi của bạn: một lần chạy hiện khi bản ghi của nó hiện. Lần
              chạy đã kết thúc vẫn nằm đây và mở được, kể cả khi không còn việc nào trong hộp việc.
            </p>
            <InstanceList
              instances={instances}
              recordLabels={recordLabels(records, versions)}
              definitionNames={Object.fromEntries(
                definitions.map((definition) => [definition.key, definition.name]),
              )}
              emptyHint="Chạy một quy trình ở biểu mẫu bên phải để thấy một lần chạy, bước đang chờ và người giữ việc."
            />
            <Pagination
              total={instanceTotal}
              limit={INSTANCES_PER_PAGE}
              offset={instanceOffset}
              basePath={`/objects/${object.key}`}
              offsetParam="ioffset"
              params={{
                q: query || undefined,
                offset: offset > 0 ? String(offset) : undefined,
              }}
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
