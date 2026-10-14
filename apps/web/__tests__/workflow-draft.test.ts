import { describe, expect, it } from 'vitest';
import type { ProcessNode } from '@opvaryn/contracts';

import {
  DRAFT_MAX_NODES,
  addNode,
  canvasSize,
  connectNodes,
  draftFromGraph,
  draftGraph,
  isDraftChanged,
  moveNode,
  nudgeNode,
  parseDraft,
  removeEdge,
  removeNode,
  serializeDraft,
  updateNode,
  validateDraft,
} from '@/components/workflows/definition-draft-model';

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
      condition: { field: 'amount', op: 'gte', value: 20000000 },
    },
    { key: 'end', type: 'end', title: 'Kết thúc' },
  ] as ProcessNode[],
  edges: [
    { from: 'start', to: 'approve' },
    { from: 'approve', to: 'gate' },
    { from: 'gate', to: 'end', when: 'true' as const },
  ],
};

describe('draftFromGraph', () => {
  it('starts from the published graph, laid out, so publishing is a no-op', () => {
    const draft = draftFromGraph(graph.nodes, graph.edges);

    expect(draft.nodes.map((node) => node.key)).toEqual(['start', 'approve', 'gate', 'end']);
    expect(draft.nodes.every((node) => node.x > 0 || node.key === 'start')).toBe(true);
    expect(draft.edges).toHaveLength(3);
    expect(draft.edges[2]?.when).toBe('true');
    expect(isDraftChanged(draft, draft)).toBe(false);
    expect(draftGraph(draft).nodes).toEqual(graph.nodes);
  });

  it('drops positions when the draft is published', () => {
    const draft = moveNode(draftFromGraph(graph.nodes, graph.edges), 'approve', 500, 500);

    // Moving a node changes the canvas, not the process.
    expect(isDraftChanged(draft, draftFromGraph(graph.nodes, graph.edges))).toBe(false);
    expect(draftGraph(draft).nodes).toEqual(graph.nodes);
  });
});

describe('editing', () => {
  it('moves and nudges a node, clamped to the canvas', () => {
    const draft = draftFromGraph(graph.nodes, graph.edges);

    expect(moveNode(draft, 'approve', 320, 240).nodes[1]).toMatchObject({ x: 320, y: 240 });
    expect(moveNode(draft, 'approve', -50, -50).nodes[1]).toMatchObject({ x: 0, y: 0 });
    expect(nudgeNode(draft, 'approve', 20, 0).nodes[1]?.x).toBe(draft.nodes[1]!.x + 20);
    expect(nudgeNode(draft, 'missing', 20, 0)).toBe(draft);
  });

  it('adds a node with a readable key and refuses past the cap', () => {
    const draft = draftFromGraph(graph.nodes, graph.edges);
    const added = addNode(draft, 'human_task', 100, 100);

    expect(added.added).toBe(true);
    expect(added.key).toBe('task_1');
    expect(added.draft.nodes).toHaveLength(5);

    const full = {
      nodes: Array.from({ length: DRAFT_MAX_NODES }, (_, index) => ({
        key: `n${index}`,
        type: 'human_task' as const,
        title: 'x',
        x: 0,
        y: 0,
      })),
      edges: [],
    };
    expect(addNode(full, 'end', 0, 0).added).toBe(false);
  });

  it('updates a node in place', () => {
    const draft = updateNode(draftFromGraph(graph.nodes, graph.edges), 'approve', {
      title: 'Trưởng bộ phận duyệt (v2)',
    });

    expect(draft.nodes[1]?.title).toBe('Trưởng bộ phận duyệt (v2)');
    expect(isDraftChanged(draft, draftFromGraph(graph.nodes, graph.edges))).toBe(true);
  });

  it('removes a node together with every edge that touched it', () => {
    const draft = removeNode(draftFromGraph(graph.nodes, graph.edges), 'gate');

    expect(draft.nodes.map((node) => node.key)).toEqual(['start', 'approve', 'end']);
    // approve -> gate and gate -> end both disappeared with the node.
    expect(draft.edges.map((edge) => edge.from)).toEqual(['start']);
  });

  it('removes one edge without touching the rest', () => {
    const draft = removeEdge(draftFromGraph(graph.nodes, graph.edges), 'e2');

    expect(draft.edges.map((edge) => edge.from)).toEqual(['start', 'gate']);
  });

  it('connects two nodes, refusing a self-loop and a duplicate', () => {
    const draft = draftFromGraph(graph.nodes, graph.edges);

    const connected = connectNodes(draft, 'end', 'start');
    expect(connected.error).toBeNull();
    expect(connected.draft.edges).toHaveLength(4);

    expect(connectNodes(draft, 'start', 'start').error).toContain('chính nó');
    expect(connectNodes(draft, 'start', 'approve').error).toContain('đã có');
    // The same pair with a different branch is a different edge.
    expect(connectNodes(draft, 'gate', 'end', 'false').error).toBeNull();
  });

  it('sizes the canvas so another node fits, with a floor for an empty area', () => {
    const size = canvasSize(draftFromGraph(graph.nodes, graph.edges));

    // Four nodes in a row: the canvas is wider than the floor and at least as tall.
    expect(size.width).toBeGreaterThan(640);
    expect(size.height).toBeGreaterThanOrEqual(320);
  });
});

describe('draft validation and storage', () => {
  it('round-trips through the cookie form', () => {
    const draft = draftFromGraph(graph.nodes, graph.edges);

    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it('refuses anything that is not a draft', () => {
    expect(parseDraft(undefined)).toBeNull();
    expect(parseDraft('')).toBeNull();
    expect(parseDraft('{not json')).toBeNull();
    expect(parseDraft('x'.repeat(9000))).toBeNull();
    expect(validateDraft(null).ok).toBe(false);
    expect(validateDraft({ nodes: [], edges: [] }).ok).toBe(false);
  });

  it('drops unusable entries instead of failing the whole draft', () => {
    const result = validateDraft({
      nodes: [
        { key: 'start', type: 'start', title: 'Bắt đầu', x: 10, y: 10 },
        { key: 'start', type: 'start', title: 'trùng key', x: 0, y: 0 },
        { key: 'weird', type: 'not_a_type', title: 'sai kiểu', x: 0, y: 0 },
        { key: '', type: 'end', title: 'thiếu key', x: 0, y: 0 },
      ],
      edges: [
        { from: 'start', to: 'start' },
        { from: 'start', to: 'missing' },
        { from: 'start', to: 'start' },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.nodes.map((node) => node.key)).toEqual(['start']);
      expect(result.draft.edges).toEqual([]);
      // A node without a title falls back to its key rather than rendering blank.
      expect(result.draft.nodes[0]?.title).toBe('Bắt đầu');
    }
  });

  it('names an untitled node after its key', () => {
    const result = validateDraft({ nodes: [{ key: 'approve', type: 'human_task' }], edges: [] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.nodes[0]?.title).toBe('approve');
      expect(result.draft.nodes[0]).toMatchObject({ x: 0, y: 0 });
    }
  });
});
