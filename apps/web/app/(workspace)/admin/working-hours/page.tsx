import { notFound } from 'next/navigation';
import type { WorkingHour } from '@opvaryn/contracts';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { WorkingHoursForm } from '@/components/admin/working-hours-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

export const metadata = { title: 'Giờ làm việc' };

const WEEKDAYS = [
  'Chủ nhật',
  'Thứ hai',
  'Thứ ba',
  'Thứ tư',
  'Thứ năm',
  'Thứ sáu',
  'Thứ bảy',
] as const;

/** minuteLabel renders a minute of the day as a clock time. */
function minuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export default async function AdminWorkingHoursPage() {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  let hours: WorkingHour[] = [];
  let error: string | null = null;
  try {
    hours = (await createServerApiClient().listWorkingHours()).data;
  } catch (cause) {
    error = describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị"
        title="Giờ làm việc"
        lead="Lịch giờ làm việc của tổ chức. Hạn xử lý của một việc được tính theo lịch này: một việc giao lúc 16:00 thứ Sáu với hạn 4 giờ làm việc sẽ hết hạn lúc 12:00 thứ Hai."
      />
      <AdminNav />

      {error ? <AdminLoadError message={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <WorkingHoursForm hours={hours} />

        <Card>
          <CardTitle>Vì sao cần lịch</CardTitle>
          <CardDescription>
            <ul className="mt-2 space-y-2 text-sm">
              <li>
                Không có lịch, &quot;4 giờ làm việc&quot; sẽ là 4 giờ lịch sử, tính cả đêm và cuối
                tuần.
              </li>
              <li>Việc được giao ngoài giờ làm việc vẫn được tính từ giờ làm việc kế tiếp.</li>
              <li>Đổi lịch không đổi hạn của việc đang mở, nhưng việc mới thì có.</li>
            </ul>
          </CardDescription>
        </Card>
      </div>

      <section className="mt-8">
        <Card>
          <CardTitle>Lịch hiện tại</CardTitle>
          <CardDescription>
            {hours.length === 0
              ? 'Chưa có lịch — hệ thống dùng lịch mặc định: thứ Hai đến thứ Sáu, 09:00–17:00.'
              : hours
                  .map(
                    (hour) =>
                      `${WEEKDAYS[hour.weekday] ?? 'Ngày ' + hour.weekday}: ${minuteLabel(hour.start)}–${minuteLabel(hour.end)}`,
                  )
                  .join(' · ')}
          </CardDescription>
        </Card>
      </section>
    </>
  );
}
