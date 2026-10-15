import Link from 'next/link';
import {
  ApiError,
  type BusinessObject,
  type ProcessDefinition,
  type RoleEntry,
} from '@opvaryn/contracts';

import { CreateDefinitionForm } from '@/components/workflows/definition-editor';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { roleLabels } from '@/lib/names';

export const metadata = { title: 'Quy trình' };

const NODE_CATALOG: readonly { node: string; behavior: string; phase: string }[] = [
  {
    node: 'Start / End',
    behavior: 'Tạo và kết thúc instance, lưu kết quả terminal',
    phase: 'Đã có',
  },
  {
    node: 'Human Task',
    behavior: 'Giao việc theo role, duyệt / trả về / từ chối',
    phase: 'Đã có',
  },
  {
    node: 'Condition / Branch',
    behavior: 'Rẽ nhánh bằng condition JSON trên field của business object (D04)',
    phase: 'Đã có',
  },
  {
    node: 'Notification',
    behavior: 'Tạo thông báo, không đổi kết quả approval',
    phase: 'MVP tối giản',
  },
  {
    node: 'Service Action',
    behavior: 'Gọi API, cập nhật dữ liệu ngoài có retry',
    phase: 'MVP giới hạn',
  },
  {
    node: 'Parallel / Join',
    behavior: 'Nhiều tác vụ đồng thời, chính sách ALL/ANY/QUORUM',
    phase: 'V1.x',
  },
  { node: 'Subprocess', behavior: 'Khởi tạo và liên kết quy trình con', phase: 'V1.x / V2' },
  { node: 'Timer / Escalation', behavior: 'Timeout, SLA, chuyển cấp hoặc giao lại', phase: 'V1.x' },
];

interface PageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

/** One page of definitions; the API slices and reports the total. */
const PER_PAGE = 25;

export default async function WorkflowsPage({ searchParams }: PageProps) {
  const { q, offset: rawOffset } = await searchParams;
  const query = (q ?? '').trim();
  const offset = pageOffset(rawOffset, PER_PAGE);
  const api = createServerApiClient();

  let definitions: ProcessDefinition[] = [];
  let definitionTotal = 0;
  let objects: BusinessObject[] = [];
  let roleCatalogue: RoleEntry[] = [];
  let error: string | null = null;
  let needsSignIn = false;

  try {
    const [definitionPage, objectPage, roles] = await Promise.all([
      api.listProcessDefinitions({ q: query || undefined, limit: PER_PAGE, offset }),
      api.listBusinessObjects({ limit: 100 }),
      api.listRoles(),
    ]);
    definitions = definitionPage.data;
    definitionTotal = definitionPage.total;
    objects = objectPage.data;
    roleCatalogue = roles;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      needsSignIn = true;
    } else {
      error = describeApiError(cause);
    }
  }

  // Suggestions for the role field: the catalogue (roles someone holds, with the name each
  // one is shown under) plus the roles existing definitions already name, so a definition
  // that references a role nobody holds still shows it instead of looking like a typo.
  const named = roleLabels(roleCatalogue);
  const knownRoles: RoleEntry[] = [
    ...new Set([
      ...roleCatalogue.map((entry) => entry.key),
      ...definitions.flatMap((definition) =>
        definition.nodes
          .map((node) => node.assigneeRole)
          .filter((role): role is string => role !== undefined && role !== ''),
      ),
    ]),
  ]
    .sort()
    .map((key) => ({ key, label: named.get(key) ?? '' }));

  return (
    <>
      <PageHeader
        eyebrow="04 / Quy trình"
        title="Quy trình"
        lead="Thiết kế quy trình phê duyệt: vẽ các bước, giao việc theo vai trò và đặt điều kiện rẽ nhánh. Sửa một định nghĩa là phát hành phiên bản mới; quy trình đang chạy vẫn giữ phiên bản cũ."
      />

      {needsSignIn ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Cần đăng nhập để xem định nghĩa</CardTitle>
          <CardDescription>
            Đọc định nghĩa mở cho mọi user đã đăng nhập; tạo và publish cần role{' '}
            <code className="font-mono text-xs">process_designer</code> hoặc{' '}
            <code className="font-mono text-xs">admin</code>.
          </CardDescription>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Đăng nhập
          </Link>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được process definition</CardTitle>
          <CardDescription>{error}</CardDescription>
          <p className="mt-4 text-sm text-on-surface-muted">
            Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
          </p>
        </Card>
      ) : null}

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {query
              ? `Kết quả cho “${query}” (${definitionTotal})`
              : `Đang dùng (${definitionTotal})`}
          </h2>
          <ListSearch
            basePath="/workflows"
            value={query}
            placeholder="Tìm theo tên hoặc key"
            label="Tìm quy trình"
          />
        </div>

        {definitions.length === 0 && !error && !needsSignIn ? (
          <div className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center">
            <p className="text-sm font-medium">
              {query ? 'Không có quy trình nào khớp từ khoá' : 'Chưa có quy trình nào'}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-muted">
              {query
                ? 'Thử từ khoá khác, hoặc xoá lọc để xem tất cả.'
                : 'Tạo định nghĩa đầu tiên ở biểu mẫu bên dưới. Bộ dữ liệu mẫu có ba quy trình pilot để bạn tham khảo.'}
            </p>
          </div>
        ) : null}

        {definitions.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Quy trình
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Business object
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Phiên bản
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Graph
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Cập nhật
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface-raised/40">
                {definitions.map((definition) => (
                  <tr key={definition.key}>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/workflows/${definition.key}`}
                        className="font-medium text-accent-strong hover:underline"
                      >
                        {definition.name}
                      </Link>
                      <span className="mt-0.5 block font-mono text-[11px] text-on-surface-muted">
                        {definition.key}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/objects/${definition.objectKey}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {definition.objectKey}
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-on-surface-muted">
                        {`v${definition.version}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-on-surface-muted">
                      {`${definition.nodes.length} node · ${definition.edges.length} đường chuyển`}
                    </td>
                    <td className="px-4 py-3 align-top text-xs whitespace-nowrap text-on-surface-muted">
                      {formatTimestamp(definition.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <Pagination
          total={definitionTotal}
          limit={PER_PAGE}
          offset={offset}
          basePath="/workflows"
          params={{ q: query || undefined }}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Tạo quy trình mới</h2>
        <Card>
          <CardDescription>
            Biểu mẫu này publish version 1 qua API. Graph được kiểm tra ở service: đúng một node bắt
            đầu, ít nhất một việc của người và một node kết thúc, không chu trình, mọi node đi được
            từ start, node điều kiện có đủ nhánh đúng/sai, và literal của điều kiện phải hợp với
            kiểu field của business object.
          </CardDescription>
          <div className="mt-5">
            <CreateDefinitionForm objects={objects} knownRoles={knownRoles} />
          </div>
        </Card>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Node catalog theo lộ trình</h2>
          <StatusBadge kind="concept" />
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Node
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Hành vi
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Giai đoạn
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-raised/40">
              {NODE_CATALOG.map((row) => (
                <tr key={row.node}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{row.node}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{row.behavior}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-on-surface-muted">
                      {row.phase}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Definition ≠ Instance</CardTitle>
          <CardDescription>
            Một instance khi chạy gắn chặt với version definition đã publish tại thời điểm khởi tạo.
            Sửa definition tạo version mới; instance đang xử lý không tự đổi hành vi.
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Ba bất biến đang giữ</CardTitle>
          <CardDescription>
            Phiên bản đã publish không đổi; một bước chỉ có hiệu lực đúng một lần (hai người quyết
            cùng lúc thì người sau được báo việc đã xử lý); quyết định đã ghi không bị đảo ngược bởi
            lỗi phía sau.
          </CardDescription>
        </Card>
      </section>
    </>
  );
}
