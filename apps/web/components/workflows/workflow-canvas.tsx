'use client';

import { useState } from 'react';

import {
  NODE_TYPE_LABELS,
  type WorkflowDefinitionDemo,
  type WorkflowNodeType,
} from '@/components/workflows/demo-definitions';
import { cn } from '@/lib/utils';

const NODE_WIDTH = 158;
const NODE_HEIGHT = 58;
const DIAGRAM_PADDING = 24;

const NODE_STROKE: Record<WorkflowNodeType, string> = {
  start: 'stroke-success/70',
  approval: 'stroke-accent-strong/70',
  condition: 'stroke-warning/70',
  notification: 'stroke-border-strong',
  end: 'stroke-border-strong',
};

/**
 * WorkflowCanvas draws the demo process definitions. It is read-only on purpose:
 * nodes can be inspected but not edited or run, because the execution contract
 * (playbook D05/D08) is still open.
 */
export function WorkflowCanvas({
  definitions,
}: {
  definitions: readonly WorkflowDefinitionDemo[];
}) {
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? '');
  const [selectedNodeIds, setSelectedNodeIds] = useState<Record<string, string>>({});

  const definition = definitions.find((item) => item.id === definitionId) ?? definitions[0];
  if (!definition) {
    return null;
  }

  const selectedNode =
    definition.nodes.find((node) => node.id === selectedNodeIds[definition.id]) ??
    definition.nodes[0];
  if (!selectedNode) {
    return null;
  }

  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  const width = Math.max(...definition.nodes.map((node) => node.x)) + NODE_WIDTH + DIAGRAM_PADDING;
  const height =
    Math.max(...definition.nodes.map((node) => node.y)) + NODE_HEIGHT + DIAGRAM_PADDING;

  function selectNode(nodeId: string) {
    setSelectedNodeIds((current) => ({ ...current, [definition.id]: nodeId }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {definitions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDefinitionId(item.id)}
              aria-pressed={item.id === definition.id}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                item.id === definition.id
                  ? 'border-accent-strong/50 bg-accent/10 text-on-surface'
                  : 'border-border text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
              )}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Sơ đồ quy trình ${definition.name} (mô phỏng, không thực thi)`}
            className="w-full"
          >
            <defs>
              <marker
                id="workflow-arrow"
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

            {definition.edges.map((edge, index) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) {
                return null;
              }
              const x1 = from.x + NODE_WIDTH;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_HEIGHT / 2;
              const labelX = (x1 + x2) / 2;
              const labelY = (y1 + y2) / 2 - 6;

              return (
                <g key={`${edge.from}-${edge.to}-${index}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    strokeWidth={1.5}
                    markerEnd="url(#workflow-arrow)"
                    className="stroke-border-strong"
                  />
                  {edge.label ? (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      className="fill-on-surface-muted text-[10px]"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {definition.nodes.map((node) => {
              const selected = node.id === selectedNode.id;
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${NODE_TYPE_LABELS[node.type]}: ${node.title}`}
                  onClick={() => selectNode(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectNode(node.id);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={10}
                    strokeWidth={selected ? 2.5 : 1.5}
                    className={cn(
                      'fill-surface',
                      NODE_STROKE[node.type],
                      selected && 'stroke-accent-strong',
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
                    {node.subtitle}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ol className="flex flex-wrap gap-1.5">
            {definition.nodes.map((node, index) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => selectNode(node.id)}
                  aria-pressed={node.id === selectedNode.id}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-xs transition-colors',
                    node.id === selectedNode.id
                      ? 'border-accent-strong/50 bg-accent/10'
                      : 'border-border text-on-surface-muted hover:bg-surface-overlay',
                  )}
                >
                  <span className="mr-1.5 font-mono text-[10px] text-on-surface-muted">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {node.title}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-on-surface-muted">
          {(Object.keys(NODE_TYPE_LABELS) as WorkflowNodeType[]).map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('size-2.5 rounded-full border-2 bg-surface', NODE_STROKE[type])}
              />
              {NODE_TYPE_LABELS[type]}
            </span>
          ))}
        </div>
      </div>

      <aside className="min-w-0">
        <div className="rounded-xl border border-border bg-surface-raised p-5">
          <p className="font-mono text-[11px] tracking-widest text-on-surface-muted uppercase">
            Node đang chọn
          </p>
          <h3 className="mt-2 text-base font-semibold tracking-tight">{selectedNode.title}</h3>
          <p className="mt-0.5 font-mono text-xs text-on-surface-muted">
            {selectedNode.id} · {NODE_TYPE_LABELS[selectedNode.type]}
          </p>

          <dl className="mt-4 space-y-3">
            {selectedNode.config.map((row) => (
              <div key={row.label}>
                <dt className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                  {row.label}
                </dt>
                <dd className="mt-0.5 text-sm">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 border-t border-border pt-4">
            <p className="font-mono text-[11px] tracking-widest text-on-surface-muted uppercase">
              Definition
            </p>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-muted">Business object</dt>
                <dd className="font-mono text-xs">{definition.businessObject}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-muted">Version đã publish</dt>
                <dd className="font-mono text-xs">{definition.publishedVersion}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-muted">Bản nháp</dt>
                <dd className="font-mono text-xs">{definition.draftVersion}</dd>
              </div>
            </dl>
          </div>

          <p className="mt-5 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs leading-relaxed text-on-surface-muted">
            Chỉ xem: kéo thả node, sửa rule và publish version cần runtime cùng Process Execution
            Contract (D05/D08). Instance gắn version đã publish, không tự chuyển version.
          </p>
        </div>
      </aside>
    </div>
  );
}
