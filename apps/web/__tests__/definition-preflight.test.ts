import { describe, expect, it } from 'vitest';

import { preflightProblems } from '@/components/workflows/definition-preflight';
import type {
  DraftEdge,
  DraftNode,
  WorkflowDraft,
} from '@/components/workflows/definition-draft-model';

function node(partial: Partial<DraftNode> & Pick<DraftNode, 'key' | 'type'>): DraftNode {
  return { title: partial.key, x: 0, y: 0, ...partial };
}

function draft(nodes: DraftNode[], edges: DraftEdge[] = []): WorkflowDraft {
  return { nodes, edges };
}

/** The template a new process starts from: nhận yêu cầu → duyệt → kết thúc. */
const template = draft(
  [
    node({ key: 'start', type: 'start', title: 'Nhận yêu cầu' }),
    node({
      key: 'approve',
      type: 'human_task',
      title: 'Duyệt yêu cầu',
      assigneeRole: 'truong_bo_phan',
    }),
    node({ key: 'end', type: 'end', title: 'Kết thúc' }),
  ],
  [
    { id: 'e1', from: 'start', to: 'approve' },
    { id: 'e2', from: 'approve', to: 'end' },
  ],
);

describe('preflightProblems', () => {
  it('says nothing about a graph the service accepts', () => {
    expect(preflightProblems(template)).toEqual([]);
  });

  it('names the missing corners of the graph', () => {
    expect(preflightProblems(draft([])).join(' | ')).toContain('Thiếu bước Bắt đầu');
    expect(preflightProblems(draft([])).join(' | ')).toContain('Thiếu bước Kết thúc');
    expect(preflightProblems(draft([])).join(' | ')).toContain('Chưa có bước nào giao cho người');

    const twoStarts = draft([
      node({ key: 'start', type: 'start' }),
      node({ key: 'start_2', type: 'start' }),
      node({ key: 'end', type: 'end' }),
      node({ key: 'approve', type: 'human_task', assigneeRole: 'truong_bo_phan' }),
    ]);
    expect(preflightProblems(twoStarts).join(' | ')).toContain('Có 2 bước Bắt đầu');
  });

  it('tells a human task without a role, and one with a role that is not a key', () => {
    const noRole = draft([
      node({ key: 'start', type: 'start' }),
      node({ key: 'approve', type: 'human_task', title: 'Duyệt yêu cầu' }),
      node({ key: 'end', type: 'end' }),
    ]);

    expect(preflightProblems(noRole).join(' | ')).toContain(
      'Bước “Duyệt yêu cầu” chưa gán vai trò',
    );

    const labelled = draft([
      node({ key: 'start', type: 'start' }),
      node({
        key: 'approve',
        type: 'human_task',
        title: 'Duyệt yêu cầu',
        assigneeRole: 'Trưởng bộ phận',
      }),
      node({ key: 'end', type: 'end' }),
    ]);
    expect(preflightProblems(labelled).join(' | ')).toContain('không hợp lệ');
  });

  it('asks a condition for its field and its two branches', () => {
    const problems = preflightProblems(
      draft(
        [
          node({ key: 'start', type: 'start' }),
          node({ key: 'approve', type: 'human_task', assigneeRole: 'truong_bo_phan' }),
          node({ key: 'gate', type: 'condition', title: 'Trên 20 triệu?' }),
          node({ key: 'end', type: 'end' }),
        ],
        [
          { id: 'e1', from: 'start', to: 'approve' },
          { id: 'e2', from: 'approve', to: 'gate' },
          { id: 'e3', from: 'gate', to: 'end', when: 'true' },
        ],
      ),
    );

    expect(problems.join(' | ')).toContain('“Trên 20 triệu?” chưa chọn trường dữ liệu');
    expect(problems.join(' | ')).toContain('cần đúng hai đường nối đi tiếp');
  });

  it('counts the ways onward: one for a step, two branches for a condition, none after the end', () => {
    const twoWays = preflightProblems(
      draft(
        [
          node({ key: 'start', type: 'start' }),
          node({ key: 'approve', type: 'human_task', assigneeRole: 'truong_bo_phan' }),
          node({ key: 'end', type: 'end' }),
          node({ key: 'end_2', type: 'end' }),
        ],
        [
          { id: 'e1', from: 'start', to: 'approve' },
          { id: 'e2', from: 'start', to: 'end_2' },
          { id: 'e3', from: 'approve', to: 'end' },
          { id: 'e4', from: 'end', to: 'end_2' },
        ],
      ),
    );

    expect(twoWays.join(' | ')).toContain(
      'Bước “start” cần đúng một đường nối đi tiếp (đang có 2)',
    );
    expect(twoWays.join(' | ')).toContain('Bước Kết thúc “end” không được nối đi tiếp');
  });

  it('does not block a graph the service would take: a condition that branches to two steps', () => {
    const branched = draft(
      [
        node({ key: 'start', type: 'start' }),
        node({
          key: 'gate',
          type: 'condition',
          title: 'Trên 20 triệu?',
          condition: { field: 'amount', op: 'gte', value: 20000000 },
        }),
        node({ key: 'approve', type: 'human_task', assigneeRole: 'truong_bo_phan' }),
        node({ key: 'end', type: 'end' }),
      ],
      [
        { id: 'e1', from: 'start', to: 'gate' },
        { id: 'e2', from: 'gate', to: 'approve', when: 'true' },
        { id: 'e3', from: 'gate', to: 'end', when: 'false' },
        { id: 'e4', from: 'approve', to: 'end' },
      ],
    );

    expect(preflightProblems(branched)).toEqual([]);
  });

  it('leaves what only the service can see to the service', () => {
    // A loop is drawable and every corner here is present, so the checklist is quiet —
    // the service is what refuses it at publish. This is not a second validator.
    const loop = draft(
      [
        node({ key: 'start', type: 'start' }),
        node({ key: 'approve', type: 'human_task', assigneeRole: 'truong_bo_phan' }),
        node({
          key: 'gate',
          type: 'condition',
          condition: { field: 'amount', op: 'gte', value: 20000000 },
        }),
        node({ key: 'end', type: 'end' }),
      ],
      [
        { id: 'e1', from: 'start', to: 'approve' },
        { id: 'e2', from: 'approve', to: 'gate' },
        { id: 'e3', from: 'gate', to: 'approve', when: 'true' },
        { id: 'e4', from: 'gate', to: 'end', when: 'false' },
      ],
    );

    expect(preflightProblems(loop)).toEqual([]);
  });
});
