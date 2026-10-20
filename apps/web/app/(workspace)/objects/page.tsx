import type { BusinessObject } from '@opvaryn/contracts';

import { CreateObjectForm } from '@/components/objects/create-object-form';
import { ObjectList } from '@/components/objects/object-list';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListSearch, Pagination, pageOffset } from '@/components/ui/list-controls';
import { PageHeader } from '@/components/ui/page-header';
import { DesignerNotice } from '@/components/ui/role-notice';
import { canDesign } from '@/lib/access';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { designerRoleName } from '@/lib/names';

export const metadata = { title: 'Dữ liệu' };

interface PageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

/** One page of definitions; the API slices, the screen never loads the whole table. */
const PER_PAGE = 25;

export default async function ObjectsPage({ searchParams }: PageProps) {
  const { q, offset: rawOffset } = await searchParams;
  const query = (q ?? '').trim();
  const offset = pageOffset(rawOffset, PER_PAGE);

  let objects: BusinessObject[] = [];
  let total = 0;
  let mayDesign = false;
  let roleName = 'vai trò thiết kế quy trình';
  let error: string | null = null;

  const api = createServerApiClient();
  try {
    const [page, me, roles] = await Promise.all([
      api.listBusinessObjects({ q: query || undefined, limit: PER_PAGE, offset }),
      api.getMe(),
      api
        .listRoles()
        .then((page) => page.data)
        .catch(() => []),
    ]);
    objects = page.data;
    total = page.total;
    mayDesign = canDesign(me.roles);
    roleName = designerRoleName(roles);
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="02 / Dữ liệu"
        title="Dữ liệu"
        lead="Định nghĩa dữ liệu nghiệp vụ: các trường có kiểu rõ ràng và khoá ổn định. Sửa định nghĩa là phát hành phiên bản mới; bản ghi cũ giữ nguyên định nghĩa lúc được tạo. Mở một định nghĩa để nhập bản ghi."
      />

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <p className="mt-4 text-sm text-on-surface-muted">
            Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
          </p>
        </Card>
      ) : null}

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {query ? `Kết quả cho “${query}” (${total})` : `Đang dùng (${total})`}
          </h2>
          <ListSearch
            basePath="/objects"
            value={query}
            placeholder="Tìm theo tên hoặc khoá"
            label="Tìm định nghĩa dữ liệu"
          />
        </div>

        <ObjectList objects={objects} filtered={query !== ''} />
        <Pagination
          total={total}
          limit={PER_PAGE}
          offset={offset}
          basePath="/objects"
          params={{ q: query || undefined }}
        />
      </section>

      {mayDesign ? (
        <details className="rounded-xl border border-border bg-surface-raised/40 px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold tracking-tight">
            Tạo định nghĩa dữ liệu mới
          </summary>
          <div className="mt-4 max-w-2xl">
            <CreateObjectForm />
          </div>
        </details>
      ) : (
        <DesignerNotice roleName={roleName} what="tạo và sửa định nghĩa dữ liệu" />
      )}
    </>
  );
}
