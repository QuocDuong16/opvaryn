import type { ProcessCondition, ProcessEdge, ProcessNode } from '@opvaryn/contracts';

/**
 * The graph as the API takes it.
 *
 * Only shape conversion happens here — the canvas builds the graph (definition-draft-model.ts)
 * and this reads back what the form submitted. The graph rules (one start, reachable, branch
 * shapes, condition literals against the object's fields) live in the Go service; the checklist
 * beside the canvas (definition-preflight.ts) says the common ones in the designer's words
 * before the service ever sees them.
 */

/** Condition operators the engine supports (D04). */
export const CONDITION_OPS: readonly ProcessCondition['op'][] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
];

/** parseGraph reads what the canvas submitted; null when the payload is broken. */
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
