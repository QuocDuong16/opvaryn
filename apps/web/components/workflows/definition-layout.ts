import type { ProcessCondition, ProcessEdge, ProcessNode } from '@opvaryn/contracts';

/**
 * The graph the canvas draws. Nodes come from a published definition version; the
 * fixture that used to carry hand-placed x/y coordinates is gone, so the layout is
 * computed from the graph itself.
 */
export interface ProcessGraph {
  nodes: readonly ProcessNode[];
  edges: readonly ProcessEdge[];
}

export const NODE_WIDTH = 158;
export const NODE_HEIGHT = 58;
const GAP_X = 56;
const GAP_Y = 22;
const PADDING = 24;

/** A node with the coordinates the canvas draws it at. */
export interface PositionedNode {
  node: ProcessNode;
  x: number;
  y: number;
  /** Distance from the start node; the column the node sits in. */
  depth: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  width: number;
  height: number;
}

/** Vietnamese labels for the node types the engine executes (ADR 0007). */
export const NODE_TYPE_LABELS: Record<ProcessNode['type'], string> = {
  start: 'Bắt đầu',
  human_task: 'Việc của người',
  condition: 'Điều kiện',
  end: 'Kết thúc',
};

/**
 * layoutGraph places each node in a column by its distance from the start node and
 * stacks nodes that share a column. The engine's graphs are DAGs with a single
 * start, so a breadth-first walk always reaches every node; anything unreachable
 * (a graph the API would have rejected) is placed in a trailing column rather than
 * dropped, because a canvas that hides a node would lie about the definition.
 */
export function layoutGraph(graph: ProcessGraph): GraphLayout {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.from);
    if (targets) {
      targets.push(edge.to);
    } else {
      outgoing.set(edge.from, [edge.to]);
    }
  }

  const depth = new Map<string, number>();
  const start = graph.nodes.find((node) => node.type === 'start');
  if (start) {
    const queue: string[] = [start.key];
    depth.set(start.key, 0);
    while (queue.length > 0) {
      const key = queue.shift() as string;
      const current = depth.get(key) ?? 0;
      for (const next of outgoing.get(key) ?? []) {
        const known = depth.get(next);
        // Keep the longest path, so a node reachable by two routes sits after both.
        if (known === undefined || known < current + 1) {
          depth.set(next, current + 1);
          queue.push(next);
        }
      }
    }
  }

  const columns = new Map<number, ProcessNode[]>();
  let maxDepth = 0;
  for (const value of depth.values()) {
    maxDepth = Math.max(maxDepth, value);
  }
  for (const node of graph.nodes) {
    // A node the walk did not reach (the API rejects such graphs) still gets a
    // column of its own at the end instead of disappearing from the canvas.
    const column = depth.get(node.key) ?? maxDepth + 1;
    depth.set(node.key, column);
    const bucket = columns.get(column);
    if (bucket) {
      bucket.push(node);
    } else {
      columns.set(column, [node]);
    }
  }

  const positioned: PositionedNode[] = [];
  let maxRows = 1;
  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const bucket = columns.get(column) ?? [];
    maxRows = Math.max(maxRows, bucket.length);
    bucket.forEach((node, row) => {
      positioned.push({
        node,
        depth: column,
        x: PADDING + column * (NODE_WIDTH + GAP_X),
        y: PADDING + row * (NODE_HEIGHT + GAP_Y),
      });
    });
  }

  return {
    nodes: positioned,
    width: PADDING * 2 + (columns.size || 1) * NODE_WIDTH + Math.max(0, columns.size - 1) * GAP_X,
    height: PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * GAP_Y,
  };
}

/** conditionSummary renders the JSON condition (D04) as one readable line. */
export function conditionSummary(condition: ProcessCondition | undefined): string {
  if (!condition) {
    return '—';
  }
  return `${condition.field} ${condition.op} ${formatLiteral(condition.value)}`;
}

function formatLiteral(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** nodeSubtitle is the second line inside a node box on the canvas. */
export function nodeSubtitle(node: ProcessNode): string {
  switch (node.type) {
    case 'human_task':
      return node.assigneeRole ? `vai trò ${node.assigneeRole}` : 'chưa gán vai trò';
    case 'condition':
      return conditionSummary(node.condition);
    default:
      return NODE_TYPE_LABELS[node.type];
  }
}

/** outgoingEdges returns the edges leaving a node, with their branch label. */
export function outgoingEdges(
  graph: ProcessGraph,
  nodeKey: string,
): readonly { edge: ProcessEdge; label: string }[] {
  return graph.edges
    .filter((edge) => edge.from === nodeKey)
    .map((edge) => ({ edge, label: edge.when === undefined ? 'luôn' : edge.when }));
}
