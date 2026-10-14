import { cookies } from 'next/headers';

import {
  defaultWidgets,
  parseWidgets,
  type DashboardWidget,
} from '@/components/analytics/dashboard-layout';

/**
 * The dashboard layout is user configuration: which widgets, in which order, over which
 * metrics. It lives in a browser-scoped httpOnly cookie rather than a table (ADR 0004):
 * the layout is small, belongs to one person and needs no query. The widgets reference
 * metric keys, and the allowed keys are passed in by the caller — metrics are server
 * data, so this module must not import a fixture list.
 */
export const DASHBOARD_COOKIE = 'opvaryn.dashboard';

export const DASHBOARD_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 180,
} as const;

/**
 * Reads the saved layout. A missing, oversized or corrupted cookie yields the default
 * layout instead of an error, so the dashboard always renders; widgets pointing at a
 * metric that no longer exists are pruned by the reader.
 */
export async function getDashboardWidgets(allowed: readonly string[]): Promise<DashboardWidget[]> {
  const store = await cookies();
  const raw = store.get(DASHBOARD_COOKIE)?.value;
  return raw === undefined ? defaultWidgets(allowed) : parseWidgets(raw, allowed);
}
