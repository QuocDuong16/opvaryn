import type {
  FieldDefinition,
  ProcessCondition,
  ProcessEdge,
  ProcessNode,
} from '@opvaryn/contracts';

/**
 * The definition editor's row model. It is a form-shaped view of a process graph:
 * one row per node and per edge, serialized into a single JSON hidden input, and
 * converted back with the types the API expects. Only shape conversion happens
 * here — the graph rules (one start, reachable, branch shapes, condition types)
 * live in the Go service and their messages come back from there.
 */
export interface NodeDraft {
  key: string;
  type: ProcessNode['type'];
  title: string;
  assigneeRole: string;
  conditionField: string;
  /** The operator the engine supports (D04). */
  conditionOp: ProcessCondition['op'];
  conditionValue: string;
}

export interface EdgeDraft {
  from: string;
  to: string;
  when: '' | 'true' | 'false';
}

export const NODE_TYPE_OPTIONS: readonly { value: ProcessNode['type']; label: string }[] = [
  { value: 'start', label: 'Bắt đầu' },
  { value: 'human_task', label: 'Việc của người' },
  { value: 'condition', label: 'Điều kiện' },
  { value: 'end', label: 'Kết thúc' },
];

/** Condition operators the engine supports (D04). */
export const CONDITION_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;

export function blankNodeDraft(): NodeDraft {
  return {
    key: '',
    type: 'human_task',
    title: '',
    assigneeRole: '',
    conditionField: '',
    conditionOp: 'eq',
    conditionValue: '',
  };
}

export function blankEdgeDraft(): EdgeDraft {
  return { from: '', to: '', when: '' };
}

/** nodesToDrafts turns a published graph into editable rows. */
export function nodesToDrafts(nodes: readonly ProcessNode[]): NodeDraft[] {
  return nodes.map((node) => ({
    key: node.key,
    type: node.type,
    title: node.title,
    assigneeRole: node.assigneeRole ?? '',
    conditionField: node.condition?.field ?? '',
    conditionOp: node.condition?.op ?? 'eq',
    conditionValue: node.condition === undefined ? '' : String(node.condition.value ?? ''),
  }));
}

/** edgesToDrafts turns the edges into editable rows. */
export function edgesToDrafts(edges: readonly ProcessEdge[]): EdgeDraft[] {
  return edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    when: edge.when === 'true' ? 'true' : edge.when === 'false' ? 'false' : '',
  }));
}

/**
 * nodesFromDrafts builds the API's node list. A condition node carries a condition
 * only when a field is named; a human task carries a role only when one is set, so
 * the API's own validation produces the message instead of the editor inventing one.
 */
export function nodesFromDrafts(
  drafts: readonly NodeDraft[],
  fields: readonly FieldDefinition[],
): ProcessNode[] {
  return drafts
    .filter((draft) => draft.key.trim() !== '' || draft.title.trim() !== '')
    .map((draft) => {
      const key = draft.key.trim();
      const node: ProcessNode = {
        key,
        type: draft.type,
        title: draft.title.trim(),
      };
      if (draft.type === 'human_task' && draft.assigneeRole.trim() !== '') {
        node.assigneeRole = draft.assigneeRole.trim();
      }
      if (draft.type === 'condition' && draft.conditionField.trim() !== '') {
        node.condition = conditionFromDraft(draft, fields);
      }
      return node;
    });
}

/** edgesFromDrafts builds the API's edge list, dropping rows without both ends. */
export function edgesFromDrafts(drafts: readonly EdgeDraft[]): ProcessEdge[] {
  return drafts
    .filter((draft) => draft.from.trim() !== '' && draft.to.trim() !== '')
    .map((draft) => {
      const edge: ProcessEdge = { from: draft.from.trim(), to: draft.to.trim() };
      if (draft.when !== '') {
        edge.when = draft.when;
      }
      return edge;
    });
}

/**
 * conditionFromDraft types the literal by the field it is compared against: a number
 * field takes a number so `estimated_amount gte 20000000` compares as a number, a
 * select takes the option value as text. An unparsable number stays text on purpose:
 * the API then answers "must be a number for field x" instead of the editor silently
 * sending NaN or 0.
 */
export function conditionFromDraft(
  draft: NodeDraft,
  fields: readonly FieldDefinition[],
): ProcessCondition {
  const field = fields.find((candidate) => candidate.key === draft.conditionField.trim());
  const raw = draft.conditionValue.trim();
  let value: unknown = raw;
  if (field?.type === 'number') {
    const parsed = Number(raw);
    value = raw !== '' && Number.isFinite(parsed) ? parsed : raw;
  }
  return { field: draft.conditionField.trim(), op: draft.conditionOp, value };
}

/** serializeGraph is the hidden input the editor submits. */
export function serializeGraph(
  drafts: { nodes: readonly NodeDraft[]; edges: readonly EdgeDraft[] },
  fields: readonly FieldDefinition[],
): string {
  return JSON.stringify({
    nodes: nodesFromDrafts(drafts.nodes, fields),
    edges: edgesFromDrafts(drafts.edges),
  });
}

/** parseGraph reads what the editor submitted; null when the payload is broken. */
export function parseGraph(raw: string): { nodes: ProcessNode[]; edges: ProcessEdge[] } | null {
  if (raw.trim() === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const graph = parsed as { nodes?: unknown; edges?: unknown };
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return null;
    }
    return { nodes: graph.nodes as ProcessNode[], edges: graph.edges as ProcessEdge[] };
  } catch {
    return null;
  }
}
