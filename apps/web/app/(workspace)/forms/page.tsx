import Link from 'next/link';
import type { BusinessObject } from '@opvaryn/contracts';

import { ObjectForm } from '@/components/forms/object-form';
import { FieldSchema } from '@/components/objects/field-schema';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { isAdmin } from '@/lib/access';
import { advancedVisible } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Nhập liệu' };

interface PageProps {
  searchParams: Promise<{ object?: string }>;
}

const PLANNED_CAPABILITIES: readonly { title: string; body: string }[] = [
  {
    title: 'Điều kiện hiển thị theo dữ liệu đã nhập',
    body: 'Field chỉ hiện khi một lựa chọn trước đó thoả điều kiện. Sẽ làm cùng lúc với điều kiện rẽ nhánh trong quy trình.',
  },
  {
    title: 'Calculated field',
    body: 'Giá trị tính từ field khác (ví dụ tổng tiền theo danh mục). Cần khai báo biểu thức và kiểm tra kiểu dữ liệu.',
  },
  {
    title: 'External lookup khi tích hợp',
    body: 'Gợi ý dữ liệu từ hệ thống ngoài (danh mục nhà cung cấp, mã nhân viên) thuộc phạm vi Integration Hub.',
  },
  {
    title: 'Dòng lặp dạng bảng',
    body: 'Mỗi mục của trường danh sách hiện nhập một dòng. Bảng có nút thêm và xoá dòng sẽ làm ở phiên bản sau.',
  },
];

/** loadRoles answers who is asking; a broken API keeps the build status hidden. */
async function loadRoles(): Promise<string[]> {
  try {
    const me = await createServerApiClient().getMe();
    return me.roles;
  } catch {
    return [];
  }
}

export default async function FormsPage({ searchParams }: PageProps) {
  const { object: requestedKey } = await searchParams;
  const api = createServerApiClient();

  let objects: BusinessObject[] = [];
  let error: string | null = null;
  try {
    objects = (await api.listBusinessObjects({ limit: 100 })).data;
  } catch (cause) {
    error = describeApiError(cause);
  }

  const selected =
    objects.find((object) => object.key === requestedKey) ??
    (objects.length > 0 ? objects[0] : null);

  // Build status ("chưa có trong V1") is for the administrator in advanced mode (ADR 0015).
  const [roles, advanced] = await Promise.all([loadRoles(), getAdvancedMode()]);
  const showAdvanced = advancedVisible(isAdmin(roles), advanced);

  return (
    <>
      <PageHeader
        eyebrow="03 / Nhập liệu"
        title="Nhập liệu"
        lead="Điền dữ liệu vào mẫu có sẵn. Các ô nhập được tạo từ định nghĩa dữ liệu nên luôn khớp với những gì hệ thống lưu, và mỗi loại dữ liệu có mẫu riêng của nó."
      />

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được loại dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <p className="mt-4 text-sm text-on-surface-muted">
            Thử lại sau ít phút. Nếu vẫn không được, báo cho người quản trị hệ thống.
          </p>
        </Card>
      ) : null}

      {!error && objects.length === 0 ? (
        <Card>
          <CardTitle>Chưa có định nghĩa nào để dựng màn nhập liệu</CardTitle>
          <CardDescription>
            Màn nhập liệu sinh từ định nghĩa dữ liệu. Tạo định nghĩa đầu tiên ở trang Dữ liệu rồi
            quay lại đây.
          </CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Tạo loại dữ liệu
          </Link>
        </Card>
      ) : null}

      {selected ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-xs tracking-wide text-on-surface-muted uppercase">
              Chọn loại dữ liệu
            </span>
            {objects.map((object) => (
              <Link
                key={object.key}
                href={`/forms?object=${object.key}`}
                aria-current={object.key === selected.key ? 'true' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  object.key === selected.key
                    ? 'border-accent-strong/50 bg-accent/10 text-on-surface'
                    : 'border-border text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
                )}
              >
                {object.name}
              </Link>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{`Nhập ${selected.name}`}</CardTitle>
                  <CardDescription>
                    Đây chính là màn hình nhập bản ghi. Điền thử rồi bấm lưu — dữ liệu được kiểm tra
                    và lưu ngay.
                  </CardDescription>
                </div>
              </div>
              <div className="mt-5">
                <ObjectForm object={selected} />
              </div>
            </Card>

            <div className="min-w-0 space-y-6">
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                  Các trường của loại dữ liệu này
                </h2>
                <FieldSchema object={selected} />
              </section>

              {showAdvanced ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                      Chưa có trong V1
                    </h2>
                    <StatusBadge kind="concept" />
                  </div>
                  <ul className="space-y-3">
                    {PLANNED_CAPABILITIES.map((item) => (
                      <li
                        key={item.title}
                        className="rounded-lg border border-border bg-surface-raised/40 px-3 py-2.5"
                      >
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-on-surface-muted">
                          {item.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
