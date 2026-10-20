import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Quản trị' };

interface Counts {
  users: number;
  departments: number;
  roles: number;
}

export default async function AdminPage() {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  let counts: Counts | null = null;
  let error: string | null = null;
  try {
    const api = createServerApiClient();
    const [users, departments, roles] = await Promise.all([
      api.listAdminUsers({ limit: 1 }),
      api.listAdminDepartments({ limit: 1 }),
      api.listAdminRoles({ limit: 1 }),
    ]);
    counts = { users: users.total, departments: departments.total, roles: roles.total };
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Quản trị tổ chức"
        lead="Tài khoản, phòng ban và vai trò của tổ chức. Khu vực này chỉ dành cho người giữ vai trò quản trị hệ thống."
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      {counts ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <AdminCard
            href="/admin/users"
            title="Người dùng"
            count={counts.users}
            description="Tạo tài khoản, gán phòng ban và vai trò, đặt lại mật khẩu."
          />
          <AdminCard
            href="/admin/departments"
            title="Phòng ban"
            count={counts.departments}
            description="Danh mục phòng ban dùng để gán phạm vi dữ liệu cho người và bản ghi."
          />
          <AdminCard
            href="/admin/roles"
            title="Vai trò"
            count={counts.roles}
            description="Danh mục vai trò mà quy trình gán việc và người dùng có thể giữ."
          />
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Cách phân quyền hoạt động</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-muted">
          Bản này dùng mô hình quyền cố định. Khu vực quản trị quyết định{' '}
          <em>ai giữ vai trò nào</em>; nó không tạo ra quyền tuỳ ý cho từng màn hình.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Quản trị hệ thống</CardTitle>
            <CardDescription>
              Quản lý tài khoản, phòng ban và vai trò. Xem mọi bản ghi, bỏ qua phạm vi phòng ban.
              Vẫn không được duyệt việc của vai trò khác. Nhật ký vận hành nằm ở màn hình Vận hành.
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Thiết kế quy trình</CardTitle>
            <CardDescription>
              Tạo và phát hành định nghĩa dữ liệu, quy trình và chỉ số báo cáo. Đọc dữ liệu theo
              đúng phạm vi của mình.
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Vai trò nghiệp vụ</CardTitle>
            <CardDescription>
              Nhận việc ở bước quy trình gán cho vai trò đó và ra quyết định duyệt, trả về hoặc từ
              chối. Một người có thể giữ nhiều vai trò.
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Phạm vi dữ liệu</CardTitle>
            <CardDescription>
              Người dùng đọc bản ghi của phòng ban mình, bản ghi mình đã tạo và bản ghi đang chờ vai
              trò mình xử lý. Quản trị hệ thống đọc được tất cả.
            </CardDescription>
          </Card>
        </div>
      </section>

      <p className="mt-8 text-sm text-on-surface-muted">
        Tài khoản quản trị đầu tiên được tạo ngoài giao diện khi cài đặt hệ thống. Sau đó, mọi tài
        khoản khác có thể tạo và quản lý tại đây.
      </p>
    </>
  );
}

function AdminCard({
  href,
  title,
  count,
  description,
}: {
  href: string;
  title: string;
  count: number;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-surface-raised p-5 transition-colors hover:border-border-strong hover:bg-surface-overlay"
    >
      <p className="text-xs font-medium tracking-wide text-on-surface-muted uppercase">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{count}</p>
      <p className="mt-2 text-sm leading-relaxed text-on-surface-muted">{description}</p>
      <span className="mt-3 inline-block text-sm font-medium text-accent-strong">Mở →</span>
    </Link>
  );
}
