'use server';

import { revalidatePath } from 'next/cache';

import type { ProcessInstanceView } from '@opvaryn/contracts';

import { type DecisionState } from '@/components/tasks/decision-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

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
  return { status: 'success', decided: decision, message: describeOutcome(view, decision) };
}

function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value);
}

/** describeOutcome says what the engine did, read from the instance it returned. */
function describeOutcome(view: ProcessInstanceView, decision: Decision): string {
  const { state, currentNode, attempt } = view.instance;
  const waiting = view.tasks.filter((task) => task.status === 'open');

  if (decision === 'reject' || state === 'rejected') {
    return 'Đã từ chối — quy trình kết thúc (từ chối là terminal, D08a). Người đề nghị đọc được lý do trong timeline.';
  }
  if (state === 'completed') {
    return 'Đã duyệt — quy trình hoàn tất. Sự kiện đã ghi vào event log append-only.';
  }
  if (decision === 'return') {
    return `Đã trả về người đề nghị — quy trình chạy lại từ đầu với lần ${attempt}${nextStepLabel(waiting)}.`;
  }
  return `Đã duyệt — quy trình chuyển tới bước “${currentNode}”${nextStepLabel(waiting)}.`;
}

function nextStepLabel(waiting: ProcessInstanceView['tasks']): string {
  if (waiting.length === 0) {
    return '';
  }
  const roles = [...new Set(waiting.map((task) => task.assigneeRole))].join(', ');
  return `, việc tiếp theo thuộc role ${roles}`;
}
