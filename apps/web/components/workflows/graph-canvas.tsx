'use client';

import { useCallback, useRef, useState, type PointerEvent } from 'react';
import type { FieldDefinition, ProcessCondition, RoleEntry } from '@opvaryn/contracts';

import { labelOrKey, OPERATOR_LABELS, roleLabels as indexRoleLabels } from '@/lib/names';
import { CONDITION_OPS } from '@/components/workflows/definition-draft';
import {
  NODE_HEIGHT,
  NODE_TYPE_LABELS,
  NODE_WIDTH,
  clipTitle,
  conditionSummary,
  outgoingEdges,
} from '@/components/workflows/definition-layout';
import {
  DRAFT_NUDGE,
  addNode,
  canvasSize,
  connectNodes,
  moveNode,
  nudgeNode,
  removeEdge,
  removeNode,
  updateNode,
  type DraftNode,
  type WorkflowDraft,
} from '@/components/workflows/definition-draft-model';
import { cn } from '@/lib/utils';

const NODE_STROKE: Record<DraftNode['type'], string> = {
  start: 'stroke-success/70',
  human_task: 'stroke-accent-strong/70',
  condition: 'stroke-warning/70',
  end: 'stroke-border-strong',
};

/** The step kinds a designer can add, in the order they think of them. */
const NODE_TYPES = ['human_task', 'condition', 'start', 'end'] as const;

const CONTROL =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors ' +
  'hover:bg-surface-overlay disabled:opacity-50';

const INPUT =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/** How a step is named in a list: its title, with the kind after it when two could clash. */
function stepLabel(node: DraftNode): string {
  return `${node.title.trim() || node.key} — ${NODE_TYPE_LABELS[node.type]}`;
}

/**
 * GraphCanvas is the drag-and-drop surface of the process designer (ADR 0013, ADR 0019).
 *
 * It draws and edits a **draft** — the arrangement the designer is working on, which lives
 * in this browser and is not what the engine runs. Publishing is the only write, and the
 * caller owns both the draft and the publish button: this component moves steps, connects
 * them and edits one step at a time, and reports what the checklist still finds wrong.
 */
export function GraphCanvas({
  draft,
  onDraftChange,
  knownRoles,
  conditionFields,
  canvasLabel,
  readiness,
}: {
  draft: WorkflowDraft;
  /** The caller's draft setter; an updater function keeps a fast drag from losing a move. */
  onDraftChange: (update: (current: WorkflowDraft) => WorkflowDraft) => void;
  /** The role catalogue: the key a step stores, and the name a person reads. */
  knownRoles: readonly RoleEntry[];
  /** Fields of the object the process reads; a condition compares one of them. */
  conditionFields: readonly FieldDefinition[];
  /** Accessible name of the diagram, e.g. "Duyệt đề nghị mua hàng v2". */
  canvasLabel: string;
  /**
   * The readiness panel under the inspector: the caller decides what "ready" means
   * (there is nothing to compare a brand-new process against), this only draws it.
   */
  readiness: { headline: string; problems: readonly string[] };
}) {
  const knownRoleLabels = indexRoleLabels(knownRoles);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>(() => draft.nodes[0]?.key ?? '');
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [newType, setNewType] = useState<DraftNode['type']>('human_task');
  const [hint, setHint] = useState<string | null>(null);

  const selected = draft.nodes.find((node) => node.key === selectedKey) ?? draft.nodes[0];
  const size = canvasSize(draft);
  const { headline, problems } = readiness;

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

  // The editor names the things a step mentions: the role it belongs to, the field a
  // condition compares (ADR 0016, ADR 0018).
  const nodeLabels = {
    roles: new Map(knownRoles.map((role) => [role.key, role.label])),
    fields: new Map(conditionFields.map((field) => [field.key, field.label])),
  };

  function startDrag(event: PointerEvent, node: DraftNode) {
    event.stopPropagation();
    // Selecting the step comes first and must not depend on the pointer: capturing can fail
    // (a synthetic or already-released pointer), and a step that cannot be selected is a step
    // that cannot be edited. Dragging is the extra, not the point.
    setSelectedKey(node.key);
    setLinkingFrom(null);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without the capture the step still selects; it just will not follow the pointer.
    }
    const point = toCanvas(event);
    setDragging({ key: node.key, dx: point.x - node.x, dy: point.y - node.y });
  }

  function continueDrag(event: PointerEvent) {
    const point = toCanvas(event);
    setPointer(point);
    if (dragging) {
      onDraftChange((current) =>
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
    onDraftChange(() => result.draft);
    setHint(result.error);
    setLinkingFrom(null);
  }

  function handleKeyDown(event: React.KeyboardEvent, node: DraftNode) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        onDraftChange((current) => nudgeNode(current, node.key, -DRAFT_NUDGE, 0));
        break;
      case 'ArrowRight':
        event.preventDefault();
        onDraftChange((current) => nudgeNode(current, node.key, DRAFT_NUDGE, 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        onDraftChange((current) => nudgeNode(current, node.key, 0, -DRAFT_NUDGE));
        break;
      case 'ArrowDown':
        event.preventDefault();
        onDraftChange((current) => nudgeNode(current, node.key, 0, DRAFT_NUDGE));
        break;
      // A step is a button to assistive technology, so it must be operable as one: Enter or
      // space selects it, and the inspector beside the canvas is then reachable.
      case 'Enter':
      case ' ':
        event.preventDefault();
        setSelectedKey(node.key);
        setLinkingFrom(null);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        onDraftChange((current) => removeNode(current, node.key));
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
      setHint('Bản nháp đã đủ số bước.');
      return;
    }
    onDraftChange(() => added.draft);
    setSelectedKey(added.key);
    setHint(null);
  }

  /** setCondition patches one field of the selected step's condition. */
  function setCondition(key: string, patch: Partial<ProcessCondition>) {
    const node = draft.nodes.find((candidate) => candidate.key === key);
    const current: ProcessCondition = node?.condition ?? { field: '', op: 'eq', value: '' };
    onDraftChange((latest) =>
      updateNode(latest, key, { condition: { ...current, ...patch } as ProcessCondition }),
    );
  }

  // A condition can name a field the object no longer has (the schema moved on since the
  // version that used it). Keeping it in the list means the select never silently drops
  // what the step actually compares.
  const selectedField = selected?.condition?.field ?? '';
  const staleField =
    selectedField !== '' && !conditionFields.some((field) => field.key === selectedField)
      ? selectedField
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <label className="text-xs tracking-wide text-on-surface-muted uppercase" htmlFor="add-type">
          Thêm bước
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
          Thêm vào sơ đồ
        </button>

        <span className="text-xs text-on-surface-muted">
          kéo một bước để di chuyển · kéo chấm tròn để nối · Delete để xoá
        </span>
      </div>

      {hint ? (
        <p className="rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">{hint}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="rounded-xl border border-border bg-surface-raised p-3">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${size.width} ${size.height}`}
              role="application"
              aria-label={`Trình soạn ${canvasLabel}: ${draft.nodes.length} bước, ${draft.edges.length} đường nối`}
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
                    aria-label={`Đường nối ${stepLabel(from)} → ${stepLabel(to)}${
                      edge.when ? ` (nhánh ${edge.when === 'true' ? 'đúng' : 'sai'})` : ''
                    }, xoá`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDraftChange((current) => removeEdge(current, edge.id));
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
                      aria-label={stepLabel(node)}
                      onPointerDown={(event) => startDrag(event, node)}
                      onPointerUp={(event) => finishLink(event, node.key)}
                      // The click must not reach the canvas behind: clicking a step selects it,
                      // and only a click on empty space clears the selection. Without this the
                      // selection was made on pointer-down and cleared again on click, so the
                      // inspector never showed the step a person had just clicked.
                      onClick={(event) => event.stopPropagation()}
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
                        {clipTitle(node.title)}
                      </text>
                      <text
                        x={node.x + 12}
                        y={node.y + 41}
                        className="fill-on-surface-muted text-[10px]"
                      >
                        {node.type === 'human_task'
                          ? node.assigneeRole
                            ? labelOrKey(knownRoleLabels.get(node.assigneeRole), node.assigneeRole)
                            : 'chưa gán vai trò'
                          : node.type === 'condition'
                            ? conditionSummary(node.condition, nodeLabels)
                            : NODE_TYPE_LABELS[node.type]}
                      </text>
                    </g>
                    <circle
                      cx={node.x + NODE_WIDTH}
                      cy={node.y + NODE_HEIGHT / 2}
                      r={7}
                      role="button"
                      tabIndex={0}
                      aria-label={`Nối từ ${stepLabel(node)}`}
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
        </div>

        <aside className="min-w-0 space-y-3">
          <div className="rounded-xl border border-border bg-surface-raised p-5">
            <p className="text-[11px] tracking-wide text-on-surface-muted uppercase">
              Bước đang chọn
            </p>

            {selected ? (
              <>
                <h3 className="mt-2 text-base font-semibold tracking-tight">
                  {selected.title.trim() || selected.key}
                </h3>
                <p className="mt-0.5 text-xs text-on-surface-muted">
                  {NODE_TYPE_LABELS[selected.type]}
                </p>

                <div className="mt-4 space-y-3">
                  <label className="block text-xs">
                    <span className="font-medium tracking-wide uppercase">Tên bước</span>
                    <input
                      value={selected.title}
                      onChange={(event) =>
                        onDraftChange((current) =>
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
                        placeholder="Chọn hoặc nhập mã vai trò"
                        onChange={(event) =>
                          onDraftChange((current) =>
                            updateNode(current, selected.key, {
                              assigneeRole: event.target.value,
                            }),
                          )
                        }
                        className={cn(INPUT, 'mt-1.5')}
                      />
                    </label>
                  ) : null}

                  {selected.type === 'human_task' ? (
                    <>
                      <label className="block text-xs">
                        <span className="font-medium tracking-wide uppercase">
                          Hạn xử lý (giờ làm việc)
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={selected.dueInWorkingHours ?? 0}
                          onChange={(event) =>
                            onDraftChange((current) =>
                              updateNode(current, selected.key, {
                                dueInWorkingHours: Number(event.target.value) || 0,
                              }),
                            )
                          }
                          className={cn(INPUT, 'mt-1.5')}
                        />
                        <span className="mt-1 block text-[11px] text-on-surface-muted">
                          Để 0 nếu bước này không có hạn. Hạn tính theo giờ làm việc của tổ chức.
                        </span>
                      </label>

                      <label className="block text-xs">
                        <span className="font-medium tracking-wide uppercase">
                          Chuyển cấp khi quá hạn cho
                        </span>
                        <input
                          value={selected.escalateToRole ?? ''}
                          list="known-roles"
                          placeholder="Để trống nếu không chuyển cấp"
                          onChange={(event) =>
                            onDraftChange((current) =>
                              updateNode(current, selected.key, {
                                escalateToRole: event.target.value,
                              }),
                            )
                          }
                          className={cn(INPUT, 'mt-1.5')}
                        />
                        <span className="mt-1 block text-[11px] text-on-surface-muted">
                          Khi quá hạn, việc chuyển sang vai trò này. Để trống thì hệ thống chỉ báo
                          quá hạn, không đổi người.
                        </span>
                      </label>
                    </>
                  ) : null}

                  {selected.type === 'condition' ? (
                    <div className="space-y-2">
                      <label className="block text-xs">
                        <span className="font-medium tracking-wide uppercase">Trường dữ liệu</span>
                        <select
                          value={selected.condition?.field ?? ''}
                          onChange={(event) =>
                            setCondition(selected.key, { field: event.target.value })
                          }
                          className={cn(INPUT, 'mt-1.5')}
                        >
                          <option value="">— chọn trường —</option>
                          {conditionFields.map((field) => (
                            <option key={field.key} value={field.key}>
                              {`${field.label} (${field.key})`}
                            </option>
                          ))}
                          {staleField ? <option value={staleField}>{staleField}</option> : null}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs">
                          <span className="font-medium tracking-wide uppercase">So sánh</span>
                          <select
                            value={selected.condition?.op ?? 'eq'}
                            onChange={(event) =>
                              setCondition(selected.key, {
                                op: event.target.value as ProcessCondition['op'],
                              })
                            }
                            className={cn(INPUT, 'mt-1.5')}
                          >
                            {CONDITION_OPS.map((op) => (
                              <option key={op} value={op}>
                                {OPERATOR_LABELS[op] ?? op}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs">
                          <span className="font-medium tracking-wide uppercase">Với giá trị</span>
                          <input
                            value={String(selected.condition?.value ?? '')}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const numeric = raw !== '' && Number.isFinite(Number(raw));
                              setCondition(selected.key, {
                                value: numeric ? Number(raw) : raw,
                              });
                            }}
                            className={cn(INPUT, 'mt-1.5')}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                    Nối tới bước khác
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={linkingFrom ?? ''}
                      onChange={(event) => setLinkingFrom(event.target.value || null)}
                      aria-label="Nối từ bước"
                      className={cn(INPUT, 'w-auto')}
                    >
                      <option value="">— từ bước —</option>
                      {draft.nodes.map((node) => (
                        <option key={node.key} value={node.key}>
                          {stepLabel(node)}
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
                        onDraftChange(() => result.draft);
                        setHint(result.error);
                        setLinkingFrom(null);
                      }}
                      aria-label="Nối tới bước đích"
                      className={cn(INPUT, 'w-auto')}
                    >
                      <option value="">— nối tới —</option>
                      {draft.nodes
                        .filter((node) => node.key !== linkingFrom)
                        .map((node) => (
                          <option key={node.key} value={node.key}>
                            {stepLabel(node)}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (linkingFrom) {
                          const result = connectNodes(draft, linkingFrom, selected.key, 'true');
                          onDraftChange(() => result.draft);
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
                          onDraftChange(() => result.draft);
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
                    <dt className="text-on-surface-muted">Đi tiếp tới</dt>
                    <dd className="space-y-1 text-right">
                      {outgoingEdges({ nodes: draft.nodes, edges: draft.edges }, selected.key).map(
                        ({ edge, label }) => {
                          const target = draft.nodes.find((node) => node.key === edge.to);
                          return (
                            <span key={`${edge.from}-${edge.to}-${label}`} className="block">
                              {`${label === 'luôn' ? 'luôn' : label === 'true' ? 'khi đúng' : 'khi sai'} → ${
                                target ? stepLabel(target) : edge.to
                              }`}
                            </span>
                          );
                        },
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
                    onDraftChange((current) => removeNode(current, selected.key));
                    setSelectedKey('');
                  }}
                  className={cn(CONTROL, 'mt-4 text-danger')}
                >
                  Xoá bước này
                </button>
              </>
            ) : (
              <p className="mt-3 text-sm text-on-surface-muted">
                Chưa chọn bước nào. Bấm vào một bước trên sơ đồ để sửa, hoặc thêm bước mới.
              </p>
            )}
          </div>

          <div
            className={cn(
              'rounded-xl border px-4 py-3 text-xs leading-relaxed',
              problems.length > 0 ? 'border-warning/40' : 'border-success/40',
            )}
          >
            <p className={cn('font-medium', problems.length > 0 ? 'text-warning' : 'text-success')}>
              {headline}
            </p>
            {problems.length > 0 ? (
              <ul className="mt-2 space-y-1 text-on-surface-muted">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
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
