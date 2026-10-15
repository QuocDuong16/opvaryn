import Link from 'next/link';
import type { BusinessObject } from '@opvaryn/contracts';

import { CreateObjectForm } from '@/components/objects/create-object-form';
import { ObjectList } from '@/components/objects/object-list';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Dữ liệu' };

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ObjectsPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const needle = (q ?? '').trim().toLowerCase();

  let objects: BusinessObject[] = [];
  let error: string | null = null;

  try {
    objects = await createServerApiClient().listBusinessObjects();
  } catch (cause) {
    error = describeApiError(cause);
  }

  // The filter runs on the server and travels in the URL, so a search can be shared and
  // works without JavaScript.
  const shown = needle
    ? objects.filter(
        (object) =>
          object.name.toLowerCase().includes(needle) || object.key.toLowerCase().includes(needle),
      )
    : objects;

  return (
    <>
      <PageHeader
        eyebrow="02 / Dữ liệu"
        title="Dữ liệu"
        lead="Định nghĩa dữ liệu nghiệp vụ: các field có kiểu rõ ràng và khoá ổn định. Sửa định nghĩa là phát hành phiên bản mới; bản ghi cũ giữ nguyên định nghĩa lúc được tạo. Mở một định nghĩa để nhập bản ghi."
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
            {needle ? `Kết quả cho “${q}” (${shown.length})` : `Đang dùng (${shown.length})`}
          </h2>
          <form method="get" className="flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Tìm theo tên hoặc key"
              aria-label="Tìm định nghĩa dữ liệu"
              className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm placeholder:text-on-surface-muted/60 focus:border-accent-strong focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-overlay"
            >
              Tìm
            </button>
            {needle ? (
              <Link href="/objects" className="text-sm text-accent-strong hover:underline">
                Xoá lọc
              </Link>
            ) : null}
          </form>
        </div>

        <ObjectList objects={shown} filtered={needle !== ''} />
      </section>

      <details className="rounded-xl border border-border bg-surface-raised/40 px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold tracking-tight">
          Tạo định nghĩa dữ liệu mới
        </summary>
        <div className="mt-4 max-w-2xl">
          <CreateObjectForm />
        </div>
      </details>
    </>
  );
}
