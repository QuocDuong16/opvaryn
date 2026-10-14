import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApiError,
  type BusinessObject,
  type ProcessDefinition,
  type ProcessDefinitionVersion,
  type ProcessInstanceSummary,
} from '@opvaryn/contracts';

import { InstanceList } from '@/components/process/instance-list';
import { PublishDefinitionForm } from '@/components/workflows/definition-editor';
import { ProcessCanvas } from '@/components/workflows/process-canvas';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';

interface PageProps {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ version?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Workflow ${key}` };
}

export default async function WorkflowDetailPage({ params, searchParams }: PageProps) {
  const { key } = await params;
  const { version: requestedVersion } = await searchParams;
  const api = createServerApiClient();

  let definition: ProcessDefinition | null = null;
  let versions: ProcessDefinitionVersion[] = [];
  let objects: BusinessObject[] = [];
  let instances: ProcessInstanceSummary[] = [];
  let error: string | null = null;

  try {
    definition = await api.getProcessDefinition(key);
    [versions, objects, instances] = await Promise.all([
      api.listProcessDefinitionVersions(key),
      api.listBusinessObjects(),
      api.listProcessInstances({ definitionKey: key }),
    ]);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      notFound();
    }
    error = describeApiError(cause);
  }

  if (!definition) {
    return (
      <>
        <PageHeader
          eyebrow="04 / Workflow designer"
          title={key}
          lead="Không đọc được định nghĩa này từ API."
          aside={<StatusBadge kind="mock" />}
        />
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <Link
            href="/workflows"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            ← Về danh sách quy trình
          </Link>
        </Card>
      </>
    );
  }

  // The canvas draws a published version, not a draft: a published version is what
  // the engine runs (ADR 0006). Older versions stay inspectable because instances
  // bound to them are still running.
  const requested = Number.parseInt(requestedVersion ?? '', 10);
  const shown =
    versions.find((version) => version.version === requested) ?? versions[0] ?? undefined;
  const isNewest = shown !== undefined && shown.version === definition.version;
  const knownRoles = [
    ...new Set(
      definition.nodes
        .map((node) => node.assigneeRole)
        .filter((role): role is string => role !== undefined && role !== ''),
    ),
  ].sort();

  return (
    <>
      <PageHeader
        eyebrow={`04 / Workflow designer · ${definition.key}`}
        title={definition.name}
        lead={
          definition.description ??
          'Graph đã publish của quy trình này. Instance chạy đúng phiên bản này; publish phiên bản mới không đổi các instance đang xử lý.'
        }
        aside={<StatusBadge kind="live" />}
      />

      <p className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/workflows" className="text-on-surface-muted hover:text-on-surface">
          ← Tất cả quy trình
        </Link>
        <Link
          href={`/objects/${definition.objectKey}`}
          className="font-mono text-xs text-accent-strong hover:underline"
        >
          {definition.objectKey}
        </Link>
        <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-xs text-on-surface-muted">
          {`phiên bản đang dùng v${definition.version}`}
        </span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-on-surface-muted">
          {`${definition.nodes.length} node · ${definition.edges.length} đường chuyển`}
        </span>
      </p>

      {versions.length > 1 ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs tracking-wide text-on-surface-muted uppercase">
            Xem phiên bản
          </span>
          {versions.map((version) => (
            <Link
              key={version.id}
              href={`/workflows/${definition?.key}?version=${version.version}`}
              aria-current={version.version === shown?.version ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                version.version === shown?.version
                  ? 'border-accent-strong/50 bg-accent/10 text-on-surface'
                  : 'border-border text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
              )}
            >
              {`v${version.version}`}
              <span className="ml-1.5 text-[10px] text-on-surface-muted">
                {formatTimestamp(version.publishedAt)}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {shown ? (
        <div className="mb-8">
          <ProcessCanvas
            graph={{ nodes: shown.nodes, edges: shown.edges }}
            version={shown.version}
            label={`${definition.key} v${shown.version}`}
          />
          {!isNewest ? (
            <p className="mt-3 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">
              {`Đang xem v${shown.version} — bản đang dùng là v${definition.version}. Instance cũ vẫn chạy theo phiên bản này.`}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                {`Instance của quy trình này (${instances.length})`}
              </h2>
              <StatusBadge kind="live" />
            </div>
            <p className="mb-3 text-xs text-on-surface-muted">
              Đọc theo phạm vi của bạn: instance hiện khi bản ghi của nó hiện. Việc đang chờ nằm
              trong inbox của role tương ứng.
            </p>
            <InstanceList
              instances={instances}
              emptyHint="Chạy quy trình này từ màn hình bản ghi của business object để thấy instance ở đây."
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
              {`Lịch sử phiên bản (${versions.length})`}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-border">
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
                      Node
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-raised/40">
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/workflows/${definition?.key}?version=${version.version}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {`v${version.version}`}
                        </Link>
                        {version.version === definition?.version ? (
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
                      <td className="px-4 py-3 text-xs text-on-surface-muted">
                        {version.nodes.map((node) => node.key).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="min-w-0">
          <Card>
            <CardTitle>Publish phiên bản mới</CardTitle>
            <CardDescription>
              Sửa node và đường chuyển rồi publish: version hiện tại giữ nguyên, instance đang chạy
              không đổi hành vi. Cần role{' '}
              <code className="font-mono text-xs">process_designer</code> hoặc{' '}
              <code className="font-mono text-xs">admin</code>.
            </CardDescription>
            <div className="mt-5">
              <PublishDefinitionForm
                definition={definition}
                objects={objects}
                knownRoles={knownRoles}
              />
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
