import { notFound } from 'next/navigation';
import type { AdminRole } from '@opvaryn/contracts';

import { deleteAdminRoleAction } from '@/app/(workspace)/admin/actions';
import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { DeleteForm } from '@/components/admin/delete-form';
import { CreateRoleForm, RenameRoleForm } from '@/components/admin/role-forms';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Vai trò' };

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

export default async function AdminRolesPage({ searchParams }: PageProps) {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  const { q, offset: rawOffset } = await searchParams;
  const query = (q ?? '').trim();
  const offset = pageOffset(rawOffset, PER_PAGE);

  let roles: AdminRole[] = [];
  let total = 0;
  let error: string | null = null;

  try {
    const page = await createServerApiClient().listAdminRoles({
      q: query || undefined,
      limit: PER_PAGE,
      offset,
    });
    roles = page.data;
    total = page.total;
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Vai trò"
        lead="Vai trò là thứ quy trình gán cho từng bước và là thứ quyết định ai nhận việc, ai được thiết kế, ai quản trị. Danh mục này gồm cả vai trò chưa có ai giữ."
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {query ? `Kết quả cho “${query}” (${total})` : `Danh mục (${total})`}
          </h2>
          <ListSearch
            basePath="/admin/roles"
            value={query}
            placeholder="Tìm theo tên hoặc mã"
            label="Tìm vai trò"
          />
        </div>

        {roles.length === 0 && !error ? (
          <Card>
            <CardDescription>
              {query ? 'Không có vai trò nào khớp từ khoá.' : 'Chưa có vai trò nào.'}
            </CardDescription>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Vai trò
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Số người giữ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Đổi tên
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Xoá
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface-raised/40">
                {roles.map((role) => (
                  <tr key={role.key}>
                    <td className="px-4 py-3 align-top">
                      <span className="font-medium">{role.label || role.key}</span>
                      {role.isSystem ? (
                        <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-on-surface-muted">
                          Vai trò hệ thống
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-on-surface-muted">{role.userCount}</td>
                    <td className="px-4 py-3 align-top">
                      <RenameRoleForm role={role} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <DeleteForm
                        action={deleteAdminRoleAction}
                        hiddenValue={role.key}
                        label="Xoá vai trò"
                        confirmMessage={`Xoá vai trò “${role.label || role.key}”?`}
                        disabled={role.isSystem || role.userCount > 0}
                        disabledNote={
                          role.isSystem
                            ? 'Vai trò do hệ thống định nghĩa, chỉ đổi tên được.'
                            : role.userCount > 0
                              ? `Còn ${role.userCount} người giữ vai trò này. Hãy bỏ vai trò khỏi họ trước.`
                              : undefined
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          total={total}
          limit={PER_PAGE}
          offset={offset}
          basePath="/admin/roles"
          params={{ q: query || undefined }}
        />
      </section>

      <details className="mt-8 rounded-xl border border-border bg-surface-raised/40 px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold tracking-tight">
          Tạo vai trò mới
        </summary>
        <div className="mt-4 max-w-2xl">
          <CreateRoleForm />
        </div>
      </details>

      <Card className="mt-6">
        <CardTitle>Vai trò và quyền</CardTitle>
        <CardDescription>
          Hai vai trò hệ thống có ý nghĩa cố định: <strong>Quản trị hệ thống</strong> quản lý tài
          khoản, phòng ban, vai trò và đọc mọi bản ghi; <strong>Thiết kế quy trình</strong> tạo và
          phát hành định nghĩa dữ liệu, quy trình và chỉ số. Các vai trò còn lại là nghiệp vụ: người
          giữ vai trò nào thì nhận việc của bước quy trình gán vai trò đó. Xoá một vai trò chỉ thực
          hiện được khi không còn ai giữ và không quy trình nào đang dùng.
        </CardDescription>
      </Card>
    </>
  );
}
