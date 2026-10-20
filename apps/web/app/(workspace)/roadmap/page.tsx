import { notFound } from 'next/navigation';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { isAdmin } from '@/lib/access';
import { advancedVisible } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';
import { createServerApiClient } from '@/lib/api/server';

export const metadata = { title: 'Lộ trình' };

const PHASES: readonly {
  tag: string;
  name: string;
  title: string;
  scope: string;
  goal: string;
  tone: 'accent' | 'blue' | 'purple' | 'amber';
}[] = [
  {
    tag: 'MVP V1 · Sản phẩm lõi',
    name: 'MVP V1',
    title: 'Nền tảng vận hành tối thiểu',
    scope:
      'Định nghĩa dữ liệu, form, quy trình có bước của người, hộp việc, phân quyền và lịch sử, báo cáo cơ bản, tích hợp giới hạn.',
    goal: 'Mục tiêu: giao được 2–3 quy trình thật.',
    tone: 'accent',
  },
  {
    tag: 'V1.x · Mở rộng vận hành',
    name: 'V1.x',
    title: 'Nhiều hành vi quy trình hơn',
    scope:
      'Duyệt song song, uỷ quyền, chuyển cấp nhiều tầng, hạn theo từng loại việc, webhook hai chiều và lịch chạy, sinh tài liệu, metric tính toán và báo cáo nâng cao.',
    goal: 'Mục tiêu: mở rộng năng lực quy trình, không chồng thêm hệ thống.',
    tone: 'blue',
  },
  {
    tag: 'V2 · Nền tảng ứng dụng',
    name: 'V2',
    title: 'Trình dựng ứng dụng',
    scope:
      'Danh sách/chi tiết/form/kanban tự dựng, quan hệ dữ liệu, hành động theo vai trò và trạng thái, bảng số liệu nhúng, tự động hoá giữa các quy trình, thư viện mẫu.',
    goal: 'Mục tiêu: tự dựng mini-app theo nghiệp vụ.',
    tone: 'purple',
  },
  {
    tag: 'V3 · Vận hành thông minh',
    name: 'V3',
    title: 'Phân tích quy trình & AI',
    scope:
      'AI hỗ trợ dựng form và quy trình, phát hiện bất thường, khai phá quy trình, gợi ý tối ưu và cấu hình bằng ngôn ngữ tự nhiên.',
    goal: 'Mục tiêu: phân tích và tối ưu quy trình có dữ liệu thực.',
    tone: 'amber',
  },
];

const MVP_ACCEPTANCE: readonly string[] = [
  'Quản trị tạo được định nghĩa dữ liệu, form và quy trình mới mà không cần sửa code.',
  'Nhân viên tạo bản ghi, submit, theo dõi trạng thái và nhận phản hồi.',
  'Có duyệt, rẽ nhánh theo điều kiện, từ chối / trả về / gửi lại.',
  'Quyền thao tác và quyền đọc dữ liệu được kiểm tra ở máy chủ, có lịch sử.',
  'Có ít nhất một tích hợp thật đang vận hành và xử lý lỗi rõ ràng.',
  'Người quản lý tự cấu hình bảng số liệu cơ bản với metric được cấp quyền.',
  'Khởi động lại và thử lại không mất trạng thái quy trình hay tạo hiệu ứng trùng.',
];

const OUT_OF_MVP: readonly { title: string; body: string }[] = [
  {
    title: 'Trình dựng ứng dụng đầy đủ',
    body: 'V1 chỉ làm một phần thu gọn trong màn Ứng dụng; V2 mới xây đầy đủ.',
  },
  {
    title: 'Workflow tự do vô hạn',
    body: 'Không hỗ trợ mọi dạng sơ đồ quy trình; ưu tiên những bước thật sự cần.',
  },
  {
    title: 'Báo cáo tự do',
    body: 'Bộ metric giới hạn, không mở câu lệnh SQL thô cho người dùng.',
  },
  {
    title: 'AI / tối ưu tự động',
    body: 'Chưa đủ tín hiệu và dữ liệu đáng tin để tối ưu bằng AI.',
  },
  {
    title: 'Nhiều tổ chức dùng chung',
    body: 'Đầu tiên dành cho một tổ chức nội bộ.',
  },
  {
    title: 'Chợ kết nối',
    body: 'Vài kết nối làm kỹ tốt hơn hàng chục kết nối chưa kiểm thử.',
  },
];

export default async function RoadmapPage() {
  // The roadmap is planning material for whoever runs the product: administrator only, and
  // only in advanced mode (ADR 0015).
  const [me, advanced] = await Promise.all([loadRoles(), getAdvancedMode()]);
  if (!advancedVisible(isAdmin(me), advanced)) {
    notFound();
  }

  return (
    <>
      <PageHeader
        eyebrow="08 / Lộ trình"
        title="Lộ trình"
        lead="Lộ trình sản phẩm: những mốc tiếp theo và điều kiện để một bản phát hành được coi là dùng được. Đây là kế hoạch, không phải tính năng đã có."
        aside={<StatusBadge kind="concept" />}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Sản phẩm đang ở đâu</CardTitle>
            <CardDescription>
              Mốc demo 8 tuần đã dựng xong và MVP V1 đang chạy trên cùng nền đó. Phần dưới đây là
              trạng thái thật của mã nguồn, không phải kế hoạch.
            </CardDescription>
          </div>
          <StatusBadge kind="live" />
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
              Đã chạy thật (live)
            </dt>
            <dd className="mt-1 text-sm">
              Tự định nghĩa dữ liệu và nhập bản ghi, với màn hình nhập sinh từ định nghĩa và dữ liệu
              được kiểm tra khi lưu. Đăng nhập và phân quyền theo vai trò và bộ phận. Hộp việc theo
              người, duyệt / trả về / từ chối, mọi quyết định đều được ghi lại. Thiết kế quy trình
              bằng canvas kéo thả trên bản nháp, publish thành phiên bản mới, chạy quy trình từ bản
              ghi và theo dõi từng lần chạy. Bảng số liệu tự cấu hình: metric định nghĩa trên field
              của bản ghi (đếm, tổng, trung bình, lọc, nhóm) cùng chỉ số vận hành quy trình (thời
              gian một vòng, thời gian một bước, tỉ lệ duyệt, tỉ lệ làm lại) — tất cả theo phạm vi
              dữ liệu người đọc được. Sản phẩm chạy trên một host nội bộ, có TLS, sao lưu định kỳ và
              đã diễn tập phục hồi.
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
              Mô phỏng (mock)
            </dt>
            <dd className="mt-1 text-sm">
              Kanban và panel tích hợp trong màn Ứng dụng — giao diện thật, dữ liệu minh hoạ.
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Chưa có</dt>
            <dd className="mt-1 text-sm">
              Kết nối hệ thống đăng nhập của tổ chức (SSO), mức ưu tiên và hạn theo từng loại việc,
              kết nối hai chiều với hệ thống ngoài, và các tiện ích của trình soạn quy trình (hoàn
              tác, nhiều người cùng sửa) — phần còn lại của V1.x và V2.
            </dd>
          </div>
        </dl>
      </Card>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Bốn phase</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PHASES.map((phase) => (
            <Card key={phase.name}>
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-xs tracking-wide text-accent-strong uppercase">
                  {phase.tag}
                </span>
                <StatusBadge kind="concept" />
              </div>
              <h3 className="mt-3 text-base font-semibold tracking-tight">{phase.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-muted">{phase.scope}</p>
              <p className="mt-3 text-sm font-medium">{phase.goal}</p>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-on-surface-muted">
          V1.x / V2 / V3 là định hướng, không có cam kết ngày phát hành; ưu tiên sẽ được xem lại sau
          khi chạy pilot.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Điều kiện nghiệm thu MVP V1</h2>
        <Card>
          <CardDescription>
            Một bản phát hành chỉ được coi là dùng được khi đủ những điều dưới đây. Bản hiện tại đã
            đáp ứng cả bảy: admin dựng được định nghĩa dữ liệu, form, quy trình và metric ngay trên
            giao diện; nhân viên tạo bản ghi và theo dõi trạng thái; có duyệt, nhánh điều kiện, từ
            chối và trả về; quyền và phạm vi được kiểm tra ở máy chủ kèm lịch sử; người quản lý tự
            cấu hình bảng số liệu; sự kiện được gửi ra hệ thống ngoài kèm thử lại và nhật ký; và
            việc khởi động lại hay thử lại không làm mất trạng thái quy trình cũng không áp dụng
            quyết định hai lần.
          </CardDescription>
          <ol className="mt-4 space-y-2.5">
            {MVP_ACCEPTANCE.map((item, index) => (
              <li key={item} className="flex gap-3 text-sm">
                <span className="w-5 shrink-0 font-mono text-xs text-on-surface-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Chủ động để ngoài MVP</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {OUT_OF_MVP.map((item) => (
            <Card key={item.title}>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-on-surface-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

/** loadRoles answers who is asking; a broken API hides this screen rather than showing it. */
async function loadRoles(): Promise<string[]> {
  try {
    const me = await createServerApiClient().getMe();
    return me.roles;
  } catch {
    return [];
  }
}
