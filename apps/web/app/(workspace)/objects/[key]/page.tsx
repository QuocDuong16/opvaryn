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
import { RecordList } from '@/components/objects/record-list';
import { recordLabels } from '@/components/objects/record-labels';
import { resolveObjectTab } from '@/components/objects/object-tabs';
import { InstanceList } from '@/components/process/instance-list';
import { StartInstanceForm } from '@/components/process/start-instance-form';
import { UpdateObjectForm } from '@/components/objects/update-object-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { roleLabels } from '@/lib/names';

interface PageProps {
  params: Promise<{ key: string }>;
  searchParams: Promise<{
    tab?: string;
    q?: string;
    offset?: string;
    ioffset?: string;
    record?: string;
  }>;
}

/** Records per page on the records tab; the API does the slicing. */
const RECORDS_PER_PAGE = 25;
const INSTANCES_PER_PAGE = 10;
/** How many records the run form offers, and how far the record labels reach. */
const RUN_PICKER_LIMIT = 100;

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Dữ liệu ${key}` };
}

/**
 * One data definition, in three parts (ADR 0020): its fields, the records entered under it,
 * and the processes that have run on those records. Each part is a tab, because stacked on
 * one page they were four sections and two side panels deep and nothing could be found in
 * them; the tab is in the URL, so a link can point at one part directly.
 */
export default async function ObjectDetailPage({ params, searchParams }: PageProps) {
  const { key } = await params;
  const {
    tab: rawTab,
    q,
    offset: rawOffset,
    ioffset: rawInstanceOffset,
    record: rawRecord,
  } = await searchParams;
  const api = createServerApiClient();

  const tab = resolveObjectTab(rawTab);
  const query = (q ?? '').trim();
  const offset = pageOffset(rawOffset, RECORDS_PER_PAGE);
  const instanceOffset = pageOffset(rawInstanceOffset, INSTANCES_PER_PAGE);
  const recordId = (rawRecord ?? '').trim();

  let object: BusinessObject | null = null;
  let versions: BusinessObjectVersion[] = [];
  let namedRoles: Map<string, string> = new Map();
  let error: string | null = null;

  // What each tab needs, and nothing else: the tab bar's counts come from two one-row
  // reads, so opening the fields of a definition does not also load its records.
  let recordCount = 0;
  let instanceCount = 0;
  let records: ObjectRecord[] = [];
  let recordTotal = 0;
  let pickerRecords: ObjectRecord[] = [];
  let definitions: ProcessDefinition[] = [];
  let instances: ProcessInstanceSummary[] = [];
  let instanceTotal = 0;

  try {
    object = await api.getBusinessObject(key);
    const [versionList, roles, recordCountPage, instanceCountPage] = await Promise.all([
      api.listBusinessObjectVersions(key),
      // The role names are a nicety: a role nobody has named still reads as its key, so a
      // failed read must not take the screen down with it.
      api.listRoles().catch(() => []),
      api.listObjectRecords(key, { limit: 1 }),
      api.listProcessInstances({ objectKey: key }, { limit: 1 }),
    ]);
    versions = versionList;
    namedRoles = roleLabels(roles);
    recordCount = recordCountPage.total;
    instanceCount = instanceCountPage.total;

    if (tab === 'records') {
      const recordPage = await api.listObjectRecords(key, {
        q: query || undefined,
        limit: RECORDS_PER_PAGE,
        offset,
      });
      records = recordPage.data;
      recordTotal = recordPage.total;
    }

    if (tab === 'processes') {
      const [instancePage, definitionPage, picker] = await Promise.all([
        api.listProcessInstances(
          { objectKey: key, ...(recordId === '' ? {} : { recordId }) },
          { limit: INSTANCES_PER_PAGE, offset: instanceOffset },
        ),
        api.listProcessDefinitions({ limit: 100 }),
        api.listObjectRecords(key, { limit: RUN_PICKER_LIMIT }),
      ]);
      instances = instancePage.data;
      instanceTotal = instancePage.total;
      definitions = definitionPage.data;
      pickerRecords = picker.data;
    }
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

  // Only definitions bound to this object: the engine evaluates conditions against the
  // record's values, so a definition for another object has nothing to read.
  const usableDefinitions = definitions.filter((definition) => definition.objectKey === key);
  const labels = recordLabels(pickerRecords, versions);
  // The record a filtered run list is about, named when it is one of the records this
  // screen loaded — which it is whenever someone arrived here from that record's row.
  const filteredLabel = recordId === '' ? null : (labels[recordId] ?? null);

  return (
    <>
      <PageHeader
        eyebrow="02 / Dữ liệu"
        title={object.name}
        lead={
          object.description ??
          'Định nghĩa dữ liệu nghiệp vụ với các trường có kiểu rõ ràng. Màn nhập liệu được sinh trực tiếp từ phiên bản đang dùng.'
        }
      />

      <p className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/objects" className="text-on-surface-muted hover:text-on-surface">
          ← Tất cả dữ liệu
        </Link>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-on-surface-muted">
          {`phiên bản đang dùng v${object.version}`}
        </span>
        <Link
          href={`/forms?object=${object.key}`}
          className="text-xs font-medium text-accent-strong hover:underline"
        >
          Mở màn nhập liệu của loại dữ liệu này →
        </Link>
      </p>

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được hết dữ liệu của phần này</CardTitle>
          <CardDescription>{error}</CardDescription>
          <p className="mt-4 text-sm text-on-surface-muted">
            Phần còn lại của loại dữ liệu vẫn xem được. Nếu địa chỉ trang có tham số lạ, hãy mở lại
            từ danh sách dữ liệu.
          </p>
        </Card>
      ) : null}

      <Tabs
        label="Các phần của loại dữ liệu"
        active={tab}
        items={[
          {
            key: 'fields',
            label: 'Trường',
            href: `/objects/${object.key}`,
            count: object.fields.length,
          },
          {
            key: 'records',
            label: 'Bản ghi',
            href: `/objects/${object.key}?tab=records`,
            count: recordCount,
          },
          {
            key: 'processes',
            label: 'Quy trình',
            href: `/objects/${object.key}?tab=processes`,
            count: instanceCount,
          },
        ]}
      />

      {tab === 'fields' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-6">
            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                {`Các trường — phiên bản v${object.version} (${object.fields.length})`}
              </h2>
              <FieldSchema object={object} />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                {`Lịch sử phiên bản (${versions.length})`}
              </h2>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Phiên bản
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Phát hành lúc
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Bởi
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Số trường
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Các trường trong phiên bản này
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
                        <td className="px-4 py-3 text-[11px] text-on-surface-muted">
                          {version.fields.map((field) => field.label).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <UpdateObjectForm object={object} />
          </aside>
        </div>
      ) : null}

      {tab === 'records' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0">
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
                  keep={{ tab: 'records' }}
                />
              </div>
              <p className="mb-3 text-xs text-on-surface-muted">
                Bạn thấy bản ghi của bộ phận mình, bản ghi do mình tạo, và bản ghi đang có việc chờ
                bạn quyết định. Số trên tab đếm theo đúng phạm vi đó.
              </p>
              <RecordList
                versions={versions}
                records={records}
                filtered={query !== ''}
                runsHref={(record) => `/objects/${key}?tab=processes&record=${record.id}`}
              />
              <Pagination
                total={recordTotal}
                limit={RECORDS_PER_PAGE}
                offset={offset}
                basePath={`/objects/${object.key}`}
                params={{ tab: 'records', q: query || undefined }}
              />
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardTitle>Nhập bản ghi</CardTitle>
              <CardDescription>
                {`Màn nhập sinh từ phiên bản v${object.version}; dữ liệu được kiểm tra ở server theo đúng định nghĩa trước khi lưu.`}
              </CardDescription>
              <div className="mt-4">
                <ObjectForm object={object} />
              </div>
            </Card>
          </aside>
        </div>
      ) : null}

      {tab === 'processes' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0">
            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                {recordId === ''
                  ? `Quy trình trên các bản ghi này (${instanceTotal})`
                  : `Quy trình đã chạy trên bản ghi này (${instanceTotal})`}
              </h2>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-on-surface-muted">
                <span>
                  {filteredLabel
                    ? `Chỉ hiện các lần chạy của bản ghi “${filteredLabel}”.`
                    : recordId === ''
                      ? 'Danh sách này đọc theo phạm vi của bạn: một lần chạy hiện khi bản ghi của nó hiện. Lần chạy đã kết thúc vẫn nằm đây và mở được, kể cả khi không còn việc nào trong hộp việc.'
                      : 'Chỉ hiện các lần chạy của một bản ghi.'}
                </span>
                {recordId === '' ? null : (
                  <Link
                    href={`/objects/${object.key}?tab=processes`}
                    className="font-medium text-accent-strong hover:underline"
                  >
                    Bỏ lọc, xem tất cả
                  </Link>
                )}
              </p>
              <InstanceList
                instances={instances}
                recordLabels={labels}
                roleLabels={Object.fromEntries(namedRoles)}
                definitionNames={Object.fromEntries(
                  definitions.map((definition) => [definition.key, definition.name]),
                )}
                emptyHint={
                  recordId === ''
                    ? 'Chạy một quy trình ở khung bên phải để thấy một lần chạy, bước đang chờ và người giữ việc.'
                    : 'Bản ghi này chưa chạy quy trình nào. Chọn một quy trình ở khung bên phải rồi bấm Chạy quy trình.'
                }
              />
              <Pagination
                total={instanceTotal}
                limit={INSTANCES_PER_PAGE}
                offset={instanceOffset}
                basePath={`/objects/${object.key}`}
                offsetParam="ioffset"
                params={{ tab: 'processes', record: recordId || undefined }}
              />
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                Chạy quy trình
              </h2>
              <StartInstanceForm
                definitions={usableDefinitions}
                records={pickerRecords}
                fields={object.fields}
                recordId={recordId || undefined}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
