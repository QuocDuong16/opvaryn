'use server';

import { revalidatePath } from 'next/cache';

import type { CreateObjectState } from '@/components/objects/create-object-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

/**
 * Creates a business object through the API. Validation lives in the Go service;
 * this action only trims input and maps the API error envelope to a message.
 */
export async function createBusinessObjectAction(
  _previous: CreateObjectState,
  formData: FormData,
): Promise<CreateObjectState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  try {
    const created = await createServerApiClient().createBusinessObject({
      key,
      name,
      description: description === '' ? undefined : description,
    });
    revalidatePath('/objects');
    return { status: 'success', message: `Đã tạo "${created.name}" — key ${created.key}.` };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}
