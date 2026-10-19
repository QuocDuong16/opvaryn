import Link from 'next/link';
import type { BusinessObject, ObjectRecord } from '@opvaryn/contracts';

import { MiniApp, type MiniAppData } from '@/components/apps/mini-app';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Ứng dụng' };

/** Cap the records read per object so the showcase stays a summary, not a dump. */
const RECORDS_PER_APP = 25;

export default async function ApplicationsPage() {
  const api = createServerApiClient();

  let apps: MiniAppData[] = [];
  let error: string | null = null;

  try {
    const objects: BusinessObject[] = (await api.listBusinessObjects({ limit: 100 })).data;
    const withRecords = await Promise.all(
      objects.map(async (object) => {
        // The showcase shows a sample, not a dump: the API page is the sample.
        const records: ObjectRecord[] = (
          await api.listObjectRecords(object.key, { limit: RECORDS_PER_APP })
        ).data;
        return { object, records };
      }),
    );
    apps = withRecords;
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="07 / Ứng dụng"
        title="Ứng dụng"
        lead="Cùng một dữ liệu, nhiều dạng xem: danh sách, chi tiết, kanban, cấu hình và panel tích hợp — phần sẽ cho phép tự cấu hình ở bản sau. Danh sách và chi tiết đọc dữ liệu thật; kanban, cấu hình và tích hợp chỉ là minh hoạ, mỗi dạng xem gắn nhãn riêng."
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

      {!error && apps.length === 0 ? (
        <Card>
          <CardTitle>Chưa có loại dữ liệu nào để dựng ứng dụng</CardTitle>
          <CardDescription>
            Tạo định nghĩa dữ liệu đầu tiên ở trang Dữ liệu để dựng ứng dụng đầu tiên.
          </CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Tạo loại dữ liệu
          </Link>
        </Card>
      ) : null}

      {apps.length > 0 ? <MiniApp apps={apps} /> : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Đang chạy thật</CardTitle>
          <CardDescription>
            Danh sách và chi tiết đọc bản ghi đã lưu; thêm bản ghi mới sẽ xuất hiện ngay ở đây.
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Sẽ làm ở bản sau</CardTitle>
          <CardDescription>
            Tự định nghĩa dạng xem, thao tác theo vai trò và trạng thái, liên kết giữa các bản ghi,
            bảng số liệu nhúng và thư viện mẫu — chưa có trong bản này.
          </CardDescription>
        </Card>
      </section>
    </>
  );
}
