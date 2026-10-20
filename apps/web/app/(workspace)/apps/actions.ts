'use server';

import { revalidatePath } from 'next/cache';

import type { AppConfigState } from '@/components/apps/app-config-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

/**
 * Saves the configuration of the application view (ADR 0033). The API decides who may
 * change it; the screen only assembles the request and reports what came back.
 */
export async function saveAppConfigAction(
  _previous: AppConfigState,
  formData: FormData,
): Promise<AppConfigState> {
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kanbanField = String(formData.get('kanbanField') ?? '').trim();
  const listColumns = formData
    .getAll('listColumns')
    .map((value) => String(value).trim())
    .filter((value) => value !== '');

  try {
    await createServerApiClient().saveAppConfig(objectKey, {
      name,
      kanbanField,
      listColumns,
    });
    revalidatePath('/apps');
    revalidatePath(`/objects/${objectKey}`);
    return { status: 'success', message: 'Đã lưu cấu hình ứng dụng.' };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}
