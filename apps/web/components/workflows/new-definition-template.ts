import type { ProcessEdge, ProcessNode } from '@opvaryn/contracts';

import { draftFromGraph, type WorkflowDraft } from '@/components/workflows/definition-draft-model';

/**
 * What a new process starts as (ADR 0019): three steps the engine accepts, laid out on the
 * canvas, so the designer begins from something that already runs instead of from an empty
 * grid. Everything about it is ordinary — the first published version is whatever the
 * designer leaves on the canvas, and the template is never published on its own.
 *
 * The role of the first step is deliberately absent: the create form asks for it, because a
 * step that hands work to nobody is a process that stops where it stands.
 */
const TEMPLATE_NODES: readonly ProcessNode[] = [
  { key: 'start', type: 'start', title: 'Nhận yêu cầu' },
  { key: 'approve', type: 'human_task', title: 'Duyệt yêu cầu' },
  { key: 'end', type: 'end', title: 'Kết thúc' },
];

const TEMPLATE_EDGES: readonly ProcessEdge[] = [
  { from: 'start', to: 'approve' },
  { from: 'approve', to: 'end' },
];

/** templateDraft is the starting canvas: nhận yêu cầu → duyệt → kết thúc. */
export function templateDraft(): WorkflowDraft {
  return draftFromGraph(TEMPLATE_NODES, TEMPLATE_EDGES);
}

/**
 * firstTaskKey is the step the create form's "ai nhận việc?" question is about: the first
 * step that hands work to a person. It returns null once the designer has removed them all,
 * which the checklist reports in its own words.
 */
export function firstTaskKey(draft: WorkflowDraft): string | null {
  return draft.nodes.find((node) => node.type === 'human_task')?.key ?? null;
}
