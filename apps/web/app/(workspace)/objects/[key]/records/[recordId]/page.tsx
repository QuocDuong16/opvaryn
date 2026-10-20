import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApiError,
  type BusinessObject,
  type BusinessObjectVersion,
  type ObjectRecord,
  type RecordHistoryEntry,
} from '@opvaryn/contracts';

import { ObjectForm } from '@/components/forms/object-form';
import { DeleteRecordForm } from '@/components/forms/record-delete-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatFieldValue, formatTimestamp, primaryFieldValue } from '@/lib/format';

export const metadata = { title: 'Bản ghi' };

const HISTORY_PER_PAGE = 10;

const HISTORY_ACTION_LABELS: Record<string, string> = {
  created: 'Tạo bản ghi',
  updated: 'Sửa bản ghi',
  deleted: 'Xoá bản ghi',
};

export default async function ObjectRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; recordId: string }>;
  searchParams: Promise<{ hoffset?: string }>;
}) {
  const { key, recordId } = await params;
  const { hoffset: rawHistoryOffset } = await searchParams;
  const historyOffset = pageOffset(rawHistoryOffset, HISTORY_PER_PAGE);
  const api = createServerApiClient();

  let object: BusinessObject;
  let record: ObjectRecord;
  let versions: BusinessObjectVersion[];
  try {
    [object, record, versions] = await Promise.all([
      api.getBusinessObject(key),
      api.getObjectRecord(key, recordId),
      api.listBusinessObjectVersions(key),
    ]);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      notFound();
    }
    return (
      <Card className="border-warning/40">
        <CardTitle className="text-warning">Không đọc được bản ghi</CardTitle>
        <CardDescription>{describeApiError(cause)}</CardDescription>
        <p className="mt-4 text-sm text-on-surface-muted">
          Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
        </p>
      </Card>
    );
  }

  // A record is read and edited with the definition version it was created under; the
  // newest schema is not the schema of this row (ADR 0006 invariant 1).
  const version = versions.find((candidate) => candidate.version === record.objectVersion);
  if (!version) {
    return (
      <Card className="border-warning/40">
        <CardTitle className="text-warning">Thiếu định nghĩa của bản ghi</CardTitle>
        <CardDescription>
          Bản ghi này được tạo theo một phiên bản định nghĩa không còn đọc được. Người quản trị hệ
          thống cần kiểm tra lại dữ liệu trước khi sửa.
        </CardDescription>
      </Card>
    );
  }

  const definition: BusinessObject = {
    id: object.id,
    key: object.key,
    name: version.name,
    description: object.description,
    fields: version.fields,
    version: version.version,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
  };

  const history = await api
    .listObjectRecordHistory(key, recordId, {
      limit: HISTORY_PER_PAGE,
      offset: historyOffset,
    })
    .catch(() => null);

  const primary = primaryFieldValue(version.fields, record);
  const title = primary === record.id ? 'Bản ghi' : primary;
  const recordsHref = `/objects/${key}?tab=records`;
  const runsHref = `/objects/${key}?tab=processes&record=${record.id}`;

  return (
    <>
      <PageHeader
        eyebrow="02 / Dữ liệu · Bản ghi"
        title={title}
        lead={`Thuộc ${object.name} · nhập bởi ${record.createdByName || 'không rõ người nhập'} · ${record.departmentName || 'không thuộc bộ phận nào'} · theo phiên bản v${record.objectVersion}.`}
      />
      <p className="mb-4 text-sm">
        <Link href={recordsHref} className="text-accent-strong hover:underline">
          ← Danh sách bản ghi
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <Card>
          <CardTitle>{record.canEdit ? 'Sửa bản ghi' : 'Bản ghi'}</CardTitle>
          <CardDescription>
            {record.canEdit
              ? 'Giá trị được kiểm tra theo đúng phiên bản định nghĩa mà bản ghi này được tạo theo. Sửa bản ghi không phát hành phiên bản mới.'
              : 'Bạn đọc được bản ghi này nhưng không sửa được: chỉ người tạo, người cùng bộ phận hoặc quản trị hệ thống mới sửa được.'}
          </CardDescription>
          {record.canEdit ? (
            <div className="mt-4">
              <ObjectForm object={definition} record={record} />
            </div>
          ) : (
            <RecordValues fields={version.fields} record={record} />
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>Thông tin bản ghi</CardTitle>
            <dl className="mt-3 space-y-2 text-sm">
              <MetaRow label="Người nhập" value={record.createdByName || '—'} />
              <MetaRow label="Bộ phận" value={record.departmentName || '—'} />
              <MetaRow label="Định nghĩa" value={`phiên bản v${record.objectVersion}`} />
              <MetaRow label="Tạo lúc" value={formatTimestamp(record.createdAt)} />
              <MetaRow label="Cập nhật lúc" value={formatTimestamp(record.updatedAt)} />
            </dl>
            <Link
              href={runsHref}
              className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
            >
              Xem các lần chạy của bản ghi →
            </Link>
          </Card>

          {record.canEdit ? (
            <Card>
              <CardTitle>Xoá bản ghi</CardTitle>
              <CardDescription>
                Chỉ xoá được khi chưa có quy trình nào chạy trên bản ghi. Bản ghi đã có lần chạy là
                lịch sử của những quyết định đã ra, nên được giữ lại.
              </CardDescription>
              <div className="mt-4">
                <DeleteRecordForm objectKey={key} recordId={record.id} />
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Lịch sử thay đổi</h2>
        <p className="mt-1 text-sm text-on-surface-muted">
          Ai đã tạo, sửa hoặc xoá bản ghi và những trường nào đã đổi. Lịch sử chỉ được ghi thêm,
          không sửa lại được.
        </p>
        <Card className="mt-4">
          {history === null ? (
            <CardDescription>
              Không đọc được lịch sử thay đổi. Thử lại sau ít phút; bản ghi vẫn xem được.
            </CardDescription>
          ) : history.data.length === 0 ? (
            <CardDescription>Chưa có lần thay đổi nào được ghi lại.</CardDescription>
          ) : (
            <ol className="space-y-4">
              {history.data.map((entry) => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
          {history && history.total > HISTORY_PER_PAGE ? (
            <Pagination
              total={history.total}
              limit={HISTORY_PER_PAGE}
              offset={historyOffset}
              basePath={`/objects/${key}/records/${record.id}`}
              offsetParam="hoffset"
            />
          ) : null}
        </Card>
      </section>
    </>
  );
}

function HistoryEntry({ entry }: { entry: RecordHistoryEntry }) {
  return (
    <li className="border-b border-border pb-3 last:border-0 last:pb-0">
      <p className="text-sm">
        <span className="font-medium">{HISTORY_ACTION_LABELS[entry.action] ?? entry.action}</span>
        {entry.actorName ? (
          <span className="text-on-surface-muted"> · {entry.actorName}</span>
        ) : null}
        <span className="text-on-surface-muted"> · {formatTimestamp(entry.createdAt)}</span>
      </p>
      {entry.changes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-on-surface-muted">
          {entry.changes.map((change, index) => (
            <li key={`${entry.id}-${index}`}>
              <span className="font-medium text-on-surface">{change.fieldLabel}</span>:{' '}
              {change.from || '—'} → {change.to || '—'}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function RecordValues({
  fields,
  record,
}: {
  fields: BusinessObjectVersion['fields'];
  record: ObjectRecord;
}) {
  return (
    <dl className="mt-4 space-y-3 text-sm">
      {fields.map((field) => {
        const value = record.values[field.key];
        return (
          <div key={field.key}>
            <dt className="text-xs font-medium tracking-wide text-on-surface-muted uppercase">
              {field.label}
            </dt>
            <dd className="mt-0.5">
              {field.type === 'file' && typeof value === 'string' && value !== '' ? (
                <a href={`/attachments/${value}`} className="text-accent-strong hover:underline">
                  {record.attachmentNames?.[field.key] ?? 'Tải tệp đính kèm'} →
                </a>
              ) : (
                formatFieldValue(field, value)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-on-surface-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
