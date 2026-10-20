import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminDepartment, AdminRole, AdminUser } from '@opvaryn/contracts';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { UserForm } from '@/components/admin/user-form';
import { cooldownState, type CooldownState } from '@/components/admin/cooldown';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { joinLabels } from '@/lib/names';

export const metadata = { title: 'Người dùng' };

const PER_PAGE = 25;

const STATUS_LABELS: Record<string, string> = {
  active: 'Đang hoạt động',
  disabled: 'Đã khoá',
};

interface PageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
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

  let users: AdminUser[] = [];
  let total = 0;
  let departments: AdminDepartment[] = [];
  let roles: AdminRole[] = [];
  let error: string | null = null;

  try {
    const api = createServerApiClient();
    const [page, departmentPage, rolePage] = await Promise.all([
      api.listAdminUsers({ q: query || undefined, limit: PER_PAGE, offset }),
      api.listAdminDepartments({ limit: 100 }),
      api.listAdminRoles({ limit: 100 }),
    ]);
    users = page.data;
    total = page.total;
    departments = departmentPage.data;
    roles = rolePage.data;
  } catch (cause) {
    error = describeApiError(cause);
  }

  const roleNames = new Map<string, string>();
  for (const role of roles) {
    roleNames.set(role.key, role.label);
  }
  for (const user of users) {
    for (const [key, label] of Object.entries(user.roleLabels)) {
      roleNames.set(key, label);
    }
  }

  // One read of the cooldown per account: the screen only shows a badge while the account
  // is waiting out a sign-in cooldown (ADR 0028).
  const cooldowns = new Map<string, CooldownState>();
  for (const user of users) {
    cooldowns.set(user.id, cooldownState(user.lockedUntil));
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Người dùng"
        lead="Mỗi người có một tài khoản riêng, thuộc một phòng ban và giữ các vai trò quyết định việc họ nhận và dữ liệu họ đọc được."
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {query ? `Kết quả cho “${query}” (${total})` : `Tài khoản (${total})`}
          </h2>
          <ListSearch
            basePath="/admin/users"
            value={query}
            placeholder="Tìm theo tên hoặc email"
            label="Tìm tài khoản"
          />
        </div>

        {users.length === 0 && !error ? (
          <Card>
            <CardDescription>
              {query
                ? 'Không có tài khoản nào khớp từ khoá.'
                : 'Chưa có tài khoản nào ngoài tài khoản quản trị đầu tiên.'}
            </CardDescription>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Họ tên
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Phòng ban
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Vai trò
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Trạng thái
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface-raised/40">
                {users.map((user) => {
                  const cooldown = cooldowns.get(user.id);
                  return (
                    <tr key={user.id}>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="font-medium text-accent-strong hover:underline"
                        >
                          {user.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-top text-on-surface-muted">{user.email}</td>
                      <td className="px-4 py-3 align-top">{user.departmentName}</td>
                      <td className="px-4 py-3 align-top text-on-surface-muted">
                        {user.roles.length > 0 ? joinLabels(user.roles, roleNames) : '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={
                            user.status === 'active'
                              ? 'rounded-full border border-success/40 px-2 py-0.5 text-xs text-success'
                              : 'rounded-full border border-border px-2 py-0.5 text-xs text-on-surface-muted'
                          }
                        >
                          {STATUS_LABELS[user.status] ?? user.status}
                        </span>
                        {cooldown?.clock && user.status === 'active' ? (
                          <p className="mt-1 text-xs text-warning">
                            Tạm khoá đăng nhập, mở lại lúc {cooldown.clock}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          total={total}
          limit={PER_PAGE}
          offset={offset}
          basePath="/admin/users"
          params={{ q: query || undefined }}
        />
      </section>

      {departments.length === 0 ? (
        <Card className="mt-8">
          <CardTitle>Tạo phòng ban trước</CardTitle>
          <CardDescription>
            Mỗi tài khoản phải thuộc một phòng ban. Hãy tạo ít nhất một phòng ban rồi quay lại trang
            này.
          </CardDescription>
          <Link
            href="/admin/departments"
            className="mt-3 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            Mở quản lý phòng ban →
          </Link>
        </Card>
      ) : (
        <details className="mt-8 rounded-xl border border-border bg-surface-raised/40 px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold tracking-tight">
            Tạo tài khoản mới
          </summary>
          <div className="mt-4">
            <UserForm mode="create" departments={departments} roles={roles} />
          </div>
        </details>
      )}

      <p className="mt-6 text-xs leading-relaxed text-on-surface-muted">
        Vai trò hiển thị ở đây là dữ liệu của tổ chức. Muốn thêm một vai trò mới, mở{' '}
        <Link href="/admin/roles" className="text-accent-strong hover:underline">
          Quản lý vai trò
        </Link>
        .
      </p>
    </>
  );
}
