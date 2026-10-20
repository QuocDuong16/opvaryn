import type { Audience } from '@/lib/access';

export interface NavItem {
  href: string;
  index: string;
  label: string;
  description: string;
  /**
   * Who the entry is for. Everything the product does is for everyone signed in; organisation
   * administration and the screens that describe how it is built or operated are for the
   * administrator (ADR 0015, ADR 0022).
   */
  audience: Audience;
  /**
   * Administrator entries that describe how the system is built or operated also require
   * advanced mode. Organisation administration (`/admin`) is product work and does not.
   */
  requiresAdvanced?: boolean;
}

/**
 * Product navigation. The order follows the work: the overview, then the data people keep,
 * then the processes they run, then the reports. The administrator's screens come last and
 * only appear in advanced mode.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/overview',
    index: '01',
    label: 'Tổng quan',
    description: 'Việc đang chờ bạn và lối vào các phần chính',
    audience: 'everyone',
  },
  {
    href: '/objects',
    index: '02',
    label: 'Dữ liệu',
    description: 'Định nghĩa dữ liệu và bản ghi',
    audience: 'everyone',
  },
  {
    href: '/forms',
    index: '03',
    label: 'Nhập liệu',
    description: 'Màn hình nhập được tạo từ định nghĩa dữ liệu',
    audience: 'everyone',
  },
  {
    href: '/workflows',
    index: '04',
    label: 'Quy trình',
    description: 'Thiết kế quy trình, nhánh điều kiện và phiên bản',
    audience: 'everyone',
  },
  {
    href: '/tasks',
    index: '05',
    label: 'Việc của tôi',
    description: 'Việc đang chờ bạn xử lý',
    audience: 'everyone',
  },
  {
    href: '/analytics',
    index: '06',
    label: 'Báo cáo',
    description: 'Chỉ số và bảng số liệu tự cấu hình',
    audience: 'everyone',
  },
  {
    href: '/apps',
    index: '07',
    label: 'Ứng dụng',
    description: 'Cùng dữ liệu, nhiều dạng xem',
    audience: 'everyone',
  },
  {
    href: '/admin',
    index: '08',
    label: 'Quản trị',
    description: 'Tài khoản, phòng ban và vai trò',
    audience: 'admin',
  },
  {
    href: '/roadmap',
    index: '09',
    label: 'Lộ trình',
    description: 'Kế hoạch các mốc tiếp theo',
    audience: 'admin',
    requiresAdvanced: true,
  },
  {
    href: '/settings',
    index: '10',
    label: 'Vận hành',
    description: 'Endpoint, cổng và nhật ký tích hợp',
    audience: 'admin',
    requiresAdvanced: true,
  },
];

/**
 * navItemsFor returns the entries one person should see. Organisation administration appears
 * for every administrator; the build and operations screens need advanced mode on as well
 * (ADR 0015, ADR 0022). A non-administrator sees the product screens only.
 */
export function navItemsFor(isAdminUser: boolean, showAdvanced: boolean): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.audience === 'everyone') {
      return true;
    }
    if (!isAdminUser) {
      return false;
    }
    return !item.requiresAdvanced || showAdvanced;
  });
}

/**
 * navItemFor returns the nav entry matching a pathname, if any. Nested routes
 * (/objects/purchase_request) resolve to their area (/objects); the longest
 * matching path wins so overlapping hrefs cannot shadow each other.
 */
export function navItemFor(pathname: string): NavItem | undefined {
  let match: NavItem | undefined;
  for (const item of NAV_ITEMS) {
    const matches =
      item.href === '/'
        ? pathname === '/'
        : pathname.startsWith(`${item.href}/`) || pathname === item.href;
    if (matches && (!match || item.href.length > match.href.length)) {
      match = item;
    }
  }
  return match;
}
