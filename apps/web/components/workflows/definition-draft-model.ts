import type { ProcessCondition, ProcessEdge, ProcessNode } from '@opvaryn/contracts';

import { NODE_HEIGHT, NODE_WIDTH, layoutGraph } from '@/components/workflows/definition-layout';

/**
 * The editable draft of a process graph (ADR 0013).
 *
 * A draft is what the user is arranging on the canvas: nodes with positions, edges with
 * an identity. It is deliberately **not** part of the engine: the runtime only ever reads
 * published versions, so a draft lives in one browser's cookie and reaches the API only
 * when the user publishes. Positions live in the draft alone — they are how the canvas
 * looks, not what the process means.
 *
 * Everything here is pure, so the whole editing model (move, add, connect, delete,
 * validate) is unit-tested without a browser.
 */

export interface DraftNode {
  key: string;
  type: ProcessNode['type'];
  title: string;
  assigneeRole?: string;
  condition?: ProcessCondition;
  x: number;
  y: number;
}

export interface DraftEdge {
  /** Stable within the draft, so React keys and selection survive edits. */
  id: string;
  from: string;
  to: string;
  when?: 'true' | 'false';
}

export interface WorkflowDraft {
  nodes: DraftNode[];
  edges: DraftEdge[];
}

export const DRAFT_MAX_NODES = 40;
export const DRAFT_MAX_EDGES = 80;
export const DRAFT_MAX_SERIALIZED = 8000;
/** How far one arrow-key press moves a node. */
export const DRAFT_NUDGE = 20;

const NODE_TYPES: readonly ProcessNode['type'][] = ['start', 'human_task', 'condition', 'end'];

function isNodeType(value: unknown): value is ProcessNode['type'] {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * draftFromGraph lays a published graph out and turns it into an editable draft: the
 * canvas starts from what the engine runs, so publishing without dragging anything is a
 * no-op instead of a rewrite.
 */
export function draftFromGraph(
  nodes: readonly ProcessNode[],
  edges: readonly ProcessEdge[],
): WorkflowDraft {
  const layout = layoutGraph({ nodes, edges });
  const positionByKey = new Map(layout.nodes.map((item) => [item.node.key, item]));

  return {
    nodes: nodes.map((node) => {
      const positioned = positionByKey.get(node.key);
      return {
        key: node.key,
        type: node.type,
        title: node.title,
        ...(node.assigneeRole ? { assigneeRole: node.assigneeRole } : {}),
        ...(node.condition ? { condition: { ...node.condition } } : {}),
        x: positioned?.x ?? 0,
        y: positioned?.y ?? 0,
      };
    }),
    edges: edges.map((edge, index) => ({
      id: `e${index + 1}`,
      from: edge.from,
      to: edge.to,
      ...(edge.when ? { when: edge.when } : {}),
    })),
  };
}

/**
 * validateDraft reads untrusted input (a cookie). Reading is lenient in the same spirit as
 * the dashboard layout: entries that cannot be used are dropped, and a draft that makes no
 * sense at all is refused so the caller can fall back to the published graph.
 */
export function validateDraft(
  value: unknown,
): { ok: true; draft: WorkflowDraft } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'Bản nháp không đúng định dạng.' };
  }

  const candidate = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return { ok: false, reason: 'Bản nháp phải có danh sách bước và đường nối.' };
  }
  if (candidate.nodes.length > DRAFT_MAX_NODES || candidate.edges.length > DRAFT_MAX_EDGES) {
    return { ok: false, reason: 'Bản nháp vượt quá số bước hoặc đường nối cho phép.' };
  }

  const nodes: DraftNode[] = [];
  const seenKeys = new Set<string>();
  for (const entry of candidate.nodes) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const key = asText(raw.key);
    if (key === '' || key.length > 64 || seenKeys.has(key) || !isNodeType(raw.type)) {
      continue;
    }
    seenKeys.add(key);
    const title = asText(raw.title);
    const role = asText(raw.assigneeRole);
    nodes.push({
      key,
      type: raw.type,
      title: title === '' ? key : title,
      ...(role === '' ? {} : { assigneeRole: role }),
      ...(isCondition(raw.condition) ? { condition: raw.condition } : {}),
      x: asNumber(raw.x, 0),
      y: asNumber(raw.y, 0),
    });
  }
  if (nodes.length === 0) {
    return { ok: false, reason: 'Bản nháp không có bước nào dùng được.' };
  }

  const edges: DraftEdge[] = [];
  const seenEdges = new Set<string>();
  for (const entry of candidate.edges) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const from = asText(raw.from);
    const to = asText(raw.to);
    if (!seenKeys.has(from) || !seenKeys.has(to) || from === to) {
      continue;
    }
    const when = raw.when === 'true' || raw.when === 'false' ? raw.when : undefined;
    const signature = `${from}->${to}:${when ?? ''}`;
    if (seenEdges.has(signature)) {
      continue;
    }
    seenEdges.add(signature);
    edges.push({
      id: asText(raw.id) || `e${edges.length + 1}`,
      from,
      to,
      ...(when ? { when } : {}),
    });
  }

  return { ok: true, draft: { nodes, edges } };
}

function isCondition(value: unknown): value is ProcessCondition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return typeof raw.field === 'string' && typeof raw.op === 'string';
}

/** serializeDraft is the compact form stored in the cookie. */
export function serializeDraft(draft: WorkflowDraft): string {
  return JSON.stringify({
    nodes: draft.nodes.map((node) => ({
      key: node.key,
      type: node.type,
      title: node.title,
      ...(node.assigneeRole ? { assigneeRole: node.assigneeRole } : {}),
      ...(node.condition ? { condition: node.condition } : {}),
      x: Math.round(node.x),
      y: Math.round(node.y),
    })),
    edges: draft.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.when ? { when: edge.when } : {}),
    })),
  });
}

/** parseDraft reads the cookie's value; null means "no usable draft". */
export function parseDraft(raw: string | undefined | null): WorkflowDraft | null {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > DRAFT_MAX_SERIALIZED) {
    return null;
  }
  try {
    const result = validateDraft(JSON.parse(raw) as unknown);
    return result.ok ? result.draft : null;
  } catch {
    return null;
  }
}

/** moveNode puts a node at a new position, clamped to the canvas. */
export function moveNode(draft: WorkflowDraft, key: string, x: number, y: number): WorkflowDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.key === key
        ? { ...node, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }
        : node,
    ),
  };
}

/** nudgeNode moves the selected node by one step, which is how a keyboard moves it. */
export function nudgeNode(
  draft: WorkflowDraft,
  key: string,
  dx: number,
  dy: number,
): WorkflowDraft {
  const node = draft.nodes.find((candidate) => candidate.key === key);
  if (!node) {
    return draft;
  }
  return moveNode(draft, key, node.x + dx, node.y + dy);
}

/** nextNodeKey keeps keys readable: task_2, task_3, … */
function nextNodeKey(draft: WorkflowDraft, type: ProcessNode['type']): string {
  const base = type === 'human_task' ? 'task' : type;
  let index = 1;
  while (draft.nodes.some((node) => node.key === `${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

/**
 * addNode puts a new node on the canvas. It arrives unnamed and unconnected on purpose:
 * a graph the engine would reject must be visible as a draft problem, not silently
 * repaired here — publishing is what validates.
 */
export function addNode(
  draft: WorkflowDraft,
  type: ProcessNode['type'],
  x: number,
  y: number,
): { draft: WorkflowDraft; key: string; added: boolean } {
  if (draft.nodes.length >= DRAFT_MAX_NODES) {
    return { draft, key: '', added: false };
  }
  const key = nextNodeKey(draft, type);
  const node: DraftNode = {
    key,
    type,
    title:
      type === 'start'
        ? 'Bắt đầu'
        : type === 'end'
          ? 'Kết thúc'
          : type === 'condition'
            ? 'Điều kiện'
            : 'Việc của người',
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
  };
  return { draft: { ...draft, nodes: [...draft.nodes, node] }, key, added: true };
}

/** updateNode patches the fields a node can carry, keeping the graph well-formed. */
export function updateNode(
  draft: WorkflowDraft,
  key: string,
  patch: Partial<Pick<DraftNode, 'title' | 'assigneeRole' | 'condition'>>,
): WorkflowDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) => (node.key === key ? { ...node, ...patch } : node)),
  };
}

/** removeNode deletes a node and every edge that touched it. */
export function removeNode(draft: WorkflowDraft, key: string): WorkflowDraft {
  return {
    nodes: draft.nodes.filter((node) => node.key !== key),
    edges: draft.edges.filter((edge) => edge.from !== key && edge.to !== key),
  };
}

/** removeEdge deletes one connection. */
export function removeEdge(draft: WorkflowDraft, id: string): WorkflowDraft {
  return { ...draft, edges: draft.edges.filter((edge) => edge.id !== id) };
}

/**
 * connectNodes draws one connection. The only things refused here are the ones that are
 * meaningless on any canvas — a loop onto itself and an exact duplicate; whether the graph
 * as a whole is valid (one start, reachable, branches) is the service's job at publish
 * time, and its message is what the user sees.
 */
export function connectNodes(
  draft: WorkflowDraft,
  from: string,
  to: string,
  when?: 'true' | 'false',
): { draft: WorkflowDraft; error: string | null } {
  if (from === to) {
    return { draft, error: 'Không nối một bước với chính nó.' };
  }
  const exists = draft.edges.some(
    (edge) => edge.from === from && edge.to === to && (edge.when ?? '') === (when ?? ''),
  );
  if (exists) {
    return { draft, error: 'Đường chuyển này đã có.' };
  }
  if (draft.edges.length >= DRAFT_MAX_EDGES) {
    return { draft, error: 'Bản nháp đã đủ số đường nối.' };
  }
  return {
    draft: {
      ...draft,
      edges: [
        ...draft.edges,
        { id: `e${draft.edges.length + 1}-${from}-${to}`, from, to, ...(when ? { when } : {}) },
      ],
    },
    error: null,
  };
}

/** draftGraph is the graph to publish: positions are the canvas's business, not the engine's. */
export function draftGraph(draft: WorkflowDraft): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  return {
    nodes: draft.nodes.map((node) => ({
      key: node.key,
      type: node.type,
      title: node.title,
      ...(node.assigneeRole ? { assigneeRole: node.assigneeRole } : {}),
      ...(node.condition ? { condition: node.condition } : {}),
    })),
    edges: draft.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.when ? { when: edge.when } : {}),
    })),
  };
}

/** draftSignature is the comparable form of a graph, positions excluded. */
export function draftSignature(draft: WorkflowDraft): string {
  const graph = draftGraph(draft);
  return JSON.stringify({
    nodes: graph.nodes,
    edges: [...graph.edges].sort((a, b) =>
      `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`),
    ),
  });
}

/** isDraftChanged reports whether publishing would change anything. */
export function isDraftChanged(draft: WorkflowDraft, published: WorkflowDraft): boolean {
  return draftSignature(draft) !== draftSignature(published);
}

/** canvasSize is the drawing area: the furthest node plus room to drop another one. */
export function canvasSize(draft: WorkflowDraft): { width: number; height: number } {
  let width = 640;
  let height = 320;
  for (const node of draft.nodes) {
    width = Math.max(width, node.x + NODE_WIDTH + 200);
    height = Math.max(height, node.y + NODE_HEIGHT + 160);
  }
  return { width, height };
}
