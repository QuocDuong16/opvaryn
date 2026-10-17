'use client';

import { useActionState, useState } from 'react';
import type { FieldDefinition, RoleEntry } from '@opvaryn/contracts';

import {
  publishProcessDefinitionAction,
  saveWorkflowDraftAction,
} from '@/app/(workspace)/workflows/actions';
import { GraphCanvas } from '@/components/workflows/graph-canvas';
import { preflightProblems } from '@/components/workflows/definition-preflight';
import {
  draftGraph,
  isDraftChanged,
  type WorkflowDraft,
} from '@/components/workflows/definition-draft-model';
import { INITIAL_PUBLISH_DEFINITION_STATE } from '@/components/workflows/publish-definition-state';
import { INITIAL_SAVE_DRAFT_STATE } from '@/components/workflows/save-draft-state';
import { cn } from '@/lib/utils';

const CONTROL =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors ' +
  'hover:bg-surface-overlay disabled:opacity-50';

/**
 * WorkflowEditor publishes the next version of a process definition (ADR 0013, ADR 0019).
 *
 * It edits a **draft**: the canvas, the positions and the unconnected half-finished steps
 * live in this browser only, and the engine never sees them. Publishing is the single
 * write, so a published version stays immutable and running instances keep their version.
 *
 * A published graph is also a draft (laid out by the same code), which is what makes
 * "bỏ nháp" mean "go back to what the engine runs" and lets the editor say whether the
 * draft differs from it.
 */
export function WorkflowEditor({
  definitionKey,
  definitionName,
  objectKey,
  published,
  initialDraft,
  hasSavedDraft,
  knownRoles,
  conditionFields,
  canvasLabel,
}: {
  definitionKey: string;
  definitionName: string;
  objectKey: string;
  /** The newest published graph, as a draft: the thing publishing would replace. */
  published: WorkflowDraft;
  /** The saved draft when one exists, otherwise the published graph. */
  initialDraft: WorkflowDraft;
  hasSavedDraft: boolean;
  /** The role catalogue: the key a step stores, and the name a person reads. */
  knownRoles: readonly RoleEntry[];
  /** Fields of the object this process reads, offered to condition steps. */
  conditionFields: readonly FieldDefinition[];
  /** Accessible name of the diagram, e.g. "Duyệt đề nghị mua hàng v2". */
  canvasLabel: string;
}) {
  const [draft, setDraft] = useState<WorkflowDraft>(() => initialDraft);
  const [saveState, saveAction] = useActionState(saveWorkflowDraftAction, INITIAL_SAVE_DRAFT_STATE);
  const [publishState, publishAction] = useActionState(
    publishProcessDefinitionAction,
    INITIAL_PUBLISH_DEFINITION_STATE,
  );

  const changed = isDraftChanged(draft, published);
  const problems = preflightProblems(draft);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px]',
            changed ? 'border-warning/40 text-warning' : 'border-success/40 text-success',
          )}
        >
          {changed ? 'Có thay đổi chưa phát hành' : 'Đang trùng bản đã phát hành'}
        </span>
        {hasSavedDraft ? (
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-on-surface-muted">
            có bản nháp đã lưu cho trình duyệt này
          </span>
        ) : null}
      </div>

      <GraphCanvas
        draft={draft}
        onDraftChange={setDraft}
        knownRoles={knownRoles}
        conditionFields={conditionFields}
        canvasLabel={canvasLabel}
        readiness={{
          headline:
            problems.length > 0
              ? `Còn ${problems.length} điểm cần sửa trước khi phát hành`
              : changed
                ? 'Sơ đồ đã sẵn sàng phát hành'
                : 'Sơ đồ đang trùng bản đã phát hành',
          problems,
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <form action={saveAction}>
          <input type="hidden" name="key" value={definitionKey} />
          <input type="hidden" name="draft" value={JSON.stringify(draft)} />
          <button type="submit" className={CONTROL}>
            Lưu nháp
          </button>
        </form>
        <form action={saveAction}>
          <input type="hidden" name="key" value={definitionKey} />
          <input type="hidden" name="draft" value="discard" />
          <button type="submit" className={CONTROL}>
            Bỏ nháp, quay về bản đã phát hành
          </button>
        </form>
        <form action={publishAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="key" value={definitionKey} />
          <input type="hidden" name="name" value={definitionName} />
          <input type="hidden" name="objectKey" value={objectKey} />
          <input type="hidden" name="graph" value={JSON.stringify(draftGraph(draft))} />
          <button
            type="submit"
            disabled={problems.length > 0}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
          >
            Phát hành phiên bản mới
          </button>
          {problems.length > 0 ? (
            <span className="text-xs text-on-surface-muted">
              Sửa các điểm ở khung bên cạnh rồi phát hành.
            </span>
          ) : null}
        </form>
      </div>

      {saveState.status === 'error' && saveState.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {saveState.message}
        </p>
      ) : null}
      {saveState.status === 'saved' && saveState.message ? (
        <p
          role="status"
          className="rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
        >
          {saveState.message}
        </p>
      ) : null}
      {publishState.status === 'error' && publishState.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {publishState.message}
        </p>
      ) : null}
      {publishState.status === 'success' && publishState.message ? (
        <p
          role="status"
          className="rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
        >
          {publishState.message}
        </p>
      ) : null}
    </div>
  );
}
