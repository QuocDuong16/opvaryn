import Link from 'next/link';
import type { BusinessObject, ObjectRecord } from '@opvaryn/contracts';

import { MiniApp, type MiniAppData } from '@/components/apps/mini-app';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Applications' };

/** Cap the records read per object so the showcase stays a summary, not a dump. */
const RECORDS_PER_APP = 25;

export default async function ApplicationsPage() {
  const api = createServerApiClient();

  let apps: MiniAppData[] = [];
  let error: string | null = null;

  try {
    const objects: BusinessObject[] = await api.listBusinessObjects();
    const withRecords = await Promise.all(
      objects.map(async (object) => {
        const records: ObjectRecord[] = await api.listObjectRecords(object.key);
        return { object, records: records.slice(0, RECORDS_PER_APP) };
      }),
    );
    apps = withRecords;
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="07 / Application builder"
        title="Applications"
        lead="Cùng một business object, nhiều dạng xem: danh sách, chi tiết, kanban, cấu hình quản trị và panel tích hợp — thứ mà Application Builder (V2) sẽ cho admin tự cấu hình. Danh sách và chi tiết đọc dữ liệu thật; kanban, cấu hình và connector là mô phỏng hoặc concept, mỗi view gắn nhãn riêng."
        aside={<StatusBadge kind={error ? 'mock' : 'live'} />}
      />

      {error ? (
        <Card className="mb-6 border-warning/40">
          <CardTitle className="text-warning">Không đọc được dữ liệu</CardTitle>
          <CardDescription>{error}</CardDescription>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-on-surface-muted">
            make docker-up{'\n'}cd apps/api &amp;&amp; go run ./cmd/migrate{'\n'}make seed-demo
            {'\n'}
            make dev
          </pre>
        </Card>
      ) : null}

      {!error && apps.length === 0 ? (
        <Card>
          <CardTitle>Chưa có business object để dựng mini-app</CardTitle>
          <CardDescription>
            Tạo định nghĩa đầu tiên ở trang Business Objects, hoặc nạp bộ dữ liệu mẫu bằng{' '}
            <code className="font-mono text-xs">make seed-demo</code> để xem hai mini-app ví dụ.
          </CardDescription>
          <Link
            href="/objects"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Tạo business object
          </Link>
        </Card>
      ) : null}

      {apps.length > 0 ? <MiniApp apps={apps} /> : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Trong demo đã là thật</CardTitle>
          <CardDescription>
            Danh sách và chi tiết đọc bản ghi từ PostgreSQL qua API Go; thêm bản ghi ở Business
            Objects sẽ xuất hiện ngay ở đây.
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Phần còn lại của V2</CardTitle>
          <CardDescription>
            Admin tự định nghĩa view, action theo role và trạng thái, liên kết đối tượng, dashboard
            nhúng và template library — thuộc định hướng Application Platform, không phải MVP V1.
          </CardDescription>
        </Card>
      </section>
    </>
  );
}
