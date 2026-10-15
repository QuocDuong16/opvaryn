'use client';

import { useActionState, useCallback, useRef, useState, type PointerEvent } from 'react';
import type { ProcessCondition, RoleEntry } from '@opvaryn/contracts';

import { publishProcessDefinitionAction } from '@/app/(workspace)/workflows/actions';
import { saveWorkflowDraftAction } from '@/app/(workspace)/workflows/actions';
import { labelOrKey, roleLabels as indexRoleLabels } from '@/lib/names';
import {
  NODE_HEIGHT,
  NODE_TYPE_LABELS,
  NODE_WIDTH,
  conditionSummary,
  outgoingEdges,
} from '@/components/workflows/definition-layout';
import {
  DRAFT_NUDGE,
  addNode,
  canvasSize,
  connectNodes,
  draftGraph,
  isDraftChanged,
  moveNode,
  nudgeNode,
  removeEdge,
  removeNode,
  updateNode,
  type DraftNode,
  type WorkflowDraft,
} from '@/components/workflows/definition-draft-model';
import { INITIAL_PUBLISH_DEFINITION_STATE } from '@/components/workflows/publish-definition-state';
import { INITIAL_SAVE_DRAFT_STATE } from '@/components/workflows/save-draft-state';
import { cn } from '@/lib/utils';

const NODE_STROKE: Record<DraftNode['type'], string> = {
  start: 'stroke-success/70',
  human_task: 'stroke-accent-strong/70',
  condition: 'stroke-warning/70',
  end: 'stroke-border-strong',
};

const NODE_TYPES = ['human_task', 'condition', 'start', 'end'] as const;
const CONDITION_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;

const CONTROL =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors ' +
  'hover:bg-surface-overlay disabled:opacity-50';

const INPUT =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/**
 * WorkflowEditor is the drag-and-drop editor for a process graph (ADR 0013).
 *
 * It edits a **draft**: the canvas, the positions and the unconnected half-finished nodes
 * live in this browser only, and the engine never sees them. Publishing is the single
 * write: it assembles the graph from the draft and goes through the same API action as
 * before, so a published version stays immutable and running instances keep their version.
 *
 * A published graph is also a draft (laid out by the same code), which is what makes
 * "discard" mean "go back to what the engine runs" and lets the editor say whether the
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
  /** The role catalogue: the key a node stores, and the name a person reads. */
  knownRoles: readonly RoleEntry[];
  /** Accessible name of the diagram, e.g. "purchase_approval v2". */
  canvasLabel: string;
}) {
  const knownRoleLabels = indexRoleLabels(knownRoles);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(() => initialDraft);
  const [selectedKey, setSelectedKey] = useState<string>(() => initialDraft.nodes[0]?.key ?? '');
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [newType, setNewType] = useState<DraftNode['type']>('human_task');
  const [hint, setHint] = useState<string | null>(null);
  const [saveState, saveAction] = useActionState(saveWorkflowDraftAction, INITIAL_SAVE_DRAFT_STATE);
  const [publishState, publishAction] = useActionState(
    publishProcessDefinitionAction,
    INITIAL_PUBLISH_DEFINITION_STATE,
  );

  const selected = draft.nodes.find((node) => node.key === selectedKey) ?? draft.nodes[0];
  const changed = isDraftChanged(draft, published);
  const size = canvasSize(draft);

  /** toCanvas converts a pointer position into the SVG's own coordinates. */
  const toCanvas = useCallback(
    (event: PointerEvent): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) {
        return { x: 0, y: 0 };
      }
      const rect = svg.getBoundingClientRect();
      const scale = size.width / (rect.width || size.width);
      return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
    },
    [size.width],
  );

  function startDrag(event: PointerEvent, node: DraftNode) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toCanvas(event);
    setSelectedKey(node.key);
    setDragging({ key: node.key, dx: point.x - node.x, dy: point.y - node.y });
    setLinkingFrom(null);
  }

  function continueDrag(event: PointerEvent) {
    const point = toCanvas(event);
    setPointer(point);
    if (dragging) {
      setDraft((current) =>
        moveNode(current, dragging.key, point.x - dragging.dx, point.y - dragging.dy),
      );
    }
  }

  function endDrag() {
    setDragging(null);
    setPointer(null);
  }

  function finishLink(event: PointerEvent, targetKey: string) {
    if (!linkingFrom) {
      return;
    }
    event.stopPropagation();
    const result = connectNodes(draft, linkingFrom, targetKey);
    setDraft(result.draft);
    setHint(result.error);
    setLinkingFrom(null);
  }

  function handleKeyDown(event: React.KeyboardEvent, node: DraftNode) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        setDraft((current) => nudgeNode(current, node.key, -DRAFT_NUDGE, 0));
        break;
      case 'ArrowRight':
        event.preventDefault();
        setDraft((current) => nudgeNode(current, node.key, DRAFT_NUDGE, 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setDraft((current) => nudgeNode(current, node.key, 0, -DRAFT_NUDGE));
        break;
      case 'ArrowDown':
        event.preventDefault();
        setDraft((current) => nudgeNode(current, node.key, 0, DRAFT_NUDGE));
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        setDraft((current) => removeNode(current, node.key));
        setSelectedKey('');
        break;
      default:
        break;
    }
  }

  function handleAdd() {
    const point = {
      x: 40 + (draft.nodes.length % 4) * 40,
      y: 40 + Math.floor(draft.nodes.length / 4) * 90,
    };
    const added = addNode(draft, newType, point.x, point.y);
    if (!added.added) {
      setHint('Bản nháp đã đủ số node.');
      return;
    }
    setDraft(added.draft);
    setSelectedKey(added.key);
    setHint(null);
  }

  // What publishing would send, and what still looks unfinished. The service decides
  // whether the graph is legal; this is only a nudge so a half-built draft is visible.
  const humanTasksWithoutRole = draft.nodes.filter(
    (node) => node.type === 'human_task' && !node.assigneeRole,
  );
  const conditionNodesWithoutField = draft.nodes.filter(
    (node) => node.type === 'condition' && !node.condition?.field,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <label className="text-xs tracking-wide text-on-surface-muted uppercase" htmlFor="add-type">
          Thêm node
        </label>
        <select
          id="add-type"
          value={newType}
          onChange={(event) => setNewType(event.target.value as DraftNode['type'])}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent-strong focus:outline-none"
        >
          {NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {NODE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleAdd} className={CONTROL}>
          Thêm vào canvas
        </button>

        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px]',
            changed ? 'border-warning/40 text-warning' : 'border-success/40 text-success',
          )}
        >
          {changed ? 'Bản nháp khác bản đã publish' : 'Trùng bản đã publish'}
        </span>
        {hasSavedDraft ? (
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-on-surface-muted">
            có bản nháp đã lưu cho trình duyệt này
          </span>
        ) : null}

        <span className="text-xs text-on-surface-muted">
          kéo node để di chuyển · kéo chấm tròn để nối · Delete để xoá
        </span>
      </div>

      {hint ? (
        <p className="rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">{hint}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-surface-raised p-3">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${size.width} ${size.height}`}
              role="application"
              aria-label={`Trình soạn ${canvasLabel}: ${draft.nodes.length} node, ${draft.edges.length} đường chuyển`}
              className="w-full touch-none select-none"
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              onClick={() => {
                setSelectedKey('');
                setLinkingFrom(null);
              }}
            >
              <defs>
                <marker
                  id="draft-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" className="fill-border-strong" />
                </marker>
              </defs>

              {draft.edges.map((edge) => {
                const from = draft.nodes.find((node) => node.key === edge.from);
                const to = draft.nodes.find((node) => node.key === edge.to);
                if (!from || !to) {
                  return null;
                }
                const x1 = from.x + NODE_WIDTH;
                const y1 = from.y + NODE_HEIGHT / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_HEIGHT / 2;
                return (
                  <g
                    key={edge.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Đường chuyển ${edge.from} → ${edge.to}${edge.when ? ` (${edge.when})` : ''}, xoá`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDraft((current) => removeEdge(current, edge.id));
                    }}
                    className="cursor-pointer"
                  >
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      strokeWidth={1.5}
                      markerEnd="url(#draft-arrow)"
                      className="stroke-border-strong"
                    />
                    {edge.when ? (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 6}
                        textAnchor="middle"
                        className="fill-on-surface-muted text-[10px]"
                      >
                        {edge.when === 'true' ? 'đúng' : 'sai'}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {linkingFrom && pointer ? (
                <line
                  x1={(draft.nodes.find((node) => node.key === linkingFrom)?.x ?? 0) + NODE_WIDTH}
                  y1={
                    (draft.nodes.find((node) => node.key === linkingFrom)?.y ?? 0) + NODE_HEIGHT / 2
                  }
                  x2={pointer.x}
                  y2={pointer.y}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  className="stroke-accent-strong"
                />
              ) : null}

              {draft.nodes.map((node) => {
                const isSelected = node.key === selected?.key;
                return (
                  <g key={node.key}>
                    <g
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-label={`${NODE_TYPE_LABELS[node.type]}: ${node.title}`}
                      onPointerDown={(event) => startDrag(event, node)}
                      onPointerUp={(event) => finishLink(event, node.key)}
                      onKeyDown={(event) => handleKeyDown(event, node)}
                      className={cn('cursor-grab', dragging?.key === node.key && 'cursor-grabbing')}
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx={10}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        className={cn(
                          'fill-surface',
                          NODE_STROKE[node.type],
                          isSelected && 'stroke-accent-strong',
                        )}
                      />
                      <text
                        x={node.x + 12}
                        y={node.y + 24}
                        className="fill-on-surface text-[11px] font-medium"
                      >
                        {node.title}
                      </text>
                      <text
                        x={node.x + 12}
                        y={node.y + 41}
                        className="fill-on-surface-muted text-[10px]"
                      >
                        {node.type === 'human_task'
                          ? node.assigneeRole
                            ? labelOrKey(knownRoleLabels.get(node.assigneeRole), node.assigneeRole)
                            : 'chưa gán role'
                          : node.type === 'condition'
                            ? conditionSummary(node.condition)
                            : NODE_TYPE_LABELS[node.type]}
                      </text>
                    </g>
                    <circle
                      cx={node.x + NODE_WIDTH}
                      cy={node.y + NODE_HEIGHT / 2}
                      r={7}
                      role="button"
                      tabIndex={0}
                      aria-label={`Nối từ ${node.title}`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setLinkingFrom(node.key);
                        setPointer(toCanvas(event));
                        setHint(null);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className={cn(
                        'cursor-crosshair fill-surface',
                        linkingFrom === node.key ? 'stroke-accent-strong' : 'stroke-border-strong',
                      )}
                      strokeWidth={2}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

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
                Bỏ nháp, quay về bản đã publish
              </button>
            </form>
            <form action={publishAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="key" value={definitionKey} />
              <input type="hidden" name="name" value={definitionName} />
              <input type="hidden" name="objectKey" value={objectKey} />
              <input type="hidden" name="graph" value={JSON.stringify(draftGraph(draft))} />
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
              >
                Publish phiên bản mới
              </button>
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

          {humanTasksWithoutRole.length > 0 || conditionNodesWithoutField.length > 0 ? (
            <ul className="space-y-1 text-xs text-warning">
              {humanTasksWithoutRole.map((node) => (
                <li
                  key={node.key}
                >{`${node.key}: việc của người chưa gán vai trò — quy trình sẽ dừng ở đây.`}</li>
              ))}
              {conditionNodesWithoutField.map((node) => (
                <li key={node.key}>{`${node.key}: node điều kiện chưa chọn field.`}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <aside className="min-w-0">
          <div className="rounded-xl border border-border bg-surface-raised p-5">
            <p className="font-mono text-[11px] tracking-widest text-on-surface-muted uppercase">
              Node đang chọn
            </p>

            {selected ? (
              <>
                <h3 className="mt-2 text-base font-semibold tracking-tight">{selected.title}</h3>
                <p className="mt-0.5 font-mono text-xs text-on-surface-muted">
                  {selected.key} · {NODE_TYPE_LABELS[selected.type]}
                </p>

                <div className="mt-4 space-y-3">
                  <label className="block text-xs">
                    <span className="font-medium tracking-wide uppercase">Tiêu đề</span>
                    <input
                      value={selected.title}
                      onChange={(event) =>
                        setDraft((current) =>
                          updateNode(current, selected.key, { title: event.target.value }),
                        )
                      }
                      className={cn(INPUT, 'mt-1.5')}
                    />
                  </label>

                  {selected.type === 'human_task' ? (
                    <label className="block text-xs">
                      <span className="font-medium tracking-wide uppercase">Vai trò nhận việc</span>
                      <input
                        value={selected.assigneeRole ?? ''}
                        list="known-roles"
                        onChange={(event) =>
                          setDraft((current) =>
                            updateNode(current, selected.key, {
                              assigneeRole: event.target.value,
                            }),
                          )
                        }
                        className={cn(INPUT, 'mt-1.5 font-mono')}
                      />
                    </label>
                  ) : null}

                  {selected.type === 'condition' ? (
                    <div className="space-y-2">
                      <label className="block text-xs">
                        <span className="font-medium tracking-wide uppercase">Field</span>
                        <input
                          value={selected.condition?.field ?? ''}
                          onChange={(event) =>
                            setDraft((current) =>
                              updateNode(current, selected.key, {
                                condition: {
                                  field: event.target.value,
                                  op: selected.condition?.op ?? 'eq',
                                  value: selected.condition?.value ?? '',
                                } as ProcessCondition,
                              }),
                            )
                          }
                          className={cn(INPUT, 'mt-1.5 font-mono')}
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs">
                          <span className="font-medium tracking-wide uppercase">Toán tử</span>
                          <select
                            value={selected.condition?.op ?? 'eq'}
                            onChange={(event) =>
                              setDraft((current) =>
                                updateNode(current, selected.key, {
                                  condition: {
                                    field: selected.condition?.field ?? '',
                                    op: event.target.value,
                                    value: selected.condition?.value ?? '',
                                  } as ProcessCondition,
                                }),
                              )
                            }
                            className={cn(INPUT, 'mt-1.5 font-mono')}
                          >
                            {CONDITION_OPS.map((op) => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs">
                          <span className="font-medium tracking-wide uppercase">Giá trị</span>
                          <input
                            value={String(selected.condition?.value ?? '')}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const numeric = raw !== '' && Number.isFinite(Number(raw));
                              setDraft((current) =>
                                updateNode(current, selected.key, {
                                  condition: {
                                    field: selected.condition?.field ?? '',
                                    op: selected.condition?.op ?? 'eq',
                                    value: numeric ? Number(raw) : raw,
                                  } as ProcessCondition,
                                }),
                              );
                            }}
                            className={cn(INPUT, 'mt-1.5 font-mono')}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                    Nối tới node khác
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={linkingFrom ?? ''}
                      onChange={(event) => setLinkingFrom(event.target.value || null)}
                      aria-label="Nối từ node"
                      className={cn(INPUT, 'w-auto font-mono')}
                    >
                      <option value="">— chọn node nguồn —</option>
                      {draft.nodes.map((node) => (
                        <option key={node.key} value={node.key}>
                          {node.key}
                        </option>
                      ))}
                    </select>
                    <select
                      value=""
                      onChange={(event) => {
                        if (!linkingFrom || !event.target.value) {
                          return;
                        }
                        const result = connectNodes(draft, linkingFrom, event.target.value);
                        setDraft(result.draft);
                        setHint(result.error);
                        setLinkingFrom(null);
                      }}
                      aria-label="Nối tới node đích"
                      className={cn(INPUT, 'w-auto font-mono')}
                    >
                      <option value="">— nối tới —</option>
                      {draft.nodes
                        .filter((node) => node.key !== linkingFrom)
                        .map((node) => (
                          <option key={node.key} value={node.key}>
                            {node.key}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (linkingFrom) {
                          const result = connectNodes(draft, linkingFrom, selected.key, 'true');
                          setDraft(result.draft);
                          setHint(result.error);
                          setLinkingFrom(null);
                        }
                      }}
                      disabled={!linkingFrom}
                      className={CONTROL}
                    >
                      Nối khi đúng
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (linkingFrom) {
                          const result = connectNodes(draft, linkingFrom, selected.key, 'false');
                          setDraft(result.draft);
                          setHint(result.error);
                          setLinkingFrom(null);
                        }
                      }}
                      disabled={!linkingFrom}
                      className={CONTROL}
                    >
                      Nối khi sai
                    </button>
                  </div>
                </div>

                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-on-surface-muted">Đường chuyển tiếp</dt>
                    <dd className="space-y-1 text-right">
                      {outgoingEdges({ nodes: draft.nodes, edges: draft.edges }, selected.key).map(
                        ({ edge, label }) => (
                          <span
                            key={`${edge.from}-${edge.to}-${label}`}
                            className="block font-mono"
                          >
                            {`${label} → ${edge.to}`}
                          </span>
                        ),
                      )}
                      {outgoingEdges({ nodes: draft.nodes, edges: draft.edges }, selected.key)
                        .length === 0 ? (
                        <span className="text-on-surface-muted">không có</span>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => {
                    setDraft((current) => removeNode(current, selected.key));
                    setSelectedKey('');
                  }}
                  className={cn(CONTROL, 'mt-4 text-danger')}
                >
                  Xoá node này
                </button>
              </>
            ) : (
              <p className="mt-3 text-sm text-on-surface-muted">
                Chưa chọn node nào. Bấm vào một node trên canvas để sửa, hoặc thêm node mới.
              </p>
            )}
          </div>

          <p className="mt-3 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs leading-relaxed text-on-surface-muted">
            Bản nháp chỉ nằm ở trình duyệt này và không ảnh hưởng tới quy trình đang chạy: chỉ khi
            bấm
            <strong> Publish phiên bản mới</strong> graph mới được gửi đi, version đã publish là bất
            biến, và quy trình đang chạy vẫn giữ phiên bản của nó.
          </p>
        </aside>
      </div>

      <datalist id="known-roles">
        {knownRoles.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {labelOrKey(entry.label, entry.key)}
          </option>
        ))}
      </datalist>
    </div>
  );
}
