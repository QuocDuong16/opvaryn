'use client';

import { useState } from 'react';
import type { ProcessNode } from '@opvaryn/contracts';

import {
  NODE_HEIGHT,
  NODE_TYPE_LABELS,
  NODE_WIDTH,
  clipTitle,
  conditionSummary,
  layoutGraph,
  nodeSubtitle,
  outgoingEdges,
  type ProcessGraph,
} from '@/components/workflows/definition-layout';
import { labelOrKey } from '@/lib/names';
import { cn } from '@/lib/utils';

const NODE_STROKE: Record<ProcessNode['type'], string> = {
  start: 'stroke-success/70',
  human_task: 'stroke-accent-strong/70',
  condition: 'stroke-warning/70',
  end: 'stroke-border-strong',
};

/**
 * ProcessCanvas draws a published process definition. Coordinates are computed from
 * the graph (definition-layout), not stored, so the canvas shows what the engine
 * will actually run: the version selector is the page's, and a node can be inspected
 * but not dragged — editing is a form that publishes a new version, because a
 * published version is immutable (ADR 0006/0007).
 */
export function ProcessCanvas({
  graph,
  version,
  label,
  roleLabels = {},
  fieldLabels = {},
}: {
  graph: ProcessGraph;
  version: number;
  /** What this graph is, e.g. "purchase_approval v2". */
  label: string;
  /** Role key to display name; a role nobody has named keeps its key. */
  roleLabels?: Record<string, string>;
  /** Field key to display name; a condition reads the name, not the key. */
  fieldLabels?: Record<string, string>;
}) {
  const layout = layoutGraph(graph);
  // The canvas names the things a step mentions: the role it belongs to, the field a
  // condition compares (ADR 0016, ADR 0018).
  const nodeLabels = {
    roles: new Map(Object.entries(roleLabels)),
    fields: new Map(Object.entries(fieldLabels)),
  };
  const [selectedKey, setSelectedKey] = useState(graph.nodes[0]?.key ?? '');
  const selected = layout.nodes.find((item) => item.node.key === selectedKey) ?? layout.nodes[0];

  if (!selected) {
    return null;
  }

  const positionByKey = new Map(layout.nodes.map((item) => [item.node.key, item]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-border bg-surface-raised p-3">
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={`Sơ đồ ${label}: ${graph.nodes.length} bước, ${graph.edges.length} đường nối`}
            className="w-full"
          >
            <defs>
              <marker
                id="process-arrow"
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

            {graph.edges.map((edge, index) => {
              const from = positionByKey.get(edge.from);
              const to = positionByKey.get(edge.to);
              if (!from || !to) {
                return null;
              }
              const x1 = from.x + NODE_WIDTH;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_HEIGHT / 2;

              return (
                <g key={`${edge.from}-${edge.to}-${index}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    strokeWidth={1.5}
                    markerEnd="url(#process-arrow)"
                    className="stroke-border-strong"
                  />
                  {edge.when !== undefined ? (
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

            {layout.nodes.map(({ node, x, y }) => {
              const isSelected = node.key === selected.node.key;
              return (
                <g
                  key={node.key}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${NODE_TYPE_LABELS[node.type]}: ${node.title}`}
                  onClick={() => setSelectedKey(node.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedKey(node.key);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={x}
                    y={y}
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
                  <text x={x + 12} y={y + 24} className="fill-on-surface text-[11px] font-medium">
                    {clipTitle(node.title)}
                  </text>
                  <text x={x + 12} y={y + 41} className="fill-on-surface-muted text-[10px]">
                    {nodeSubtitle(node, nodeLabels)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ol className="flex flex-wrap gap-1.5">
            {layout.nodes.map(({ node }, index) => (
              <li key={node.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(node.key)}
                  aria-pressed={node.key === selected.node.key}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-xs transition-colors',
                    node.key === selected.node.key
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
          {(Object.keys(NODE_TYPE_LABELS) as ProcessNode['type'][]).map((type) => (
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
          <p className="text-[11px] tracking-widest text-on-surface-muted uppercase">
            Bước đang chọn
          </p>
          <h3 className="mt-2 text-base font-semibold tracking-tight">{selected.node.title}</h3>
          <p className="mt-0.5 text-xs text-on-surface-muted">
            {NODE_TYPE_LABELS[selected.node.type]}
          </p>

          <dl className="mt-4 space-y-3">
            {selected.node.type === 'human_task' ? (
              <div>
                <dt className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                  Role nhận việc
                </dt>
                <dd className="mt-0.5 font-mono text-sm">
                  {selected.node.assigneeRole
                    ? labelOrKey(roleLabels[selected.node.assigneeRole], selected.node.assigneeRole)
                    : '— chưa gán'}
                </dd>
              </div>
            ) : null}
            {selected.node.type === 'condition' ? (
              <div>
                <dt className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                  Điều kiện
                </dt>
                <dd className="mt-0.5 font-mono text-sm">
                  {conditionSummary(selected.node.condition, nodeLabels)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[11px] tracking-wide text-on-surface-muted uppercase">
                Đi tiếp tới
              </dt>
              <dd className="mt-1 space-y-1">
                {outgoingEdges(graph, selected.node.key).map(({ edge, label: branch }) => {
                  const target = graph.nodes.find((node) => node.key === edge.to);
                  return (
                    <p key={`${edge.from}-${edge.to}-${branch}`} className="text-sm">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-on-surface-muted">
                        {branch === 'luôn' ? 'luôn' : branch === 'true' ? 'khi đúng' : 'khi sai'}
                      </span>
                      <span className="ml-2">
                        {target ? target.title : edge.to}
                        <span className="text-on-surface-muted">
                          {` · ${target ? NODE_TYPE_LABELS[target.type] : ''}`}
                        </span>
                      </span>
                    </p>
                  );
                })}
                {outgoingEdges(graph, selected.node.key).length === 0 ? (
                  <span className="text-sm text-on-surface-muted">
                    Không nối đi đâu (bước kết thúc)
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[11px] tracking-widest text-on-surface-muted uppercase">
              Phiên bản đang xem
            </p>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-muted">Quy trình</dt>
                <dd className="text-right">{label}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-muted">Phiên bản</dt>
                <dd>{`v${version}`}</dd>
              </div>
            </dl>
          </div>

          <p className="mt-5 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs leading-relaxed text-on-surface-muted">
            Sơ đồ này chỉ để xem: phiên bản đã phát hành là bất biến, và các lần chạy đang xử lý vẫn
            giữ phiên bản của chúng.
          </p>
        </div>
      </aside>
    </div>
  );
}
