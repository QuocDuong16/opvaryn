'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import type { ProcessDefinition } from '@opvaryn/contracts';

import type { CreateDefinitionState } from '@/components/workflows/create-definition-state';
import type { PublishDefinitionState } from '@/components/workflows/publish-definition-state';
import type { SaveDraftState } from '@/components/workflows/save-draft-state';
import { parseGraph } from '@/components/workflows/definition-draft';
import {
  DRAFT_MAX_SERIALIZED,
  serializeDraft,
  validateDraft,
} from '@/components/workflows/definition-draft-model';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { DRAFT_COOKIE_OPTIONS, draftCookieName } from '@/lib/workflow-draft';

/**
 * Saves the canvas draft in this browser's cookie (ADR 0013). The payload is untrusted
 * input: it is validated by the same pure module the reader uses, and a draft that cannot
 * be read back is refused instead of stored.
 *
 * `draft=discard` is the "go back to what the engine runs" button: it deletes the cookie.
 */
export async function saveWorkflowDraftAction(
  _previous: SaveDraftState,
  formData: FormData,
): Promise<SaveDraftState> {
  const key = String(formData.get('key') ?? '').trim();
  const raw = String(formData.get('draft') ?? '');
  if (key === '') {
    return { status: 'error', message: 'Thiếu key của quy trình.' };
  }

  const store = await cookies();
  if (raw === 'discard') {
    store.delete(draftCookieName(key));
    revalidatePath(`/workflows/${key}`);
    return { status: 'saved', message: 'Đã bỏ bản nháp — canvas quay về bản đã publish.' };
  }

  if (raw === '' || raw.length > DRAFT_MAX_SERIALIZED) {
    return { status: 'error', message: 'Bản nháp trống hoặc quá lớn để lưu.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'error', message: 'Bản nháp không đọc được. Tải lại trang rồi thử lại.' };
  }

  const result = validateDraft(parsed);
  if (!result.ok) {
    return { status: 'error', message: result.reason };
  }

  store.set(draftCookieName(key), serializeDraft(result.draft), DRAFT_COOKIE_OPTIONS);
  revalidatePath(`/workflows/${key}`);
  return {
    status: 'saved',
    message: `Đã lưu bản nháp (${result.draft.nodes.length} node, ${result.draft.edges.length} đường chuyển) cho trình duyệt này.`,
  };
}

/**
 * Publishes version 1 of a new process definition. The graph arrives as one JSON
 * hidden input assembled by the editor; every rule about that graph (single start,
 * reachability, branch shapes, condition literals against the object's fields) is
 * enforced by the Go service, and its message is what the editor shows.
 */
export async function createProcessDefinitionAction(
  _previous: CreateDefinitionState,
  formData: FormData,
): Promise<CreateDefinitionState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const objectKey = String(formData.get('objectKey') ?? '').trim();

  const graph = parseGraph(String(formData.get('graph') ?? ''));
  if (graph === null) {
    return {
      status: 'error',
      message: 'Không đọc được graph. Tải lại trang rồi nhập lại node và đường chuyển.',
    };
  }

  try {
    const created = await createServerApiClient().createProcessDefinition({
      key,
      name,
      objectKey,
      ...(description === '' ? {} : { description }),
      nodes: graph.nodes,
      edges: graph.edges,
    });
    revalidatePath('/workflows');
    revalidatePath(`/objects/${created.objectKey}`);
    return {
      status: 'success',
      message: `Đã publish "${created.name}" (${created.key}) v1 với ${created.nodes.length} node.`,
      createdKey: created.key,
    };
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }
}

/**
 * Publishes the next version of an existing definition. Instances keep the version
 * they started with (ADR 0006), so this never rewrites a running process.
 */
export async function publishProcessDefinitionAction(
  _previous: PublishDefinitionState,
  formData: FormData,
): Promise<PublishDefinitionState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const objectKey = String(formData.get('objectKey') ?? '').trim();

  const graph = parseGraph(String(formData.get('graph') ?? ''));
  if (graph === null) {
    return {
      status: 'error',
      message: 'Không đọc được graph. Tải lại trang rồi nhập lại node và đường chuyển.',
    };
  }

  let updated: ProcessDefinition;
  try {
    updated = await createServerApiClient().updateProcessDefinition(key, {
      name,
      objectKey,
      ...(description === '' ? {} : { description }),
      nodes: graph.nodes,
      edges: graph.edges,
    });
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }

  revalidatePath(`/workflows/${key}`);
  revalidatePath('/workflows');
  revalidatePath(`/objects/${updated.objectKey}`);

  // The draft is now the published graph: keeping it would only make the canvas claim
  // there are unpublished changes.
  const store = await cookies();
  store.delete(draftCookieName(key));

  return {
    status: 'success',
    message: `Đã publish phiên bản v${updated.version} với ${updated.nodes.length} node. Instance đang chạy vẫn giữ phiên bản cũ.`,
    publishedVersion: updated.version,
  };
}
