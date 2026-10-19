import { describe, expect, it } from 'vitest';
import type { ProcessEvent, ProcessTask } from '@opvaryn/contracts';

import {
  describeEvent,
  formatPayloadValue,
  nextTasks,
  openTasksForUser,
} from '@/components/process/process-timeline';

function event(type: string, payload: Record<string, unknown> = {}, id = 1): ProcessEvent {
  return {
    id,
    type,
    actor: 'lan@opvaryn.local',
    payload,
    createdAt: '2026-10-14T03:00:00Z',
  };
}

function task(status: ProcessTask['status'], assigneeRole = 'truong_bo_phan'): ProcessTask {
  return {
    id: `task-${status}-${assigneeRole}`,
    nodeKey: 'approve',
    title: 'Trưởng bộ phận duyệt',
    assigneeRole,
    attempt: 1,
    status,
    createdAt: '2026-10-14T03:00:00Z',
  };
}

describe('describeEvent', () => {
  it('labels known audit types and keeps unknown ones visible', () => {
    expect(describeEvent(event('instance_started', { attempt: 1 })).label).toBe(
      'Khởi tạo quy trình',
    );
    expect(describeEvent(event('task_approved', { attempt: 1 })).label).toBe('Duyệt');
    // A new server-side event must show up rather than disappear from the timeline.
    expect(describeEvent(event('task_delegated')).label).toBe('task_delegated');
  });

  it('shows the role and attempt a task event carries', () => {
    const entry = describeEvent(
      event('task_created', { attempt: 2, role: 'ke_toan', title: 'Kế toán duyệt' }),
    );

    expect(entry.detail).toBe('ke_toan · lần 2');
  });

  it('reads the role and the field in their names when it is given them', () => {
    const entry = describeEvent(
      event('condition_evaluated', {
        field: 'estimated_amount',
        op: 'gte',
        value: 20000000,
        actual: 1500000,
        result: false,
      }),
      {
        roles: new Map([['ke_toan', 'Kế toán']]),
        fields: new Map([['estimated_amount', 'Giá trị dự kiến (VND)']]),
      },
    );

    expect(entry.detail).toBe('Giá trị dự kiến (VND) từ 20000000 → sai (giá trị thực tế: 1500000)');
  });

  it('shows what a condition saw, not only its outcome', () => {
    const entry = describeEvent(
      event('condition_evaluated', {
        field: 'amount',
        op: 'gte',
        value: 1000000,
        actual: 1500000,
        result: true,
      }),
    );

    expect(entry.detail).toBe('amount từ 1000000 → đúng (giá trị thực tế: 1500000)');
  });

  it('reports a false condition as sai', () => {
    const entry = describeEvent(
      event('condition_evaluated', {
        field: 'amount',
        op: 'gte',
        value: 1000000,
        actual: 5000,
        result: false,
      }),
    );

    expect(entry.detail).toContain('sai');
    expect(entry.detail).toContain('5000');
  });

  it('surfaces the reason of a return or reject decision', () => {
    const entry = describeEvent(
      event('task_returned', { attempt: 1, role: 'ke_toan', reason: 'Bổ sung báo giá' }),
    );

    expect(entry.reason).toBe('Bổ sung báo giá');
  });

  it('has no reason for an approve event and no detail for an unknown one', () => {
    const entry = describeEvent(event('task_approved', { attempt: 1, role: 'ke_toan' }));

    expect(entry.reason).toBeNull();
    expect(describeEvent(event('unknown_type')).detail).toBeNull();
  });

  it('describes an attempt reset with the numbers it moved between', () => {
    const entry = describeEvent(event('instance_returned', { attempt: 2, previousAttempt: 1 }));

    expect(entry.label).toBe('Quay lại điểm bắt đầu (lần mới)');
    expect(entry.detail).toBe('lần 1 → lần 2');
  });
});

describe('openTasksForUser', () => {
  it('keeps only open tasks assigned to a role the user holds', () => {
    const tasks = [
      task('open', 'truong_bo_phan'),
      task('approved', 'truong_bo_phan'),
      task('open', 'giam_doc'),
    ];

    const mine = openTasksForUser(tasks, ['truong_bo_phan']);

    expect(mine.map((item) => item.assigneeRole)).toEqual(['truong_bo_phan']);
  });

  it('offers nothing to a user without the task role', () => {
    expect(openTasksForUser([task('open', 'giam_doc')], ['ke_toan'])).toEqual([]);
  });

  it('offers nothing when the only task is already decided', () => {
    expect(openTasksForUser([task('returned')], ['truong_bo_phan'])).toEqual([]);
  });
});

describe('nextTasks', () => {
  it('returns the tasks still waiting on a decision', () => {
    const tasks = [task('approved'), task('open'), task('rejected')];

    expect(nextTasks(tasks)).toHaveLength(1);
  });
});

describe('formatPayloadValue', () => {
  it('renders primitives plainly and structures as JSON', () => {
    expect(formatPayloadValue('urgent')).toBe('urgent');
    expect(formatPayloadValue(1500000)).toBe('1500000');
    expect(formatPayloadValue(null)).toBe('null');
    expect(formatPayloadValue({ a: 1 })).toBe('{"a":1}');
  });
});
