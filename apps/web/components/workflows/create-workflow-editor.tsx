'use client';

import { useActionState, useState } from 'react';
import type { BusinessObject, RoleEntry } from '@opvaryn/contracts';

import { createProcessDefinitionAction } from '@/app/(workspace)/workflows/actions';
import { GraphCanvas } from '@/components/workflows/graph-canvas';
import { preflightProblems } from '@/components/workflows/definition-preflight';
import { firstTaskKey, templateDraft } from '@/components/workflows/new-definition-template';
import {
  draftGraph,
  updateNode,
  type WorkflowDraft,
} from '@/components/workflows/definition-draft-model';
import { INITIAL_CREATE_DEFINITION_STATE } from '@/components/workflows/create-definition-state';
import { keyFromLabel, labelOrKey } from '@/lib/names';
import { cn } from '@/lib/utils';

const INPUT =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

const LABEL = 'text-xs font-medium tracking-wide text-on-surface-muted uppercase';

/**
 * CreateWorkflowEditor draws a brand-new process on the canvas (ADR 0019).
 *
 * The designer answers three questions — what the process is called, which data it reads
 * and who receives the first step — and then arranges the steps. Nothing is published
 * until they say so, so version 1 is exactly the process they drew; the checklist beside
 * the canvas says in their words what the service would refuse, and publish stays disabled
 * until it is clean.
 */
export function CreateWorkflowEditor({
  objects,
  knownRoles,
}: {
  objects: readonly BusinessObject[];
  /** The role catalogue: roles at least one person holds, with the name each is shown under. */
  knownRoles: readonly RoleEntry[];
}) {
  const [name, setName] = useState('');
  const [typedKey, setTypedKey] = useState('');
  const [objectKey, setObjectKey] = useState(objects[0]?.key ?? '');
  const [draft, setDraft] = useState<WorkflowDraft>(() => templateDraft());
  const [state, action] = useActionState(
    createProcessDefinitionAction,
    INITIAL_CREATE_DEFINITION_STATE,
  );

  // The process key follows its name until the designer types one of their own (ADR 0018).
  const key = typedKey === '' ? keyFromLabel(name) : typedKey;
  const object = objects.find((candidate) => candidate.key === objectKey);
  // `rows` fields cannot be used in a condition (the service rejects them), so they are not
  // offered to a condition step.
  const conditionFields = (object?.fields ?? []).filter((field) => field.type !== 'rows');

  const problems = preflightProblems(draft);
  const taskKey = firstTaskKey(draft);
  const role = taskKey
    ? (draft.nodes.find((node) => node.key === taskKey)?.assigneeRole ?? '')
    : '';
  const roleKnown = knownRoles.some((entry) => entry.key === role);

  function setRole(next: string) {
    if (taskKey === null) {
      return;
    }
    setDraft((current) => updateNode(current, taskKey, { assigneeRole: next }));
  }

  return (
    <form action={action} className="space-y-8" aria-label="Tạo quy trình mới">
      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="text-lg font-semibold tracking-tight">Quy trình này dùng cho việc gì?</h2>
        <p className="mt-1 text-sm text-on-surface-muted">
          Quy trình đọc dữ liệu của một loại bản ghi, nên chọn loại bản ghi mà nó sẽ xử lý. Loại dữ
          liệu không đổi được sau khi tạo.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Tên quy trình</span>
            <input
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Duyệt đề nghị mua hàng"
              className={cn(INPUT, 'mt-1.5')}
            />
          </label>

          <label className="block">
            <span className={LABEL}>Loại dữ liệu</span>
            <select
              name="objectKey"
              required
              value={objectKey}
              onChange={(event) => setObjectKey(event.target.value)}
              className={cn(INPUT, 'mt-1.5')}
            >
              {objects.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>

          <div className="block">
            <span className={LABEL}>Ai nhận việc ở bước đầu tiên?</span>
            {taskKey === null ? (
              <p className="mt-1.5 text-sm text-on-surface-muted">
                Sơ đồ chưa có bước nào giao cho người — thêm một bước ở dưới, rồi chọn người nhận
                việc.
              </p>
            ) : knownRoles.length > 0 ? (
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className={cn(INPUT, 'mt-1.5')}
              >
                <option value="">— chọn vai trò —</option>
                {knownRoles.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {labelOrKey(entry.label, entry.key)}
                  </option>
                ))}
                {/* A role nobody holds yet, kept representable instead of silently dropped. */}
                {role !== '' && !roleKnown ? <option value={role}>{role}</option> : null}
              </select>
            ) : (
              <>
                <input
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder="truong_bo_phan"
                  className={cn(INPUT, 'mt-1.5')}
                />
                <span className="mt-1 block text-xs text-on-surface-muted">
                  Chưa vai trò nào đang có người giữ. Nhập mã vai trò, và nhờ người quản trị hệ
                  thống gán vai trò đó cho người nhận việc.
                </span>
              </>
            )}
          </div>

          <label className="block">
            <span className={LABEL}>Mô tả (không bắt buộc)</span>
            <input
              name="description"
              placeholder="Trưởng bộ phận duyệt trước; từ 20 triệu giám đốc duyệt."
              className={cn(INPUT, 'mt-1.5')}
            />
          </label>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-on-surface-muted">
            Mã quy trình dùng trong hệ thống
          </summary>
          <input
            name="key"
            value={key}
            onChange={(event) => setTypedKey(event.target.value)}
            placeholder="purchase_approval"
            className={cn(INPUT, 'mt-2 font-mono text-xs')}
          />
          <p className="mt-1 text-xs text-on-surface-muted">
            Tự sinh từ tên quy trình. Sửa được ở đây, nhưng không đổi được sau khi tạo.
          </p>
        </details>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Các bước của quy trình</h2>
        <p className="mt-1 mb-4 text-sm text-on-surface-muted">
          Bắt đầu từ ba bước có sẵn: nhận yêu cầu, duyệt, kết thúc. Kéo một bước để di chuyển, kéo
          chấm tròn bên phải một bước để nối sang bước khác, bấm vào một bước để sửa nội dung.
        </p>

        <GraphCanvas
          draft={draft}
          onDraftChange={setDraft}
          knownRoles={knownRoles}
          conditionFields={conditionFields}
          canvasLabel={name.trim() === '' ? 'quy trình mới' : name.trim()}
          readiness={{
            headline:
              problems.length > 0
                ? `Còn ${problems.length} điểm cần sửa trước khi tạo`
                : 'Quy trình đã sẵn sàng tạo',
            problems,
          }}
        />
      </section>

      <input type="hidden" name="graph" value={JSON.stringify(draftGraph(draft))} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={problems.length > 0}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
        >
          Tạo và phát hành
        </button>
        <button
          type="button"
          onClick={() => setDraft(templateDraft())}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-overlay"
        >
          Vẽ lại từ bản mẫu
        </button>
        <p className="text-xs text-on-surface-muted">
          {problems.length > 0
            ? 'Sửa các điểm ở khung bên cạnh rồi tạo.'
            : 'Tạo xong, quy trình chạy được ngay và bạn vẫn sửa tiếp được: mỗi lần sửa là một phiên bản mới, các lần chạy đang xử lý vẫn giữ phiên bản cũ.'}
        </p>
      </div>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
