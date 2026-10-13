import Link from 'next/link';
import type { BusinessObject } from '@opvaryn/contracts';

import { ObjectForm } from '@/components/forms/object-form';
import { FieldSchema } from '@/components/objects/field-schema';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Forms' };

interface PageProps {
  searchParams: Promise<{ object?: string }>;
}

const PLANNED_CAPABILITIES: readonly { title: string; body: string }[] = [
  {
    title: 'Điều kiện hiển thị theo dữ liệu đã nhập',
    body: 'Field chỉ hiện khi một lựa chọn trước đó thoả điều kiện. Cần rule engine chung với workflow nên để sau khi chốt D05/D08.',
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
    title: 'Upload tệp và repeating rows dạng bảng',
    body: 'Trường tệp cần object storage; rows trong demo nhập mỗi dòng một mục. Bản đầy đủ thuộc MVP.',
  },
];

export default async function FormsPage({ searchParams }: PageProps) {
  const { object: requestedKey } = await searchParams;
  const api = createServerApiClient();

  let objects: BusinessObject[] = [];
  let error: string | null = null;
  try {
    objects = await api.listBusinessObjects();
  } catch (cause) {
    error = describeApiError(cause);
  }

  const selected =
    objects.find((object) => object.key === requestedKey) ??
    (objects.length > 0 ? objects[0] : null);

  return (
    <>
      <PageHeader
        eyebrow="03 / Form builder"
        title="Forms"
        lead="Giao diện nhập liệu được sinh trực tiếp từ schema business object: không viết code cho từng form, không lệch giữa định nghĩa và màn hình nhập. Preview dưới đây là form thật — lưu bản ghi qua API và PostgreSQL."
        aside={<StatusBadge kind={error ? 'mock' : 'live'} />}
      />

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được business object</CardTitle>
          <CardDescription>{error}</CardDescription>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-on-surface-muted">
            make docker-up{'\n'}cd apps/api &amp;&amp; go run ./cmd/migrate{'\n'}make seed-demo
            {'\n'}
            make dev
          </pre>
        </Card>
      ) : null}

      {!error && objects.length === 0 ? (
        <Card>
          <CardTitle>Chưa có schema để dựng form</CardTitle>
          <CardDescription>
            Form Builder cần ít nhất một business object. Tạo định nghĩa ở trang Business Objects
            hoặc nạp bộ dữ liệu mẫu bằng <code className="font-mono text-xs">make seed-demo</code>.
          </CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Tạo business object
          </Link>
        </Card>
      ) : null}

      {selected ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-xs tracking-wide text-on-surface-muted uppercase">
              Chọn schema
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
                <span className="ml-1.5 font-mono text-[10px] text-on-surface-muted">
                  {object.key}
                </span>
              </Link>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Preview form — {selected.name}</CardTitle>
                  <CardDescription>
                    Đúng component đang dùng ở màn hình nhập bản ghi. Thử nhập một bản ghi thật để
                    thấy validate và lưu dữ liệu hoạt động.
                  </CardDescription>
                </div>
                <StatusBadge kind="live" />
              </div>
              <div className="mt-5">
                <ObjectForm object={selected} />
              </div>
            </Card>

            <div className="min-w-0 space-y-6">
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                  Schema nguồn
                </h2>
                <FieldSchema object={selected} />
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold tracking-wide text-on-surface-muted uppercase">
                    Chưa có trong demo
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
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
