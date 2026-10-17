import type { WorkflowDraft } from '@/components/workflows/definition-draft-model';

/**
 * The checklist a designer reads before publishing (ADR 0019).
 *
 * The Go service remains the authority on whether a graph is legal, and it still answers
 * for what this cannot see (cycles, unreachable steps, condition literals against the
 * bound object's fields). What this adds is the same verdict in the designer's words,
 * early enough to act on: the service reports `nodes[1].assigneeRole: must match …` and
 * `human_task`, which is the system's vocabulary, not theirs (ADR 0018).
 *
 * Every rule here is a necessary condition of a graph the service accepts, so a clean
 * checklist never blocks a definition the service would have taken. The editor disables
 * publish while something is listed and keeps the service's own message as the last word
 * for everything else.
 */

/** The shape a key must have; identical to the service's KeyPattern. */
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/** What a person calls a step: its title, or its key while it still has no title. */
function stepName(node: WorkflowDraft['nodes'][number]): string {
  const title = node.title.trim();
  return title === '' ? node.key : title;
}

/** preflightProblems lists, in Vietnamese, what still stands between the draft and a publish. */
export function preflightProblems(draft: WorkflowDraft): string[] {
  const problems: string[] = [];

  const starts = draft.nodes.filter((node) => node.type === 'start').length;
  const ends = draft.nodes.filter((node) => node.type === 'end').length;
  const tasks = draft.nodes.filter((node) => node.type === 'human_task').length;

  if (starts === 0) {
    problems.push('Thiếu bước Bắt đầu — quy trình cần đúng một bước Bắt đầu.');
  } else if (starts > 1) {
    problems.push(`Có ${starts} bước Bắt đầu — chỉ được có một.`);
  }
  if (ends === 0) {
    problems.push('Thiếu bước Kết thúc — quy trình cần ít nhất một bước Kết thúc.');
  }
  if (tasks === 0) {
    problems.push('Chưa có bước nào giao cho người — quy trình cần ít nhất một bước như vậy.');
  }

  for (const node of draft.nodes) {
    const name = stepName(node);
    const outgoing = draft.edges.filter((edge) => edge.from === node.key);
    const unconditional = outgoing.filter((edge) => edge.when === undefined).length;

    switch (node.type) {
      case 'start':
      case 'human_task': {
        if (node.type === 'human_task') {
          const role = (node.assigneeRole ?? '').trim();
          if (role === '') {
            problems.push(`Bước “${name}” chưa gán vai trò nhận việc.`);
          } else if (!KEY_PATTERN.test(role)) {
            problems.push(
              `Vai trò “${role}” ở bước “${name}” không hợp lệ — mã vai trò chỉ gồm chữ thường, số và dấu gạch dưới.`,
            );
          }
        }
        if (unconditional !== 1) {
          problems.push(
            `Bước “${name}” cần đúng một đường nối đi tiếp (đang có ${unconditional}).`,
          );
        }
        break;
      }
      case 'condition': {
        const field = (node.condition?.field ?? '').trim();
        if (field === '') {
          problems.push(`Bước điều kiện “${name}” chưa chọn trường dữ liệu để so sánh.`);
        }
        const yes = outgoing.filter((edge) => edge.when === 'true').length;
        const no = outgoing.filter((edge) => edge.when === 'false').length;
        if (yes !== 1 || no !== 1) {
          problems.push(
            `Bước điều kiện “${name}” cần đúng hai đường nối đi tiếp: một nhánh “đúng” và một nhánh “sai”.`,
          );
        }
        break;
      }
      case 'end': {
        if (outgoing.length > 0) {
          problems.push(`Bước Kết thúc “${name}” không được nối đi tiếp.`);
        }
        break;
      }
    }
  }

  return problems;
}
