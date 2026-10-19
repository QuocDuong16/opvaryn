'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import {
  MAX_SERIALIZED_LENGTH,
  serializeWidgets,
  validateWidgetsStrict,
} from '@/components/analytics/dashboard-layout';
import type { SaveDashboardState } from '@/components/analytics/dashboard-state';
import type { CreateMetricState } from '@/components/analytics/create-metric-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { DASHBOARD_COOKIE, DASHBOARD_COOKIE_OPTIONS } from '@/lib/dashboard';

/**
 * Persists the dashboard layout in the browser cookie.
 *
 * The payload is untrusted input: it is parsed and validated by the same module the
 * cookie reader uses, and rejected rather than pruned — a saved layout must equal what
 * the user arranged. The metrics that exist are read from the API first, because a
 * layout may only reference a metric that is really there.
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

  let allowed: string[] = [];
  try {
    allowed = (await createServerApiClient().listMetrics()).map((metric) => metric.key);
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }

  const result = validateWidgetsStrict(parsed, allowed);
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

/**
 * Creates one metric through the API. Every rule about a metric — which aggregations
 * exist, whether the field suits it, whether the filter is legal — lives in the Go
 * service, and its message is what the form shows. This action only assembles the
 * request.
 */
export async function createMetricAction(
  _previous: CreateMetricState,
  formData: FormData,
): Promise<CreateMetricState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const aggregation = String(formData.get('aggregation') ?? '').trim();
  const field = String(formData.get('field') ?? '').trim();
  const groupBy = String(formData.get('groupBy') ?? '').trim();
  const filterField = String(formData.get('filterField') ?? '').trim();
  const filterOp = String(formData.get('filterOp') ?? '').trim();
  const filterValue = String(formData.get('filterValue') ?? '').trim();

  // A numeric filter has to reach the API as a number, so it is typed here by the shape
  // of what was typed; anything else stays text and the service decides. `Number` is the
  // check: it accepts the same shapes the API's number literal does and rejects the rest.
  const numericFilter = filterValue !== '' && Number.isFinite(Number(filterValue));

  try {
    const created = await createServerApiClient().createMetric({
      key,
      name,
      objectKey,
      aggregation: aggregation as 'count' | 'sum' | 'avg',
      ...(description === '' ? {} : { description }),
      ...(field === '' ? {} : { field }),
      ...(groupBy === '' ? {} : { groupBy }),
      ...(filterField === '' || filterOp === ''
        ? {}
        : {
            filter: {
              field: filterField,
              op: filterOp as 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte',
              value: numericFilter ? Number(filterValue) : filterValue,
            },
          }),
    });
    revalidatePath('/analytics');
    return {
      status: 'success',
      message: `Đã tạo chỉ số "${created.name}" (${created.key}). Nó xuất hiện trong bảng số liệu ngay.`,
      createdKey: created.key,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}
