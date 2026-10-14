import { describe, expect, it } from 'vitest';
import type { FieldDefinition, ProcessNode } from '@opvaryn/contracts';

import {
  conditionSummary,
  layoutGraph,
  nodeSubtitle,
  outgoingEdges,
} from '@/components/workflows/definition-layout';
import {
  blankEdgeDraft,
  blankNodeDraft,
  conditionFromDraft,
  edgesFromDrafts,
  edgesToDrafts,
  nodesFromDrafts,
  nodesToDrafts,
  parseGraph,
  serializeGraph,
} from '@/components/workflows/definition-draft';

const amount: FieldDefinition = {
  key: 'estimated_amount',
  label: 'Giá trị dự kiến',
  type: 'number',
  required: true,
};

const severity: FieldDefinition = {
  key: 'severity',
  label: 'Mức độ',
  type: 'select',
  required: true,
  options: [
    { value: 'thap', label: 'Thấp' },
    { value: 'nghiem_trong', label: 'Nghiêm trọng' },
  ],
};

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
  it('names the role of a human task and the condition of a condition node', () => {
    expect(nodeSubtitle(graph.nodes[1] as ProcessNode)).toBe('role truong_bo_phan');
    expect(nodeSubtitle(graph.nodes[2] as ProcessNode)).toBe('estimated_amount gte 20000000');
  });

  it('says a human task has no role yet instead of showing nothing', () => {
    expect(nodeSubtitle({ key: 'x', type: 'human_task', title: 'Việc' })).toBe('chưa gán role');
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

describe('definition drafts', () => {
  it('round-trips a published graph through the editor rows', () => {
    const nodes = nodesToDrafts(graph.nodes);
    const edges = edgesToDrafts(graph.edges);
    const rebuilt = {
      nodes: nodesFromDrafts(nodes, [amount, severity]),
      edges: edgesFromDrafts(edges),
    };

    expect(rebuilt.nodes).toEqual(graph.nodes);
    expect(rebuilt.edges).toEqual(graph.edges);
  });

  it('drops empty rows instead of sending them to the API', () => {
    const nodes = nodesFromDrafts([blankNodeDraft()], []);
    const edges = edgesFromDrafts([blankEdgeDraft(), { from: 'start', to: '', when: '' }]);

    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('types a number literal so the condition compares as a number', () => {
    const draft = {
      ...blankNodeDraft(),
      conditionField: 'estimated_amount',
      conditionValue: '20000000',
    };

    expect(conditionFromDraft(draft, [amount])).toEqual({
      field: 'estimated_amount',
      op: 'eq',
      value: 20000000,
    });
  });

  it('keeps an unparsable number as text so the service can report it', () => {
    const draft = {
      ...blankNodeDraft(),
      conditionField: 'estimated_amount',
      conditionValue: 'hai mươi triệu',
    };

    expect(conditionFromDraft(draft, [amount]).value).toBe('hai mươi triệu');
  });

  it('keeps a select literal as the option value', () => {
    const draft = {
      ...blankNodeDraft(),
      conditionField: 'severity',
      conditionValue: 'nghiem_trong',
    };

    expect(conditionFromDraft(draft, [severity]).value).toBe('nghiem_trong');
  });

  it('omits the role of a human task and the condition of other node types', () => {
    const nodes = nodesFromDrafts(
      [
        { ...blankNodeDraft(), key: 'a', type: 'human_task', title: 'Việc' },
        { ...blankNodeDraft(), key: 'b', type: 'condition', title: 'Cổng' },
      ],
      [amount],
    );

    expect(nodes[0]).toEqual({ key: 'a', type: 'human_task', title: 'Việc' });
    expect(nodes[1]).toEqual({ key: 'b', type: 'condition', title: 'Cổng' });
  });

  it('serializes to the hidden input the action parses', () => {
    const payload = serializeGraph(
      { nodes: nodesToDrafts(graph.nodes), edges: edgesToDrafts(graph.edges) },
      [amount, severity],
    );

    expect(parseGraph(payload)).toEqual({ nodes: graph.nodes, edges: graph.edges });
    expect(parseGraph('not json')).toBeNull();
    expect(parseGraph('{"nodes":{}}')).toBeNull();
    expect(parseGraph('')).toBeNull();
  });
});
