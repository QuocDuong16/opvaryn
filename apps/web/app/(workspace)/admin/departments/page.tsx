import { notFound } from 'next/navigation';
import type { AdminDepartment } from '@opvaryn/contracts';

import { deleteAdminDepartmentAction } from '@/app/(workspace)/admin/actions';
import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { DeleteForm } from '@/components/admin/delete-form';
import { CreateDepartmentForm, RenameDepartmentForm } from '@/components/admin/department-forms';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Phòng ban' };

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

export default async function AdminDepartmentsPage({ searchParams }: PageProps) {
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

  let departments: AdminDepartment[] = [];
  let total = 0;
  let error: string | null = null;

  try {
    const page = await createServerApiClient().listAdminDepartments({
      q: query || undefined,
      limit: PER_PAGE,
      offset,
    });
    departments = page.data;
    total = page.total;
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Phòng ban"
        lead="Phòng ban là danh mục đóng: mỗi người và mỗi bản ghi thuộc về đúng một phòng ban, và đó là phạm vi dữ liệu họ đọc được."
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {query ? `Kết quả cho “${query}” (${total})` : `Danh mục (${total})`}
          </h2>
          <ListSearch
            basePath="/admin/departments"
            value={query}
            placeholder="Tìm theo tên"
            label="Tìm phòng ban"
          />
        </div>

        {departments.length === 0 && !error ? (
          <Card>
            <CardDescription>
              {query
                ? 'Không có phòng ban nào khớp từ khoá.'
                : 'Chưa có phòng ban nào. Tạo phòng ban đầu tiên bên dưới.'}
            </CardDescription>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Phòng ban
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Số người
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
                {departments.map((department) => (
                  <tr key={department.key}>
                    <td className="px-4 py-3 align-top font-medium">{department.name}</td>
                    <td className="px-4 py-3 align-top text-on-surface-muted">
                      {department.userCount}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <RenameDepartmentForm department={department} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <DeleteForm
                        action={deleteAdminDepartmentAction}
                        hiddenValue={department.key}
                        label="Xoá phòng ban"
                        confirmMessage={`Xoá phòng ban “${department.name}”?`}
                        disabled={department.userCount > 0}
                        disabledNote={
                          department.userCount > 0
                            ? `Còn ${department.userCount} người thuộc phòng ban này. Hãy chuyển họ sang phòng ban khác trước.`
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
          basePath="/admin/departments"
          params={{ q: query || undefined }}
        />
      </section>

      <details className="mt-8 rounded-xl border border-border bg-surface-raised/40 px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold tracking-tight">
          Tạo phòng ban mới
        </summary>
        <div className="mt-4 max-w-2xl">
          <CreateDepartmentForm />
        </div>
      </details>

      <Card className="mt-6">
        <CardTitle>Vì sao không xoá được?</CardTitle>
        <CardDescription>
          Một phòng ban còn người thuộc về nó thì không thể xoá. Phòng ban đang là phạm vi của bản
          ghi cũng vậy: xoá đi sẽ làm thay đổi ai đọc được những bản ghi đó. Hãy đổi tên nếu chỉ
          muốn cập nhật cách gọi.
        </CardDescription>
      </Card>
    </>
  );
}
