import { operatorLabel } from '@/lib/names';
import type { ProcessEvent, ProcessInstance, ProcessTask } from '@opvaryn/contracts';

import { labelOrKey } from '@/lib/names';

/** Vietnamese labels for the lifecycle states in the contract enum. */
export const INSTANCE_STATE_LABELS: Record<ProcessInstance['state'], string> = {
  running: 'Đang chạy',
  completed: 'Hoàn tất',
  rejected: 'Đã từ chối',
};

/** Vietnamese labels for the task states in the contract enum. */
export const TASK_STATUS_LABELS: Record<ProcessTask['status'], string> = {
  open: 'Đang chờ quyết định',
  approved: 'Đã duyệt',
  returned: 'Đã trả về',
  rejected: 'Đã từ chối',
  // The contract carries the state so the enum can grow without a breaking change;
  // nothing cancels a task yet (ADR 0007 §12 defers cancellation).
  cancelled: 'Đã huỷ',
};

/**
 * EVENT_LABELS is the audit vocabulary from ADR 0007 §10. A type the web app has
 * not been taught yet renders as its raw value instead of disappearing, so a new
 * server-side event is visible in the timeline before this map is extended.
 */
export const EVENT_LABELS: Record<string, string> = {
  instance_started: 'Khởi tạo quy trình',
  task_created: 'Giao việc',
  task_approved: 'Duyệt',
  task_returned: 'Trả về chỉnh sửa',
  task_rejected: 'Từ chối',
  task_cancelled: 'Huỷ việc đang mở',
  instance_returned: 'Quay lại điểm bắt đầu (lần mới)',
  condition_evaluated: 'Đánh giá điều kiện',
  instance_completed: 'Kết thúc quy trình',
  instance_rejected: 'Kết thúc: bị từ chối',
};

/** One rendered line of the timeline. */
export interface TimelineEntry {
  id: number;
  label: string;
  /** Role or condition summary, when the event carries one. */
  detail: string | null;
  /** Reason of a return or reject decision, when the event carries one. */
  reason: string | null;
  actor: string;
  at: string;
}

/**
 * EventLabels is what the timeline needs to read in words: the name of a role and the label of
 * a field. The payload carries keys (they are what the engine compares), and a person reading
 * the log needs the names (ADR 0016/0018).
 */
export interface EventLabels {
  roles?: ReadonlyMap<string, string>;
  fields?: ReadonlyMap<string, string>;
}

/** describeEvent turns one audit event into what the timeline renders. */
export function describeEvent(event: ProcessEvent, labels: EventLabels = {}): TimelineEntry {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  return {
    id: event.id,
    label: EVENT_LABELS[event.type] ?? event.type,
    detail: describeDetail(event.type, payload, labels),
    reason: optionalString(payload.reason),
    actor: event.actor,
    at: event.createdAt,
  };
}

function describeDetail(
  eventType: string,
  payload: Record<string, unknown>,
  labels: EventLabels,
): string | null {
  switch (eventType) {
    case 'task_created':
    case 'task_approved':
    case 'task_returned':
    case 'task_rejected':
    case 'task_cancelled': {
      const role = optionalString(payload.role);
      const attempt = optionalNumber(payload.attempt);
      const parts: string[] = [];
      if (role) {
        parts.push(labelOrKey(labels.roles?.get(role), role));
      }
      if (attempt !== null) {
        parts.push(`lần ${attempt}`);
      }
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'condition_evaluated': {
      // What the condition saw is part of the decision trail (ADR 0007 §3), so the
      // timeline shows the comparison, not only the outcome.
      const field = optionalString(payload.field) ?? '?';
      const op = optionalString(payload.op) ?? '?';
      const fieldName = labelOrKey(labels.fields?.get(field), field);
      const opName = operatorLabel(op);
      const expected = formatPayloadValue(payload.value);
      const actual = formatPayloadValue(payload.actual);
      const result = payload.result === true ? 'đúng' : 'sai';
      return `${fieldName} ${opName} ${expected} → ${result} (giá trị thực tế: ${actual})`;
    }
    case 'instance_returned': {
      const previous = optionalNumber(payload.previousAttempt);
      const attempt = optionalNumber(payload.attempt);
      if (previous === null || attempt === null) {
        return null;
      }
      return `lần ${previous} → lần ${attempt}`;
    }
    default:
      return null;
  }
}

/**
 * openTasksForUser returns the tasks the signed-in user may decide: still open and
 * assigned to a role the user holds. The API enforces the same rule before it
 * applies a transition, so this only decides what the screen offers.
 */
export function openTasksForUser(
  tasks: readonly ProcessTask[],
  roles: readonly string[],
): ProcessTask[] {
  return tasks.filter((task) => task.status === 'open' && roles.includes(task.assigneeRole));
}

/** nextTaskOfInstance returns the open tasks of a running instance. */
export function nextTasks(tasks: readonly ProcessTask[]): ProcessTask[] {
  return tasks.filter((task) => task.status === 'open');
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** formatPayloadValue renders one audit payload value for a human reader. */
export function formatPayloadValue(value: unknown): string {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
