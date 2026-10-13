import { cookies } from 'next/headers';

import {
  defaultWidgets,
  parseWidgets,
  type DashboardWidget,
} from '@/components/analytics/dashboard-layout';

/**
 * The dashboard layout is user configuration: which widgets, in which order, with
 * which metric. The demo has no identity layer yet (playbook D09), so it lives in
 * a browser-scoped httpOnly cookie instead of a database table — no process,
 * task or event table is invented for it (docs/adr/0004). The MVP moves layouts to
 * per-user storage once identity exists.
 */
export const DASHBOARD_COOKIE = 'opvaryn.dashboard';

export const DASHBOARD_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 180,
} as const;

/**
 * Reads the saved layout. A missing, oversized or corrupted cookie yields the
 * default layout instead of an error, so the dashboard always renders.
 */
export async function getDashboardWidgets(): Promise<DashboardWidget[]> {
  const store = await cookies();
  const raw = store.get(DASHBOARD_COOKIE)?.value;
  return raw === undefined ? defaultWidgets() : parseWidgets(raw);
}
