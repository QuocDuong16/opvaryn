'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { BusinessObject, FieldDefinition } from '@opvaryn/contracts';

import type { CreateObjectState } from '@/components/objects/create-object-state';
import type { CreateRecordState } from '@/components/forms/object-form-state';
import type { DeleteRecordState } from '@/components/forms/record-delete-state';
import type { UpdateObjectState } from '@/components/objects/update-object-state';
import type { StartInstanceState } from '@/components/process/start-instance-state';
import { recordValuesFromForm } from '@/components/forms/record-values';
import { createServerApiClient, describeApiError, fetchApiWithSession } from '@/lib/api/server';
import { MAX_ATTACHMENT_BYTES, type UploadedAttachment } from '@/lib/attachments';
import { MAX_IMPORT_BYTES, type RecordImportResult } from '@/lib/import';
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
      message: 'Không đọc được danh sách trường. Tải lại trang rồi nhập lại định nghĩa.',
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
      message: `Đã tạo "${created.name}" — mã ${created.key} với ${created.fields.length} trường.`,
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
      message: 'Không đọc được danh sách trường. Tải lại trang rồi nhập lại định nghĩa.',
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
      message: `Đã lưu bản ghi vào ${object.name}.`,
      recordId: created.id,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}

/** The state the file-upload action answers the file control with. */
export interface UploadAttachmentState {
  status: 'success' | 'error';
  message?: string;
  attachment?: UploadedAttachment;
}

/**
 * Uploads one file for a record field. The browser sends the bytes to this action, which
 * forwards them to the API as multipart; the returned identifier is what the record form
 * submits, and the API binds it while saving the record (ADR 0025).
 */
export async function uploadAttachmentAction(formData: FormData): Promise<UploadAttachmentState> {
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Chọn một tệp để tải lên.' };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { status: 'error', message: 'Tệp tối đa 10 MB.' };
  }

  const body = new FormData();
  body.set('file', file);

  let response: Response;
  try {
    response = await fetchApiWithSession(
      `/api/v1/attachments?objectKey=${encodeURIComponent(objectKey)}`,
      { method: 'POST', body },
    );
  } catch {
    return { status: 'error', message: 'Không tải được tệp. Thử lại sau ít phút.' };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { status: 'error', message: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.' };
    }
    // The API explains why it refused (a missing definition, a file that is too big); the
    // screen repeats that reason instead of guessing.
    const payload = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined;
    return {
      status: 'error',
      message:
        payload?.message ?? 'Không tải được tệp. Kiểm tra dung lượng (tối đa 10 MB) rồi thử lại.',
    };
  }

  const attachment = (await response.json()) as { id: string; fileName: string };
  return { status: 'success', attachment: { id: attachment.id, fileName: attachment.fileName } };
}

/**
 * Removes an upload that was never saved into a record — someone picked a file and then
 * changed their mind. Best effort: a file that cannot be reached now is pruned later.
 */
export async function deleteAttachmentAction(attachmentId: string): Promise<void> {
  if (attachmentId === '') {
    return;
  }
  try {
    await fetchApiWithSession(`/api/v1/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  } catch {
    // An abandoned upload is pruned by the operator; losing it here costs nothing else.
  }
}

/** The state the CSV import form answers with. */
export interface ImportRecordsState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  result?: RecordImportResult;
}

/**
 * Imports records from a CSV file. `mode=check` asks the API for a dry run, so the person
 * sees every bad row before anything is written; `mode=import` stores all rows or none.
 * The API does the parsing and validation (ADR 0026).
 */
export async function importObjectRecordsAction(
  _previous: ImportRecordsState,
  formData: FormData,
): Promise<ImportRecordsState> {
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const dryRun = String(formData.get('mode') ?? 'check') !== 'import';
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Chọn file CSV cần nhập.' };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { status: 'error', message: 'File tối đa 5 MB.' };
  }

  const body = new FormData();
  body.set('file', file);

  let response: Response;
  try {
    response = await fetchApiWithSession(
      `/api/v1/business-objects/${encodeURIComponent(objectKey)}/records/import?dryRun=${dryRun}`,
      { method: 'POST', body },
    );
  } catch {
    return { status: 'error', message: 'Không gửi được file. Thử lại sau ít phút.' };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { status: 'error', message: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.' };
    }
    const payload = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined;
    return {
      status: 'error',
      message: payload?.message
        ? `File chưa hợp lệ: ${payload.message}`
        : 'Không đọc được file CSV. Kiểm tra lại các cột rồi thử lại.',
    };
  }

  const result = (await response.json()) as RecordImportResult;
  if (result.errors.length > 0) {
    return {
      status: 'error',
      message: dryRun
        ? `Đã kiểm tra ${result.rows} dòng: ${result.valid} hợp lệ, ${result.errors.length} lỗi. Chưa ghi gì.`
        : `Không nhập được dòng nào — ${result.errors.length} lỗi cần sửa.`,
      result,
    };
  }

  if (!dryRun && result.created > 0) {
    revalidatePath(`/objects/${objectKey}`);
    revalidatePath('/objects');
    revalidatePath('/forms');
    revalidatePath('/apps');
  }
  return {
    status: 'success',
    message: dryRun
      ? `Đã kiểm tra ${result.rows} dòng — tất cả hợp lệ và sẵn sàng nhập.`
      : `Đã nhập ${result.created} bản ghi.`,
    result,
  };
}

/**
 * Replaces the values of one stored record. The form was rendered from the version the
 * record was created under, so the submitted fields are converted with that version's
 * definitions; the Go service validates them again before anything is written.
 */
export async function updateObjectRecordAction(
  _previous: CreateRecordState,
  formData: FormData,
): Promise<CreateRecordState> {
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const recordId = String(formData.get('recordId') ?? '').trim();
  const api = createServerApiClient();

  let record;
  try {
    record = await api.getObjectRecord(objectKey, recordId);
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }

  // The record is read and edited with its own published version, never the newest
  // definition (ADR 0006 invariant 1).
  let version;
  try {
    const versions = await api.listBusinessObjectVersions(objectKey);
    version = versions.find((candidate) => candidate.version === record.objectVersion);
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
  if (!version) {
    return {
      status: 'error',
      message: 'Không tìm thấy phiên bản định nghĩa mà bản ghi này được tạo theo.',
    };
  }

  const definition: BusinessObject = {
    id: record.id,
    key: objectKey,
    name: version.name,
    fields: version.fields,
    version: version.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  const values = recordValuesFromForm(definition, formData);

  try {
    await api.updateObjectRecord(objectKey, recordId, { values });
    revalidatePath(`/objects/${objectKey}`);
    revalidatePath('/objects');
    revalidatePath('/forms');
    revalidatePath('/apps');
    return { status: 'success', message: 'Đã lưu thay đổi cho bản ghi.' };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}

/**
 * Deletes one record that no process has run on. The API refuses a record with a run
 * (its decisions are history); this action maps that answer to a sentence.
 */
export async function deleteObjectRecordAction(
  _previous: DeleteRecordState,
  formData: FormData,
): Promise<DeleteRecordState> {
  const objectKey = String(formData.get('objectKey') ?? '').trim();
  const recordId = String(formData.get('recordId') ?? '').trim();

  try {
    await createServerApiClient().deleteObjectRecord(objectKey, recordId);
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }

  revalidatePath(`/objects/${objectKey}`);
  revalidatePath('/objects');
  revalidatePath('/forms');
  revalidatePath('/apps');
  // The record's own address no longer resolves, so the person lands on the list that is
  // still there — with the confirmation that the delete happened.
  redirect(`/objects/${objectKey}?tab=records&deleted=1`);
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
