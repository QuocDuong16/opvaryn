'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import {
  MAX_SERIALIZED_LENGTH,
  serializeWidgets,
  validateWidgetsStrict,
} from '@/components/analytics/dashboard-layout';
import type { SaveDashboardState } from '@/components/analytics/dashboard-state';
import { DASHBOARD_COOKIE, DASHBOARD_COOKIE_OPTIONS } from '@/lib/dashboard';

/**
 * Persists the dashboard layout in the browser cookie.
 *
 * The payload is untrusted input: it is parsed and validated by the same module
 * the cookie reader uses, and rejected rather than pruned — a saved layout must
 * equal what the user arranged. Validation is repeated here even though the form
 * only ever submits state the client already validated.
 */
export async function saveDashboardAction(
  _previous: SaveDashboardState,
  formData: FormData,
): Promise<SaveDashboardState> {
  const raw = String(formData.get('layout') ?? '');
  if (raw === '' || raw.length > MAX_SERIALIZED_LENGTH) {
    return { status: 'error', message: 'Bố cục gửi lên trống hoặc quá lớn để lưu.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'error', message: 'Bố cục không đọc được. Tải lại trang rồi thử lại.' };
  }

  const result = validateWidgetsStrict(parsed);
  if (!result.ok) {
    return { status: 'error', message: result.reason };
  }

  const store = await cookies();
  store.set(DASHBOARD_COOKIE, serializeWidgets(result.widgets), DASHBOARD_COOKIE_OPTIONS);
  revalidatePath('/analytics');

  return {
    status: 'saved',
    message: `Đã lưu ${result.widgets.length} widget vào cookie của trình duyệt này.`,
  };
}
