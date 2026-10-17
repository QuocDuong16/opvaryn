import Link from 'next/link';
import { ApiError, type BusinessObject, type ProcessDefinition } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { DesignerNotice } from '@/components/ui/role-notice';
import { StatusBadge } from '@/components/ui/status-badge';
import { canDesign, isAdmin } from '@/lib/access';
import { advancedVisible } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';
import { designerRoleName, labelOrKey } from '@/lib/names';

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

/** loadRoles answers who is asking; a broken API keeps the build material hidden. */
async function loadRoles(): Promise<string[]> {
  try {
    const me = await createServerApiClient().getMe();
    return me.roles;
  } catch {
    return [];
  }
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
  let mayDesign = false;
  let roleName = 'vai trò thiết kế quy trình';
  let error: string | null = null;
  let needsSignIn = false;

  try {
    const [definitionPage, objectPage, me, catalogue] = await Promise.all([
      api.listProcessDefinitions({ q: query || undefined, limit: PER_PAGE, offset }),
      api.listBusinessObjects({ limit: 100 }),
      api.getMe(),
      api.listRoles().catch(() => []),
    ]);
    definitions = definitionPage.data;
    definitionTotal = definitionPage.total;
    objects = objectPage.data;
    mayDesign = canDesign(me.roles);
    roleName = designerRoleName(catalogue);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      needsSignIn = true;
    } else {
      error = describeApiError(cause);
    }
  }

  const [roles, advanced] = await Promise.all([loadRoles(), getAdvancedMode()]);
  const showAdvanced = advancedVisible(isAdmin(roles), advanced);

  const objectNames = new Map(objects.map((object) => [object.key, object.name]));

  return (
    <>
      <PageHeader
        eyebrow="04 / Quy trình"
        title="Quy trình"
        lead={
          mayDesign
            ? 'Thiết kế quy trình phê duyệt: vẽ các bước, giao việc theo vai trò và đặt điều kiện rẽ nhánh. Sửa một định nghĩa là phát hành phiên bản mới; quy trình đang chạy vẫn giữ phiên bản cũ.'
            : 'Các quy trình đang dùng: ai duyệt gì, theo thứ tự nào. Mở một quy trình để xem sơ đồ, các lần chạy và việc đang chờ ai.'
        }
      />

      {needsSignIn ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Cần đăng nhập để xem quy trình</CardTitle>
          <CardDescription>
            Ai đã đăng nhập cũng xem được các quy trình đang dùng; tạo và sửa quy trình cần vai trò
            thiết kế quy trình hoặc quản trị hệ thống.
          </CardDescription>
          <Link
            href="/login?next=/workflows"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Đăng nhập
          </Link>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được quy trình</CardTitle>
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
          <div className="flex flex-wrap items-center gap-2">
            <ListSearch
              basePath="/workflows"
              value={query}
              placeholder="Tìm theo tên quy trình"
              label="Tìm quy trình"
            />
            {mayDesign ? (
              <Link
                href="/workflows/new"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
              >
                Tạo quy trình mới
              </Link>
            ) : null}
          </div>
        </div>

        {definitions.length === 0 && !error && !needsSignIn ? (
          <div className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center">
            <p className="text-sm font-medium">
              {query ? 'Không có quy trình nào khớp từ khoá' : 'Chưa có quy trình nào'}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-muted">
              {query
                ? 'Thử từ khoá khác, hoặc xoá lọc để xem tất cả.'
                : mayDesign
                  ? 'Bắt đầu bằng một quy trình mới, hoặc chạy bộ dữ liệu mẫu để xem ba quy trình pilot có sẵn.'
                  : 'Chưa có quy trình nào được phát hành. Việc tạo quy trình thuộc về người thiết kế quy trình.'}
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
                    Loại dữ liệu
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Phiên bản
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Quy mô
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
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link href={`/objects/${definition.objectKey}`} className="hover:underline">
                        {labelOrKey(objectNames.get(definition.objectKey), definition.objectKey)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-on-surface-muted">
                        {`v${definition.version}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-on-surface-muted">
                      {`${definition.nodes.length} bước · ${definition.edges.length} đường nối`}
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

      {showAdvanced ? (
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
      ) : null}

      {!mayDesign ? (
        <div className="mb-8">
          <DesignerNotice roleName={roleName} what="tạo quy trình" />
        </div>
      ) : null}

      {showAdvanced ? (
        <section className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle>Định nghĩa và lần chạy là hai thứ khác nhau</CardTitle>
            <CardDescription>
              Một instance khi chạy gắn chặt với version definition đã publish tại thời điểm khởi
              tạo. Sửa definition tạo version mới; instance đang xử lý không tự đổi hành vi.
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Quy trình đang chạy không tự đổi</CardTitle>
            <CardDescription>
              Phiên bản đã publish không đổi; một bước chỉ có hiệu lực đúng một lần (hai người quyết
              cùng lúc thì người sau được báo việc đã xử lý); quyết định đã ghi không bị đảo ngược
              bởi lỗi phía sau.
            </CardDescription>
          </Card>
        </section>
      ) : null}
    </>
  );
}
