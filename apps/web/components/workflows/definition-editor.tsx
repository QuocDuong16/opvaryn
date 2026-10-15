'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type {
  BusinessObject,
  ProcessCondition,
  ProcessDefinition,
  RoleEntry,
} from '@opvaryn/contracts';

import {
  createProcessDefinitionAction,
  publishProcessDefinitionAction,
} from '@/app/(workspace)/workflows/actions';
import { labelOrKey } from '@/lib/names';
import {
  CONDITION_OPS,
  NODE_TYPE_OPTIONS,
  blankEdgeDraft,
  blankNodeDraft,
  edgesToDrafts,
  nodesToDrafts,
  serializeGraph,
  type EdgeDraft,
  type NodeDraft,
} from '@/components/workflows/definition-draft';
import { INITIAL_CREATE_DEFINITION_STATE } from '@/components/workflows/create-definition-state';
import { INITIAL_PUBLISH_DEFINITION_STATE } from '@/components/workflows/publish-definition-state';
import { cn } from '@/lib/utils';

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

const CONTROL_BUTTON =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors ' +
  'hover:bg-surface-overlay disabled:opacity-50';

interface GraphEditorProps {
  /** Business objects a definition can bind to; the first is selected by default. */
  objects: readonly BusinessObject[];
  /** Roles already used by a definition, offered as suggestions. */
  /** The role catalogue: the key a node stores, and the name a person reads. */
  knownRoles: readonly RoleEntry[];
  definition?: ProcessDefinition;
}

/**
 * GraphEditor edits a process graph as rows: one per node, one per edge. It is the
 * same shape of editor as the business object builder — a form, not a drag canvas —
 * because a published version is immutable and publishing is the only write. The
 * hidden `graph` input carries the assembled nodes and edges; the Go service decides
 * whether the graph is valid and what is wrong with it.
 */
function GraphEditor({ objects, knownRoles, definition }: GraphEditorProps) {
  const [nodes, setNodes] = useState<NodeDraft[]>(() =>
    definition ? nodesToDrafts(definition.nodes) : [blankNodeDraft(), blankNodeDraft()],
  );
  const [edges, setEdges] = useState<EdgeDraft[]>(() =>
    definition ? edgesToDrafts(definition.edges) : [blankEdgeDraft()],
  );
  const [objectKey, setObjectKey] = useState(definition?.objectKey ?? objects[0]?.key ?? '');

  const [createState, createAction] = useActionState(
    createProcessDefinitionAction,
    INITIAL_CREATE_DEFINITION_STATE,
  );
  const [publishState, publishAction] = useActionState(
    publishProcessDefinitionAction,
    INITIAL_PUBLISH_DEFINITION_STATE,
  );
  const state = definition === undefined ? createState : publishState;

  const selectedObject = objects.find((object) => object.key === objectKey);
  // `rows` fields cannot be used in a condition (the service rejects them), so they
  // are not offered here; everything else is.
  const conditionFields = (selectedObject?.fields ?? []).filter((field) => field.type !== 'rows');

  function updateNode(index: number, patch: Partial<NodeDraft>) {
    setNodes((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  }

  function updateEdge(index: number, patch: Partial<EdgeDraft>) {
    setEdges((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  }

  return (
    <form
      key={state.status === 'success' ? 'saved' : 'editing'}
      action={definition === undefined ? createAction : publishAction}
      className="space-y-4"
      aria-label={definition ? `Publish phiên bản mới cho ${definition.key}` : 'Tạo quy trình mới'}
    >
      {definition ? (
        <>
          <input type="hidden" name="key" value={definition.key} />
          <input type="hidden" name="objectKey" value={objectKey} />
        </>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {definition === undefined ? (
          <label className="text-xs">
            <span className="font-medium tracking-wide uppercase">Mã quy trình</span>
            <input
              name="key"
              required
              placeholder="purchase_approval"
              className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}
            />
          </label>
        ) : null}
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Tên quy trình</span>
          <input
            name="name"
            required
            defaultValue={definition?.name}
            placeholder="Duyệt đề nghị mua hàng"
            className={cn(INPUT_CLASS, 'mt-1.5')}
          />
        </label>
        {definition === undefined ? (
          <label className="text-xs">
            <span className="font-medium tracking-wide uppercase">Loại dữ liệu</span>
            <select
              name="objectKey"
              value={objectKey}
              onChange={(event) => setObjectKey(event.target.value)}
              className={cn(INPUT_CLASS, 'mt-1.5')}
            >
              {objects.map((object) => (
                <option key={object.key} value={object.key}>
                  {object.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="self-end text-xs text-on-surface-muted">
            Quy trình này đọc dữ liệu của một loại bản ghi đã chọn và không đổi được sau khi tạo.
          </p>
        )}
      </div>

      <label className="block text-xs">
        <span className="font-medium tracking-wide uppercase">Mô tả</span>
        <input
          name="description"
          defaultValue={definition?.description}
          placeholder="Trưởng bộ phận duyệt trước; từ 20 triệu giám đốc duyệt."
          className={cn(INPUT_CLASS, 'mt-1.5')}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium tracking-wide uppercase">
          Các bước ({nodes.length})
        </legend>
        {nodes.map((draft, index) => (
          <div
            key={`node-${index}`}
            className="grid gap-2 rounded-lg border border-border bg-surface-raised/40 p-2 sm:grid-cols-[7rem_9rem_1fr]"
          >
            <input
              value={draft.key}
              onChange={(event) => updateNode(index, { key: event.target.value })}
              placeholder="approve"
              aria-label={`Mã bước ${index + 1}`}
              className={cn(INPUT_CLASS, 'font-mono')}
            />
            <select
              value={draft.type}
              onChange={(event) =>
                updateNode(index, { type: event.target.value as NodeDraft['type'] })
              }
              aria-label={`Loại bước ${index + 1}`}
              className={INPUT_CLASS}
            >
              {NODE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              value={draft.title}
              onChange={(event) => updateNode(index, { title: event.target.value })}
              placeholder="Trưởng bộ phận duyệt"
              aria-label={`Tên bước ${index + 1}`}
              className={INPUT_CLASS}
            />

            {draft.type === 'human_task' ? (
              <label className="text-[11px] text-on-surface-muted sm:col-span-3">
                Vai trò nhận việc
                <input
                  value={draft.assigneeRole}
                  onChange={(event) => updateNode(index, { assigneeRole: event.target.value })}
                  list="known-roles"
                  placeholder="truong_bo_phan"
                  className={cn(INPUT_CLASS, 'mt-1 font-mono')}
                />
              </label>
            ) : null}

            {draft.type === 'condition' ? (
              <div className="grid gap-2 sm:col-span-3 sm:grid-cols-[1fr_6rem_1fr]">
                <label className="text-[11px] text-on-surface-muted">
                  Field
                  <select
                    value={draft.conditionField}
                    onChange={(event) => updateNode(index, { conditionField: event.target.value })}
                    className={cn(INPUT_CLASS, 'mt-1 font-mono')}
                  >
                    <option value="">— chọn field —</option>
                    {conditionFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {`${field.label} (${field.key})`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-on-surface-muted">
                  Toán tử
                  <select
                    value={draft.conditionOp}
                    onChange={(event) =>
                      updateNode(index, {
                        conditionOp: event.target.value as ProcessCondition['op'],
                      })
                    }
                    className={cn(INPUT_CLASS, 'mt-1 font-mono')}
                  >
                    {CONDITION_OPS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-on-surface-muted">
                  Giá trị
                  <input
                    value={draft.conditionValue}
                    onChange={(event) => updateNode(index, { conditionValue: event.target.value })}
                    placeholder="20000000"
                    className={cn(INPUT_CLASS, 'mt-1 font-mono')}
                  />
                </label>
              </div>
            ) : null}

            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() => setNodes((current) => current.filter((_, i) => i !== index))}
                disabled={nodes.length <= 1}
                className={cn(CONTROL_BUTTON, 'text-danger')}
              >
                Xoá bước
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setNodes((current) => [...current, blankNodeDraft()])}
          className={CONTROL_BUTTON}
        >
          Thêm bước
        </button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium tracking-wide uppercase">
          Đường chuyển ({edges.length})
        </legend>
        {edges.map((draft, index) => (
          <div
            key={`edge-${index}`}
            className="grid gap-2 rounded-lg border border-border bg-surface-raised/40 p-2 sm:grid-cols-[1fr_1fr_8rem_auto]"
          >
            <input
              value={draft.from}
              onChange={(event) => updateEdge(index, { from: event.target.value })}
              placeholder="từ bước"
              aria-label={`Node nguồn của đường chuyển ${index + 1}`}
              className={cn(INPUT_CLASS, 'font-mono')}
            />
            <input
              value={draft.to}
              onChange={(event) => updateEdge(index, { to: event.target.value })}
              placeholder="đến bước"
              aria-label={`Node đích của đường chuyển ${index + 1}`}
              className={cn(INPUT_CLASS, 'font-mono')}
            />
            <select
              value={draft.when}
              onChange={(event) =>
                updateEdge(index, { when: event.target.value as EdgeDraft['when'] })
              }
              aria-label={`Nhánh của đường chuyển ${index + 1}`}
              className={INPUT_CLASS}
            >
              <option value="">luôn</option>
              <option value="true">when true</option>
              <option value="false">when false</option>
            </select>
            <button
              type="button"
              onClick={() => setEdges((current) => current.filter((_, i) => i !== index))}
              disabled={edges.length <= 1}
              className={cn(CONTROL_BUTTON, 'text-danger')}
            >
              Xoá
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setEdges((current) => [...current, blankEdgeDraft()])}
          className={CONTROL_BUTTON}
        >
          Thêm đường nối
        </button>
      </fieldset>

      <input
        type="hidden"
        name="graph"
        value={serializeGraph({ nodes, edges }, selectedObject?.fields ?? [])}
      />

      <datalist id="known-roles">
        {knownRoles.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {labelOrKey(entry.label, entry.key)}
          </option>
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label={definition === undefined ? 'Tạo và phát hành' : 'Phát hành phiên bản mới'}
        />
        {definition === undefined ? (
          <p className="text-xs text-on-surface-muted">
            Trước khi lưu, hệ thống kiểm tra: có đúng một điểm bắt đầu, ít nhất một việc giao cho
            người và một điểm kết thúc, và không có vòng lặp — chỗ nào thiếu sẽ được nói rõ.
          </p>
        ) : null}
      </div>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang gửi…' : label}
    </button>
  );
}

/** CreateDefinitionForm publishes version 1 of a new definition. */
export function CreateDefinitionForm(props: GraphEditorProps) {
  return <GraphEditor {...props} />;
}

/** PublishDefinitionForm publishes the next version of an existing definition. */
export function PublishDefinitionForm(props: GraphEditorProps & { definition: ProcessDefinition }) {
  return <GraphEditor {...props} />;
}
