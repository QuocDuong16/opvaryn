import Link from 'next/link';
import { ApiError, type BusinessObject, type RoleEntry } from '@opvaryn/contracts';

import { CreateWorkflowEditor } from '@/components/workflows/create-workflow-editor';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { isAdmin } from '@/lib/access';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { labelOrKey } from '@/lib/names';

export const metadata = { title: 'Quy trình mới' };

/**
 * The create screen draws the process instead of describing it (ADR 0019): a designer
 * answers what the process is for and who receives the first step, arranges the steps on
 * the canvas, and publishing creates version 1 of exactly that.
 */
export default async function NewWorkflowPage() {
  const api = createServerApiClient();

  let objects: BusinessObject[] = [];
  let catalogue: RoleEntry[] = [];
  let myRoles: string[] = [];
  let error: string | null = null;
  let needsSignIn = false;

  try {
    const [objectPage, roles, me] = await Promise.all([
      api.listBusinessObjects({ limit: 100 }),
      api.listRoles({ limit: 100 }).then((page) => page.data),
      api.getMe(),
    ]);
    objects = objectPage.data;
    catalogue = roles;
    myRoles = me.roles;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      needsSignIn = true;
    } else {
      error = describeApiError(cause);
    }
  }

  const mayDesign = myRoles.includes('process_designer') || isAdmin(myRoles);
  // The role is data, so the screen names it the way the catalogue does (ADR 0016); when
  // nobody has named it, it is described in prose rather than printed as a key.
  const designerLabel = labelOrKey(
    catalogue.find((entry) => entry.key === 'process_designer')?.label,
    'vai trò thiết kế quy trình',
  );

  return (
    <>
      <PageHeader
        eyebrow="04 / Quy trình"
        title="Quy trình mới"
        lead="Vẽ một quy trình mới trên sơ đồ: nhận yêu cầu, giao việc cho người, đặt điều kiện rẽ nhánh và kết thúc. Tạo xong là chạy được ngay."
      />

      <p className="mb-6 text-sm">
        <Link href="/workflows" className="text-on-surface-muted hover:text-on-surface">
          ← Tất cả quy trình
        </Link>
      </p>

      {needsSignIn ? (
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Cần đăng nhập để tạo quy trình</CardTitle>
          <CardDescription>
            Tạo quy trình cần {designerLabel} hoặc vai trò quản trị hệ thống.
          </CardDescription>
          <Link
            href="/login?next=/workflows/new"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Đăng nhập
          </Link>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu để tạo quy trình</CardTitle>
          <CardDescription>{error}</CardDescription>
          <p className="mt-4 text-sm text-on-surface-muted">
            Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
          </p>
        </Card>
      ) : null}

      {!needsSignIn && !error && objects.length === 0 ? (
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Chưa có loại dữ liệu nào</CardTitle>
          <CardDescription>
            Quy trình đọc dữ liệu của một loại bản ghi, nên cần có ít nhất một loại dữ liệu trước
            khi vẽ quy trình.
          </CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            Tạo loại dữ liệu đầu tiên →
          </Link>
        </Card>
      ) : null}

      {!needsSignIn && !error && objects.length > 0 && !mayDesign ? (
        <Card className="border-warning/40">
          <CardTitle className="text-warning">Bạn chưa có quyền tạo quy trình</CardTitle>
          <CardDescription>
            {`Tạo và phát hành quy trình cần ${designerLabel} hoặc vai trò quản trị hệ thống. Bạn vẫn xem được mọi quy trình đang dùng.`}
          </CardDescription>
          <Link
            href="/workflows"
            className="mt-4 inline-block text-sm font-medium text-accent-strong hover:underline"
          >
            ← Xem các quy trình đang dùng
          </Link>
        </Card>
      ) : null}

      {!needsSignIn && !error && objects.length > 0 && mayDesign ? (
        <CreateWorkflowEditor objects={objects} knownRoles={catalogue} />
      ) : null}
    </>
  );
}
