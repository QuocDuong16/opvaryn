'use server';

import { revalidatePath } from 'next/cache';

import type { ProcessDefinition } from '@opvaryn/contracts';

import type { CreateDefinitionState } from '@/components/workflows/create-definition-state';
import type { PublishDefinitionState } from '@/components/workflows/publish-definition-state';
import { parseGraph } from '@/components/workflows/definition-draft';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

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
  return {
    status: 'success',
    message: `Đã publish phiên bản v${updated.version} với ${updated.nodes.length} node. Instance đang chạy vẫn giữ phiên bản cũ.`,
    publishedVersion: updated.version,
  };
}
