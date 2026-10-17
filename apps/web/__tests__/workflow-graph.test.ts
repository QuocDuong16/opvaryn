import { describe, expect, it } from 'vitest';
import type { ProcessNode } from '@opvaryn/contracts';

import {
  conditionSummary,
  layoutGraph,
  nodeSubtitle,
  outgoingEdges,
} from '@/components/workflows/definition-layout';
import { parseGraph } from '@/components/workflows/definition-draft';

/** A definition shaped like the seeded purchase approval flow. */
const graph = {
  nodes: [
    { key: 'start', type: 'start', title: 'Nhận đề nghị' },
    {
      key: 'approve',
      type: 'human_task',
      title: 'Trưởng bộ phận duyệt',
      assigneeRole: 'truong_bo_phan',
    },
    {
      key: 'gate',
      type: 'condition',
      title: 'Trên 20 triệu?',
      condition: { field: 'estimated_amount', op: 'gte', value: 20000000 },
    },
    { key: 'director', type: 'human_task', title: 'Giám đốc duyệt', assigneeRole: 'giam_doc' },
    { key: 'end', type: 'end', title: 'Kết thúc' },
  ] as ProcessNode[],
  edges: [
    { from: 'start', to: 'approve' },
    { from: 'approve', to: 'gate' },
    { from: 'gate', to: 'director', when: 'true' as const },
    { from: 'gate', to: 'end', when: 'false' as const },
    { from: 'director', to: 'end' },
  ],
};

describe('layoutGraph', () => {
  it('places each node one column per step from the start', () => {
    const layout = layoutGraph(graph);
    const depth = Object.fromEntries(layout.nodes.map((item) => [item.node.key, item.depth]));

    expect(depth).toEqual({ start: 0, approve: 1, gate: 2, director: 3, end: 4 });
  });

  it('keeps the longest path when a node is reachable twice', () => {
    // `end` is reachable from the condition (depth 3) and from the director (depth 4);
    // it must sit after both so the false branch does not cross the true branch.
    const layout = layoutGraph(graph);
    const end = layout.nodes.find((item) => item.node.key === 'end');

    expect(end?.depth).toBe(4);
  });

  it('stacks nodes that share a column and sizes the canvas around them', () => {
    const layout = layoutGraph({
      nodes: graph.nodes,
      edges: [
        { from: 'start', to: 'approve' },
        { from: 'start', to: 'director' },
        { from: 'approve', to: 'end' },
        { from: 'director', to: 'end' },
      ],
    });
    const approve = layout.nodes.find((item) => item.node.key === 'approve');
    const director = layout.nodes.find((item) => item.node.key === 'director');

    expect(approve?.x).toBe(director?.x);
    expect(approve?.y).not.toBe(director?.y);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('still shows a node the walk cannot reach instead of dropping it', () => {
    const layout = layoutGraph({
      nodes: [...graph.nodes, { key: 'orphan', type: 'human_task', title: 'Mồ côi' }],
      edges: graph.edges,
    });

    const orphan = layout.nodes.find((item) => item.node.key === 'orphan');
    expect(orphan).toBeDefined();
    expect(orphan?.depth).toBeGreaterThan(0);
    expect(layout.nodes).toHaveLength(graph.nodes.length + 1);
  });
});

describe('nodeSubtitle', () => {
  it('names the role of a human task and the condition of a condition step', () => {
    expect(nodeSubtitle(graph.nodes[1] as ProcessNode)).toBe('vai trò truong_bo_phan');
    expect(nodeSubtitle(graph.nodes[2] as ProcessNode)).toBe('estimated_amount gte 20000000');
  });

  it('says a human task has no role yet instead of showing nothing', () => {
    expect(nodeSubtitle({ key: 'x', type: 'human_task', title: 'Việc' })).toBe('chưa gán vai trò');
  });
});

describe('conditionSummary', () => {
  it('renders the literal as written', () => {
    expect(conditionSummary({ field: 'severity', op: 'eq', value: 'nghiem_trong' })).toBe(
      'severity eq nghiem_trong',
    );
    expect(conditionSummary(undefined)).toBe('—');
  });
});

describe('outgoingEdges', () => {
  it('labels a branch edge with its when value and an unconditional one as luôn', () => {
    expect(outgoingEdges(graph, 'start')).toEqual([{ edge: graph.edges[0], label: 'luôn' }]);
    expect(outgoingEdges(graph, 'gate').map((item) => item.label)).toEqual(['true', 'false']);
  });
});

describe('parseGraph', () => {
  it('reads the graph the canvas submitted', () => {
    const payload = JSON.stringify({ nodes: graph.nodes, edges: graph.edges });

    expect(parseGraph(payload)).toEqual({ nodes: graph.nodes, edges: graph.edges });
  });

  it('answers null for anything that is not a graph', () => {
    expect(parseGraph('')).toBeNull();
    expect(parseGraph('{not json')).toBeNull();
    expect(parseGraph('{"nodes":[]}')).toBeNull();
    expect(parseGraph('null')).toBeNull();
  });
});
