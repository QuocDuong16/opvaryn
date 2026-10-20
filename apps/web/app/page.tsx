import Link from 'next/link';
import { ApiError, type Meta } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { createServerApiClient } from '@/lib/api/server';
import { stageLabel } from '@/lib/stage';

export const metadata = {
  title: 'OPVARYN — Business Operations Platform',
  description:
    'Nền tảng để tổ chức tự định nghĩa dữ liệu, quy trình phê duyệt, biểu mẫu và báo cáo của mình — thay vì mua một công cụ cho mỗi nghiệp vụ.',
};

/**
 * The public front page (ADR 0014): what the product is, what it does and what it does
 * not do yet, for someone who has no account. It must stay honest — no invented
 * customers, logos, testimonials or prices — because the same page is what a buyer
 * reads before asking for a pilot.
 */
const CAPABILITIES: readonly { title: string; body: string }[] = [
  {
    title: 'Dữ liệu do bạn định nghĩa',
    body: 'Khai loại dữ liệu với các trường có kiểu, mỗi lần sửa là một phiên bản mới. Bản ghi cũ giữ đúng cấu trúc lúc nó được tạo, nên đổi định nghĩa không phá dữ liệu đã có.',
  },
  {
    title: 'Biểu mẫu sinh từ định nghĩa',
    body: 'Mỗi định nghĩa có ngay màn hình nhập liệu tương ứng, không phải viết code cho từng biểu mẫu. Kiểm tra dữ liệu nằm ở máy chủ, theo đúng phiên bản định nghĩa của bản ghi.',
  },
  {
    title: 'Quy trình phê duyệt chạy thật',
    body: 'Việc giao cho người theo vai trò, rẽ nhánh bằng điều kiện trên dữ liệu, duyệt / trả về / từ chối. Mọi thay đổi đều được ghi lại và không sửa được về sau.',
  },
  {
    title: 'Hộp việc theo vai trò',
    body: 'Mỗi người chỉ thấy việc thuộc vai trò mình giữ, kèm bản ghi và lịch sử của lần chạy. Hai người quyết cùng lúc thì người sau nhận lỗi xung đột, không ghi đè.',
  },
  {
    title: 'Báo cáo không cần SQL',
    body: 'Chỉ số tự định nghĩa trên trường của bản ghi (đếm, tổng, trung bình, lọc, nhóm) cùng số liệu vận hành của quy trình: thời gian một vòng, tỉ lệ duyệt, tỉ lệ làm lại. Con số luôn theo phạm vi dữ liệu người đọc được.',
  },
  {
    title: 'Nối ra hệ thống khác',
    body: 'Sự kiện của quy trình được gửi ra hệ thống khác dưới dạng webhook có ký xác thực, tự thử lại và có nhật ký giao. Quyết định của người dùng không bao giờ phụ thuộc vào việc gửi thành công.',
  },
];

const TRUST: readonly { title: string; body: string }[] = [
  {
    title: 'Phân quyền kiểm tra ở máy chủ',
    body: 'Quyền theo vai trò và bộ phận được kiểm tra ở máy chủ cho mọi lần đọc và ghi. Bản ghi ngoài phạm vi trả về "không tồn tại" thay vì tiết lộ rằng nó có ở đó.',
  },
  {
    title: 'Định nghĩa bất biến theo phiên bản',
    body: 'Sửa một định nghĩa là phát hành phiên bản mới. Quy trình đang chạy và bản ghi đã nhập giữ nguyên phiên bản chúng bắt đầu, nên thay đổi không làm sai lệch dữ liệu cũ.',
  },
  {
    title: 'Chạy trong hạ tầng của bạn',
    body: 'Một máy chủ nội bộ bằng Docker Compose: TLS, job sao lưu định kỳ và quy trình diễn tập phục hồi có kiểm chứng. Không phải SaaS nhiều tổ chức, dữ liệu không đi ra ngoài.',
  },
  {
    title: 'Nhãn trạng thái trung thực',
    body: 'Phần nào mô phỏng được gắn nhãn rõ ràng, phần nào chưa làm thì nói là chưa làm — trên chính sản phẩm, không chỉ trong tài liệu.',
  },
];

const STATUS: readonly { title: string; body: string }[] = [
  {
    title: 'Đang chạy (MVP V1)',
    body: 'Loại dữ liệu và bản ghi, biểu mẫu sinh từ định nghĩa, quy trình phê duyệt với hộp việc và hạn xử lý theo giờ làm việc, phân quyền theo vai trò và bộ phận, xác thực hai bước cho tài khoản quản trị, chỉ số tự định nghĩa cùng số liệu vận hành, gửi sự kiện ra hệ thống ngoài, và triển khai trên một máy chủ có sao lưu.',
  },
  {
    title: 'Chưa có',
    body: 'Đăng nhập qua OIDC/SSO (chờ IdP của tổ chức), kết nối hai chiều với hệ thống ngoài, các dạng xem kanban/connector đang ở mức minh hoạ, và những phần của quy trình nhiều nhánh song song.',
  },
];

async function loadMeta(): Promise<Meta | null> {
  try {
    return await createServerApiClient().getMeta();
  } catch {
    return null;
  }
}

async function hasSession(): Promise<boolean> {
  try {
    await createServerApiClient().getMe();
    return true;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      return false;
    }
    return false;
  }
}

export default async function LandingPage() {
  const [meta, signedIn] = await Promise.all([loadMeta(), hasSession()]);
  const entry = signedIn
    ? { href: '/overview', label: 'Vào workspace' }
    : { href: '/login', label: 'Đăng nhập' };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 font-mono text-sm text-accent-strong"
            >
              ◎
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight">OPVARYN</span>
              <span className="block truncate text-[11px] text-on-surface-muted">
                Business Operations Platform
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-on-surface-muted md:flex">
            <a href="#nang-luc" className="hover:text-on-surface">
              Năng lực
            </a>
            <a href="#vi-sao" className="hover:text-on-surface">
              Vì sao
            </a>
            <a href="#trang-thai" className="hover:text-on-surface">
              Trạng thái
            </a>
          </nav>

          <Link
            href={entry.href}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            {entry.label}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
            Business Operations Platform
          </p>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
            Phần mềm nội bộ theo đúng cách tổ chức bạn vận hành
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-on-surface-muted">
            OPVARYN để đội của bạn tự định nghĩa dữ liệu, quy trình phê duyệt, biểu mẫu và báo cáo
            của mình — thay vì mua một công cụ cho mỗi nghiệp vụ rồi ghép chúng lại bằng bảng tính
            và tin nhắn.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={entry.href}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              {entry.label}
            </Link>
            <a
              href="#nang-luc"
              className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-surface-overlay"
            >
              Xem năng lực
            </a>
          </div>

          <dl className="mt-14 grid gap-6 border-t border-border pt-8 sm:grid-cols-3">
            <div>
              <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                Quy trình pilot
              </dt>
              <dd className="mt-1 text-sm">
                Duyệt mua hàng, xử lý sự cố IT và onboarding nhân sự — chạy thật, không phải minh
                hoạ.
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Kiểm soát</dt>
              <dd className="mt-1 text-sm">
                Phân quyền theo vai trò và bộ phận, lịch sử thao tác không sửa được, định nghĩa theo
                phiên bản.
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-on-surface-muted uppercase">Triển khai</dt>
              <dd className="mt-1 text-sm">
                Một máy chủ nội bộ, TLS, sao lưu định kỳ và diễn tập phục hồi có kiểm chứng.
              </dd>
            </div>
          </dl>
        </section>

        <section id="nang-luc" className="border-t border-border bg-surface-raised/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight">Nền tảng làm được gì</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-muted">
              Sáu năng lực dưới đây đều đang chạy trong bản MVP V1, không phải bản mô phỏng giao
              diện.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <Card key={item.title}>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.body}</CardDescription>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="vi-sao" className="border-t border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight">Vì sao đáng tin</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-muted">
              Những điều dưới đây là ràng buộc kỹ thuật của sản phẩm, được kiểm chứng bằng test và
              bằng chứng chạy được trong repo — không phải lời hứa trên trang giới thiệu.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {TRUST.map((item) => (
                <Card key={item.title}>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.body}</CardDescription>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="trang-thai" className="border-t border-border bg-surface-raised/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight">Trạng thái hiện tại</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-muted">
              OPVARYN đang ở bản MVP V1. Chúng tôi nói rõ phần nào đã chạy và phần nào chưa, để bạn
              đánh giá được trước khi đưa vào dùng thật.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {STATUS.map((item) => (
                <Card key={item.title}>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.body}</CardDescription>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-on-surface-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            OPVARYN · {meta ? `${stageLabel(meta.stage)} · phiên bản ${meta.version}` : 'MVP V1'}
          </p>
          <p>Phần mềm nội bộ cho tổ chức · không phải dịch vụ nhiều tổ chức dùng chung.</p>
        </div>
      </footer>
    </div>
  );
}
