export interface NavItem {
  href: string;
  index: string;
  label: string;
  description: string;
}

/**
 * Demo navigation. The order follows the playbook demo plan: the shell and
 * business objects come first, applications last.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/',
    index: '01',
    label: 'Tổng quan',
    description: 'Tầm nhìn, phạm vi demo và trạng thái nền tảng',
  },
  {
    href: '/objects',
    index: '02',
    label: 'Business Objects',
    description: 'Định nghĩa dữ liệu nghiệp vụ và field schema',
  },
  {
    href: '/forms',
    index: '03',
    label: 'Forms',
    description: 'Giao diện nhập liệu sinh từ schema',
  },
  {
    href: '/workflows',
    index: '04',
    label: 'Workflows',
    description: 'Thiết kế quy trình, nhánh điều kiện và version',
  },
  {
    href: '/tasks',
    index: '05',
    label: 'Tasks',
    description: 'Inbox duyệt việc, timeline và lịch sử xử lý',
  },
  {
    href: '/analytics',
    index: '06',
    label: 'Analytics',
    description: 'Metric, filter và dashboard tự cấu hình',
  },
  {
    href: '/apps',
    index: '07',
    label: 'Applications',
    description: 'Mini-app dựng từ business object',
  },
  {
    href: '/settings',
    index: '08',
    label: 'Cài đặt',
    description: 'Cấu hình tổ chức và môi trường demo',
  },
];

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
