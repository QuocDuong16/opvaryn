'use server';

import { revalidatePath } from 'next/cache';

import type { BusinessObject, FieldDefinition } from '@opvaryn/contracts';

import type { CreateObjectState } from '@/components/objects/create-object-state';
import type { CreateRecordState } from '@/components/forms/object-form-state';
import type { UpdateObjectState } from '@/components/objects/update-object-state';
import type { StartInstanceState } from '@/components/process/start-instance-state';
import { recordValuesFromForm } from '@/components/forms/record-values';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { labelOrKey, roleLabels } from '@/lib/names';

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
      message: `Đã phát hành phiên bản v${updated.version} với ${updated.fields.length} trường. Bản ghi cũ vẫn đọc theo phiên bản của chúng.`,
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

/**
 * Starts a process instance for one stored record. The engine picks the definition
 * version current at this moment and walks to its first waiting task; this action
 * only assembles the request and says where the new work landed.
 */
export async function startProcessInstanceAction(
  _previous: StartInstanceState,
  formData: FormData,
): Promise<StartInstanceState> {
  const definitionKey = String(formData.get('definitionKey') ?? '').trim();
  const recordId = String(formData.get('recordId') ?? '').trim();

  if (definitionKey === '' || recordId === '') {
    return { status: 'error', message: 'Chọn một quy trình và một bản ghi để chạy.' };
  }

  const api = createServerApiClient();
  try {
    const view = await api.startProcessInstance({ definitionKey, recordId });
    revalidatePath(`/objects/${view.instance.objectKey}`);
    revalidatePath(`/workflows/${view.instance.definitionKey}`);
    revalidatePath('/workflows');
    revalidatePath('/tasks');

    // The confirmation names what the person just ran and who holds the work now, in
    // names (ADR 0016): the process by its name and the role by its label. Both reads
    // failing only costs a nicer sentence, so neither can fail the run.
    const [definition, catalogue] = await Promise.all([
      api.getProcessDefinition(definitionKey).catch(() => null),
      api.listRoles().catch(() => []),
    ]);
    const name = labelOrKey(definition?.name, definitionKey);
    const named = roleLabels(catalogue);
    const waiting = view.tasks.filter((task) => task.status === 'open');
    const roles = [...new Set(waiting.map((task) => task.assigneeRole))]
      .map((role) => labelOrKey(named.get(role), role))
      .join(', ');

    return {
      status: 'success',
      instanceId: view.instance.id,
      message:
        waiting.length === 0
          ? `Đã chạy “${name}” — quy trình kết thúc ngay vì không có bước chờ người.`
          : `Đã chạy “${name}” ở phiên bản v${view.instance.definitionVersion} — việc đầu tiên thuộc ${roles}.`,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}
