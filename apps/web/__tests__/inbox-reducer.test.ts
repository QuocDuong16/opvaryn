import { describe, expect, it } from 'vitest';

import { cloneTasks, countByStatus, DEMO_TASKS } from '@/components/tasks/demo-tasks';
import { inboxReducer } from '@/components/tasks/inbox-reducer';

const AT = '13/10 · 20:00';

describe('inboxReducer', () => {
  it('approves a pending task and appends the event', () => {
    const state = inboxReducer(cloneTasks(DEMO_TASKS), {
      type: 'approve',
      taskId: 'PR-2026-014',
      at: AT,
    });

    const task = state.find((item) => item.id === 'PR-2026-014');
    expect(task?.status).toBe('approved');
    expect(task?.timeline.at(-1)).toEqual({
      at: AT,
      actor: 'Bạn (demo)',
      action: 'Duyệt đề nghị',
    });
  });

  it('keeps the reason when rejecting and returning', () => {
    let state = inboxReducer(cloneTasks(DEMO_TASKS), {
      type: 'reject',
      taskId: 'PR-2026-014',
      at: AT,
      reason: 'Ngoài ngân sách quý',
    });
    state = inboxReducer(state, {
      type: 'return',
      taskId: 'PR-2026-009',
      at: AT,
      note: 'Bổ sung báo giá',
    });

    expect(state.find((item) => item.id === 'PR-2026-014')?.timeline.at(-1)?.note).toBe(
      'Ngoài ngân sách quý',
    );
    const returned = state.find((item) => item.id === 'PR-2026-009');
    expect(returned?.status).toBe('returned');
    expect(returned?.timeline.at(-1)?.note).toBe('Bổ sung báo giá');
  });

  it('ignores a second action on a task that is no longer pending', () => {
    let state = inboxReducer(cloneTasks(DEMO_TASKS), {
      type: 'approve',
      taskId: 'PR-2026-014',
      at: AT,
    });
    const timelineLength = state.find((item) => item.id === 'PR-2026-014')?.timeline.length ?? 0;

    state = inboxReducer(state, {
      type: 'reject',
      taskId: 'PR-2026-014',
      at: AT,
      reason: 'quá muộn',
    });

    const task = state.find((item) => item.id === 'PR-2026-014');
    expect(task?.status).toBe('approved');
    expect(task?.timeline.length).toBe(timelineLength);
  });

  it('never mutates the fixtures', () => {
    const before = DEMO_TASKS.map((task) => task.timeline.length);

    inboxReducer(cloneTasks(DEMO_TASKS), { type: 'approve', taskId: 'PR-2026-014', at: AT });

    expect(DEMO_TASKS.map((task) => task.timeline.length)).toEqual(before);
  });

  it('reset restores the seeded state', () => {
    let state = inboxReducer(cloneTasks(DEMO_TASKS), {
      type: 'approve',
      taskId: 'PR-2026-014',
      at: AT,
    });
    state = inboxReducer(state, { type: 'reset', tasks: DEMO_TASKS });

    expect(countByStatus(state)).toEqual(countByStatus(DEMO_TASKS));
    expect(state.find((item) => item.id === 'PR-2026-014')?.status).toBe('pending');
  });
});

describe('countByStatus', () => {
  it('counts the seeded inbox', () => {
    expect(countByStatus(DEMO_TASKS)).toEqual({
      pending: 4,
      approved: 0,
      rejected: 0,
      returned: 1,
    });
  });
});
