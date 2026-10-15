import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApiError,
  type ProcessDefinition,
  type ProcessDefinitionVersion,
  type ProcessInstanceSummary,
  type RoleEntry,
} from '@opvaryn/contracts';

import { InstanceList } from '@/components/process/instance-list';
import { recordLabels } from '@/components/objects/record-labels';
import { ProcessCanvas } from '@/components/workflows/process-canvas';
import { WorkflowEditor } from '@/components/workflows/workflow-editor';
import { draftFromGraph } from '@/components/workflows/definition-draft-model';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { labelOrKey, roleLabels } from '@/lib/names';
import { getWorkflowDraft } from '@/lib/workflow-draft';
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
  let instances: ProcessInstanceSummary[] = [];
  let roleCatalogue: RoleEntry[] = [];
  let labels: Record<string, string> = {};
  let error: string | null = null;

  try {
    definition = await api.getProcessDefinition(key);
    [versions, instances, roleCatalogue] = await Promise.all([
      api.listProcessDefinitionVersions(key),
      api.listProcessInstances({ definitionKey: key }),
      api.listRoles(),
    ]);

    // An instance row should name the record it runs on. Records are read per object
    // (the list is scoped like everything else), and the label uses each record's own
    // definition version — the same rule as the record table (ADR 0006).
    const objectKeys = [...new Set(instances.map((summary) => summary.instance.objectKey))];
    const perObject = await Promise.all(
      objectKeys.map(async (objectKey) => {
        const [objectVersions, records] = await Promise.all([
          api.listBusinessObjectVersions(objectKey),
          api.listObjectRecords(objectKey),
        ]);
        return recordLabels(records, objectVersions);
      }),
    );
    labels = Object.assign({}, ...perObject);
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
          eyebrow="04 / Quy trình"
          title={key}
          lead="Không đọc được định nghĩa này từ API."
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

  const definitionRoles = [
    ...new Set(
      definition.nodes
        .map((node) => node.assigneeRole)
        .filter((role): role is string => role !== undefined && role !== ''),
    ),
  ].sort();
  const named = roleLabels(roleCatalogue);
  const knownRoles: RoleEntry[] = [
    ...new Set([...roleCatalogue.map((entry) => entry.key), ...definitionRoles]),
  ]
    .sort()
    .map((key) => ({ key, label: named.get(key) ?? '' }));
  const roleNames = Object.fromEntries(knownRoles.map((entry) => [entry.key, entry.label]));

  // The editor works on a draft (ADR 0013): the newest published graph is the baseline,
  // and a saved draft from this browser takes its place when one exists.
  const publishedDraft = draftFromGraph(definition.nodes, definition.edges);
  const savedDraft = await getWorkflowDraft(definition.key);
  // A role nobody holds is a real hazard: the instance stops at that node and no
  // inbox shows the work. The definition is still valid, so this warns instead of
  // blocking — an administrator may be about to grant the role.
  const unheldRoles = definitionRoles.filter(
    (role) => !roleCatalogue.some((entry) => entry.key === role),
  );

  return (
    <>
      <PageHeader
        eyebrow={`04 / Workflow designer · ${definition.key}`}
        title={definition.name}
        lead={
          definition.description ??
          'Graph đã publish của quy trình này. Instance chạy đúng phiên bản này; publish phiên bản mới không đổi các instance đang xử lý.'
        }
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

      {unheldRoles.length > 0 ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Vai trò chưa có ai giữ</CardTitle>
          <CardDescription>
            {`Quy trình này giao việc cho ${unheldRoles.map((role) => labelOrKey(roleNames[role], role)).join(', ')}, nhưng hiện không tài khoản nào giữ vai trò đó. Quy trình chạy tới bước ấy sẽ dừng lại và không xuất hiện trong hộp việc của ai — hãy gán vai trò này cho ít nhất một người, rồi tải lại trang.`}
          </CardDescription>
        </Card>
      ) : null}

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
          {isNewest ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                  Trình soạn graph — bản nháp của bạn
                </h2>
                <StatusBadge kind="live" />
              </div>
              <WorkflowEditor
                definitionKey={definition.key}
                definitionName={definition.name}
                objectKey={definition.objectKey}
                published={publishedDraft}
                initialDraft={savedDraft ?? publishedDraft}
                hasSavedDraft={savedDraft !== null}
                knownRoles={knownRoles}
                canvasLabel={`${definition.key} v${definition.version}`}
              />
            </>
          ) : (
            <>
              <ProcessCanvas
                graph={{ nodes: shown.nodes, edges: shown.edges }}
                version={shown.version}
                label={`${definition.key} v${shown.version}`}
                roleLabels={roleNames}
              />
              <p className="mt-3 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">
                {`Đang xem v${shown.version} — bản đang dùng là v${definition.version}. Instance cũ vẫn chạy theo phiên bản này, nên bản cũ chỉ để xem: chọn v${definition.version} ở dải phiên bản để sửa.`}
              </p>
            </>
          )}
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
              recordLabels={labels}
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
            <CardTitle>Cách bản nháp hoạt động</CardTitle>
            <CardDescription>
              Canvas ở trên sửa một <strong>bản nháp</strong>: kéo node, nối đường chuyển, thêm hoặc
              xoá node — tất cả chỉ nằm trong trình duyệt này. Chỉ khi bấm
              <strong> Publish phiên bản mới</strong> quy trình mới được kiểm tra và lưu thành phiên
              bản mới; phiên bản đã publish không đổi, và quy trình đang chạy giữ nguyên phiên bản
              của nó.
            </CardDescription>
            <ul className="mt-4 space-y-2 text-xs text-on-surface-muted">
              <li>Lưu nháp giữ bản đang sửa cho lần mở sau, chỉ trong trình duyệt này.</li>
              <li>Bỏ nháp đưa canvas về đúng bản đã publish.</li>
              <li>
                Publish cần role <code className="font-mono">process_designer</code> hoặc{' '}
                <code className="font-mono">admin</code>.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
