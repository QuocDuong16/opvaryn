import type { DemoTask } from '@/components/tasks/demo-tasks';

/**
 * Inbox state transitions for the demo. The reducer is pure (the caller supplies
 * the timestamp label) so behavior is testable without a browser, and it only
 * moves tasks that are still pending — the same rule a real runtime must enforce
 * server-side before it applies a transition.
 */
export type InboxAction =
  | { type: 'approve'; taskId: string; at: string }
  | { type: 'reject'; taskId: string; at: string; reason: string }
  | { type: 'return'; taskId: string; at: string; note: string }
  | { type: 'reset'; tasks: readonly DemoTask[] };

export function inboxReducer(state: DemoTask[], action: InboxAction): DemoTask[] {
  switch (action.type) {
    case 'approve':
      return updatePending(state, action.taskId, (task) => ({
        ...task,
        status: 'approved',
        holder: 'Hoàn tất — chuyển bước tiếp theo của quy trình',
        timeline: [
          ...task.timeline,
          { at: action.at, actor: 'Bạn (demo)', action: 'Duyệt đề nghị' },
        ],
      }));

    case 'reject':
      return updatePending(state, action.taskId, (task) => ({
        ...task,
        status: 'rejected',
        holder: 'Đã kết thúc — người đề nghị được thông báo',
        timeline: [
          ...task.timeline,
          {
            at: action.at,
            actor: 'Bạn (demo)',
            action: 'Từ chối đề nghị',
            note: action.reason,
          },
        ],
      }));

    case 'return':
      return updatePending(state, action.taskId, (task) => ({
        ...task,
        status: 'returned',
        holder: `${task.submittedBy} — chờ chỉnh sửa và gửi lại`,
        timeline: [
          ...task.timeline,
          {
            at: action.at,
            actor: 'Bạn (demo)',
            action: 'Trả về người đề nghị',
            note: action.note,
          },
        ],
      }));

    case 'reset':
      return action.tasks.map((task) => ({ ...task, timeline: [...task.timeline] }));

    default:
      return state;
  }
}

function updatePending(
  state: DemoTask[],
  taskId: string,
  mutate: (task: DemoTask) => DemoTask,
): DemoTask[] {
  return state.map((task) =>
    task.id === taskId && task.status === 'pending' ? mutate(task) : task,
  );
}
