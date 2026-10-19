'use server';

import { revalidatePath } from 'next/cache';

import type { ProcessInstanceView } from '@opvaryn/contracts';

import { type DecisionState } from '@/components/tasks/decision-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { labelOrKey, roleLabels } from '@/lib/names';

const DECISIONS = ['approve', 'return', 'reject'] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * Applies one decision through the API. The web app does not decide anything: the
 * task role, the reason requirement and the compare-and-swap all live in the Go
 * service, and a decision that lost the race comes back as 409 and is shown as
 * such. This action only assembles the request and phrases the outcome.
 */
export async function decideProcessTaskAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const instanceId = String(formData.get('instanceId') ?? '').trim();
  const taskId = String(formData.get('taskId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!instanceId || !taskId) {
    return { status: 'error', message: 'Thiếu thông tin quy trình. Tải lại trang rồi thử lại.' };
  }
  if (!isDecision(decision)) {
    return { status: 'error', message: 'Chọn một quyết định: duyệt, trả về hoặc từ chối.' };
  }

  let view: ProcessInstanceView;
  try {
    view = await createServerApiClient().decideProcessTask(instanceId, taskId, {
      decision,
      ...(reason === '' ? {} : { reason }),
    });
  } catch (cause) {
    return { status: 'error', message: describeApiError(cause) };
  }

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${instanceId}`);

  // The sentence names the next step and its role the way the screen does — the step's own
  // title and the role's label, never the engine's keys (ADR 0016/0018). A missing
  // catalogue only means the key is shown instead.
  const labels = await loadRoleLabels();
  return { status: 'success', decided: decision, message: describeOutcome(view, decision, labels) };
}

async function loadRoleLabels(): Promise<ReadonlyMap<string, string>> {
  try {
    return roleLabels(await createServerApiClient().listRoles());
  } catch {
    return new Map();
  }
}

function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value);
}

/** describeOutcome says what the engine did, read from the instance it returned. */
function describeOutcome(
  view: ProcessInstanceView,
  decision: Decision,
  roles: ReadonlyMap<string, string>,
): string {
  const { state, attempt } = view.instance;
  const waiting = view.tasks.filter((task) => task.status === 'open');

  if (decision === 'reject' || state === 'rejected') {
    return 'Đã từ chối — quy trình kết thúc. Người đề nghị đọc được lý do trong nhật ký.';
  }
  if (state === 'completed') {
    return 'Đã duyệt — quy trình hoàn tất. Diễn biến đã được ghi vào nhật ký.';
  }
  if (decision === 'return') {
    return `Đã trả về người đề nghị — quy trình chạy lại từ đầu với lần ${attempt}${nextStepLabel(waiting, roles)}.`;
  }
  const next = waiting[0]?.title ?? 'bước tiếp theo';
  return `Đã duyệt — quy trình chuyển tới bước “${next}”${nextStepLabel(waiting, roles)}.`;
}

function nextStepLabel(
  waiting: ProcessInstanceView['tasks'],
  roles: ReadonlyMap<string, string>,
): string {
  if (waiting.length === 0) {
    return '';
  }
  const names = [
    ...new Set(waiting.map((task) => labelOrKey(roles.get(task.assigneeRole), task.assigneeRole))),
  ].join(', ');
  return `, việc tiếp theo thuộc ${names}`;
}
