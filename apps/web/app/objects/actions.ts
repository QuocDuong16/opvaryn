'use server';

import { revalidatePath } from 'next/cache';

import type { BusinessObject, FieldDefinition } from '@opvaryn/contracts';

import type { CreateObjectState } from '@/components/objects/create-object-state';
import type { CreateRecordState } from '@/components/forms/object-form-state';
import type { UpdateObjectState } from '@/components/objects/update-object-state';
import { recordValuesFromForm } from '@/components/forms/record-values';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

/**
 * Creates a business object through the API. Validation lives in the Go service;
 * this action only assembles the request (trimming, parsing the field schema JSON
 * the editor submits) and maps the API error envelope to a message.
 */
export async function createBusinessObjectAction(
  _previous: CreateObjectState,
  formData: FormData,
): Promise<CreateObjectState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  const fields = parseFields(String(formData.get('fields') ?? ''));
  if (fields === null) {
    return {
      status: 'error',
      message: 'Không đọc được danh sách field. Tải lại trang rồi nhập lại schema.',
    };
  }

  try {
    const created = await createServerApiClient().createBusinessObject({
      key,
      name,
      description: description === '' ? undefined : description,
      ...(fields.length > 0 ? { fields } : {}),
    });
    revalidatePath('/objects');
    return {
      status: 'success',
      message: `Đã tạo "${created.name}" — key ${created.key} với ${created.fields.length} field.`,
      createdKey: created.key,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}

/** parseFields returns the submitted schema, or null when the payload is broken. */
function parseFields(raw: string): FieldDefinition[] | null {
  if (raw.trim() === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldDefinition[]) : null;
  } catch {
    return null;
  }
}

/**
 * Publishes the next version of a business object definition. The action only
 * assembles the request; the Go service validates the definition and writes the
 * immutable snapshot, so the editor and the create form enforce the same rules.
 */
export async function updateBusinessObjectAction(
  _previous: UpdateObjectState,
  formData: FormData,
): Promise<UpdateObjectState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  const fields = parseFields(String(formData.get('fields') ?? ''));
  if (fields === null) {
    return {
      status: 'error',
      message: 'Không đọc được danh sách field. Tải lại trang rồi nhập lại schema.',
    };
  }

  try {
    const updated = await createServerApiClient().updateBusinessObject(key, {
      name,
      description: description === '' ? undefined : description,
      fields,
    });
    revalidatePath(`/objects/${key}`);
    revalidatePath('/objects');
    revalidatePath('/forms');
    revalidatePath('/apps');
    return {
      status: 'success',
      message: `Đã publish phiên bản v${updated.version} với ${updated.fields.length} field. Bản ghi cũ vẫn đọc theo phiên bản của chúng.`,
      publishedVersion: updated.version,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}

/**
 * Creates one record of a business object. The action reads the object definition
 * first, so the submitted form fields are converted by their declared type; the Go
 * service validates everything again before the record is stored.
 */
export async function createObjectRecordAction(
  _previous: CreateRecordState,
  formData: FormData,
): Promise<CreateRecordState> {
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const api = createServerApiClient();

  let object: BusinessObject;
  try {
    object = await api.getBusinessObject(objectKey);
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }

  const values = recordValuesFromForm(object, formData);

  try {
    const created = await api.createObjectRecord(objectKey, { values });
    revalidatePath(`/objects/${objectKey}`);
    revalidatePath('/objects');
    revalidatePath('/forms');
    revalidatePath('/apps');
    return {
      status: 'success',
      message: `Đã lưu bản ghi ${created.id.slice(0, 8)}… vào ${object.name}.`,
      recordId: created.id,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}
