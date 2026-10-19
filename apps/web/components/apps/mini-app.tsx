'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { BusinessObject, ObjectRecord } from '@opvaryn/contracts';

import { StatusBadge, type StatusKind } from '@/components/ui/status-badge';
import { formatFieldValue, formatTimestamp, primaryFieldValue } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MiniAppData {
  object: BusinessObject;
  records: readonly ObjectRecord[];
}

type ViewKind = 'list' | 'detail' | 'kanban' | 'config' | 'integration';

const VIEWS: readonly { kind: ViewKind; label: string; stage: StatusKind }[] = [
  { kind: 'list', label: 'Danh sách', stage: 'live' },
  { kind: 'detail', label: 'Chi tiết', stage: 'live' },
  { kind: 'kanban', label: 'Kanban', stage: 'mock' },
  { kind: 'config', label: 'Cấu hình', stage: 'concept' },
  { kind: 'integration', label: 'Tích hợp', stage: 'mock' },
];

const MOCK_CONNECTORS: readonly {
  name: string;
  direction: string;
  detail: string;
}[] = [
  {
    name: 'Danh mục nhà cung cấp',
    direction: 'Lookup khi nhập form',
    detail: 'Tra cứu mã và tên nhà cung cấp từ hệ thống kế toán.',
  },
  {
    name: 'ERP tồn kho',
    direction: 'Event → khởi tạo quy trình',
    detail: 'Cảnh báo lệch số lượng sẽ tạo sự cố IT hoặc yêu cầu điều chỉnh.',
  },
  {
    name: 'Hệ thống HR',
    direction: 'Webhook → onboarding',
    detail: 'Nhân viên mới được tạo tự động khi hợp đồng ký xong.',
  },
];

/**
 * MiniApp is the Application Builder showcase: the same business object rendered
 * as a list, a detail view, a kanban board, an administration preview and an
 * integration panel. List and detail read live records; kanban grouping policy,
 * the configuration preview and connectors are simulated, and each view carries
 * its own status label.
 */
export function MiniApp({ apps }: { apps: readonly MiniAppData[] }) {
  const [appKey, setAppKey] = useState(apps[0]?.object.key ?? '');
  const [view, setView] = useState<ViewKind>('list');
  const [selectedRecordIds, setSelectedRecordIds] = useState<Record<string, string>>({});

  const app = apps.find((item) => item.object.key === appKey) ?? apps[0];
  const activeView = VIEWS.find((item) => item.kind === view) ?? VIEWS[0];

  const statusField = useMemo(
    () => app?.object.fields.find((field) => field.type === 'select'),
    [app],
  );

  if (!app) {
    return null;
  }

  const selectedRecord =
    app.records.find((record) => record.id === selectedRecordIds[app.object.key]) ??
    app.records[0] ??
    null;

  function openRecord(recordId: string) {
    setSelectedRecordIds((current) => ({ ...current, [app.object.key]: recordId }));
    setView('detail');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {apps.map((item) => (
          <button
            key={item.object.key}
            type="button"
            onClick={() => setAppKey(item.object.key)}
            aria-pressed={item.object.key === app.object.key}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              item.object.key === app.object.key
                ? 'border-accent-strong/50 bg-accent/10 text-on-surface'
                : 'border-border text-on-surface-muted hover:bg-surface-overlay hover:text-on-surface',
            )}
          >
            {item.object.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {VIEWS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => setView(item.kind)}
              aria-pressed={item.kind === view}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                item.kind === view
                  ? 'border-accent-strong/50 bg-accent/10 text-on-surface'
                  : 'border-border text-on-surface-muted hover:bg-surface-overlay',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-on-surface-muted">
          <span>{`${app.records.length} bản ghi`}</span>
          <StatusBadge kind={activeView.stage} />
        </div>
      </div>

      {view === 'list' ? (
        <ListView app={app} onOpen={openRecord} />
      ) : view === 'detail' ? (
        <DetailView app={app} record={selectedRecord} />
      ) : view === 'kanban' ? (
        <KanbanView app={app} statusFieldKey={statusField?.key} />
      ) : view === 'config' ? (
        <ConfigView key={app.object.key} app={app} statusFieldKey={statusField?.key} />
      ) : (
        <IntegrationView />
      )}
    </div>
  );
}

function ListView({ app, onOpen }: { app: MiniAppData; onOpen: (recordId: string) => void }) {
  if (app.records.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center text-sm text-on-surface-muted">
        Chưa có bản ghi nào để hiển thị. Nhập dữ liệu ở trang Dữ liệu.
      </p>
    );
  }

  const secondary = app.object.fields.filter((field) => field.type !== 'text').slice(0, 2);

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised/40">
      {app.records.map((record) => (
        <li key={record.id}>
          <button
            type="button"
            onClick={() => onOpen(record.id)}
            className="flex w-full flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-overlay"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {primaryFieldValue(app.object.fields, record)}
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-on-surface-muted">
                Bản ghi bạn không đọc được
              </span>
            </span>
            <span className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-on-surface-muted">
              {secondary.map((field) => (
                <span key={field.key}>
                  <span className="text-on-surface-muted/70">{field.label}:</span>{' '}
                  {formatFieldValue(field, record.values[field.key])}
                </span>
              ))}
              <span>{formatTimestamp(record.createdAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DetailView({ app, record }: { app: MiniAppData; record: ObjectRecord | null }) {
  if (!record) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center text-sm text-on-surface-muted">
        Chưa có bản ghi để mở chi tiết.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="text-base font-semibold tracking-tight">
          {primaryFieldValue(app.object.fields, record)}
        </h3>
        <dl className="mt-4 divide-y divide-border">
          {app.object.fields.map((field) => (
            <div key={field.key} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr]">
              <dt className="text-xs tracking-wide text-on-surface-muted uppercase">
                {field.label}
              </dt>
              <dd className="text-sm">{formatFieldValue(field, record.values[field.key])}</dd>
            </div>
          ))}
        </dl>
      </div>
      <aside className="space-y-4">
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-xs">
          <p className="font-mono tracking-widest text-on-surface-muted uppercase">
            Thông tin bản ghi
          </p>
          <dl className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-on-surface-muted">Tạo lúc</dt>
              <dd>{formatTimestamp(record.createdAt)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-on-surface-muted">Cập nhật</dt>
              <dd>{formatTimestamp(record.updatedAt)}</dd>
            </div>
          </dl>
        </div>
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs leading-relaxed text-on-surface-muted">
          Thao tác theo vai trò và trạng thái, dòng hoạt động và liên kết giữa các bản ghi là phần
          sẽ làm ở bản sau — chưa có trong bản này.
        </p>
      </aside>
    </div>
  );
}

function KanbanView({ app, statusFieldKey }: { app: MiniAppData; statusFieldKey?: string }) {
  const statusField = app.object.fields.find((field) => field.key === statusFieldKey);

  if (!statusField || !statusField.options || statusField.options.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center text-sm text-on-surface-muted">
        {`Loại dữ liệu ${app.object.name} chưa có trường kiểu lựa chọn nên chưa gom cột được. Bảng
        kanban cần một trường trạng thái có danh sách lựa chọn — thêm một trường như vậy trong định
        nghĩa dữ liệu để xem dạng xem này.`}
      </p>
    );
  }

  const columns = [
    ...statusField.options.map((option) => ({
      key: option.value,
      label: option.label,
      records: app.records.filter((record) => record.values[statusField.key] === option.value),
    })),
    {
      key: '__none__',
      label: 'Chưa phân loại',
      records: app.records.filter((record) => {
        const value = record.values[statusField.key];
        return value === undefined || value === null || value === '';
      }),
    },
  ];

  return (
    <div>
      <p className="mb-3 text-xs text-on-surface-muted">
        {`Gom cột theo trường ${statusField.label} cho mục đích minh hoạ — chính sách gom nhóm và
        kéo thả sẽ làm ở bản sau.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {columns.map((column) => (
          <div
            key={column.key}
            className="rounded-xl border border-border bg-surface-raised/40 p-3"
          >
            <p className="flex items-center justify-between text-xs font-medium">
              {column.label}
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-on-surface-muted">
                {column.records.length}
              </span>
            </p>
            <ul className="mt-3 space-y-2">
              {column.records.map((record) => (
                <li
                  key={record.id}
                  className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
                >
                  {primaryFieldValue(app.object.fields, record)}
                </li>
              ))}
              {column.records.length === 0 ? (
                <li className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-xs text-on-surface-muted">
                  Trống
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationView() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-muted">
        Connector minh hoạ — chưa có adapter thật, chưa có retry/idempotency. Integration Hub bản
        giới hạn thuộc MVP, mỗi adapter cần mapping, timeout, retry và audit.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {MOCK_CONNECTORS.map((connector) => (
          <div
            key={connector.name}
            className="rounded-xl border border-border bg-surface-raised p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{connector.name}</p>
              <StatusBadge kind="mock" />
            </div>
            <p className="mt-1 font-mono text-[11px] text-on-surface-muted">
              {connector.direction}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-on-surface-muted">{connector.detail}</p>
            <p className="mt-3 rounded-md border border-dashed border-border-strong px-2 py-1.5 text-[11px] text-on-surface-muted">
              Trạng thái: chưa cấu hình · Lần đồng bộ cuối: —
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const CONFIG_ROLES: readonly {
  role: string;
  canView: boolean;
  canCreate: boolean;
  canApprove: boolean;
}[] = [
  { role: 'Nhân viên', canView: true, canCreate: true, canApprove: false },
  { role: 'Trưởng bộ phận', canView: true, canCreate: true, canApprove: true },
  { role: 'Kế toán', canView: true, canCreate: false, canApprove: true },
  { role: 'Giám đốc', canView: true, canCreate: false, canApprove: true },
];

const CONFIG_ACTIONS: readonly string[] = ['Duyệt', 'Trả về chỉnh sửa', 'Từ chối'];

/**
 * ConfigView is the administration preview of the Application Builder: the knobs
 * an administrator would turn to shape a mini-app. Nothing here is stored and
 * every control is disabled on purpose — configuring views, actions and
 * permissions is V2 scope, and pretending the toggles work would be a mock
 * presented as a feature.
 */
function ConfigView({ app, statusFieldKey }: { app: MiniAppData; statusFieldKey?: string }) {
  const statusField = app.object.fields.find((field) => field.key === statusFieldKey);
  const listColumns = app.object.fields.filter((field) => field.type !== 'file').slice(0, 3);

  const views: readonly { name: string; enabled: boolean; note: string }[] = [
    {
      name: 'Danh sách',
      enabled: true,
      note: 'Cột lấy từ định nghĩa dữ liệu, xem panel bên dưới.',
    },
    { name: 'Chi tiết', enabled: true, note: 'Hiển thị mọi trường của bản ghi kèm mô tả.' },
    {
      name: 'Form',
      enabled: app.object.fields.length > 0,
      note: 'Sinh từ schema; validate ở server trước khi lưu.',
    },
    {
      name: 'Kanban',
      enabled: Boolean(statusField),
      note: statusField
        ? `Gom cột theo trường ${statusField.label}.`
        : 'Cần một trường lựa chọn làm trạng thái.',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3">
        <div>
          <p className="text-sm font-medium">Ví dụ cấu hình — chỉ để xem, không lưu</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-on-surface-muted">
            Đây là những công tắc mà admin sẽ dùng khi Application Builder thành hình (V2). Mọi ô ở
            tab này bị khoá và giá trị chỉ là ví dụ minh hoạ hình dạng cấu hình; đổi chúng không có
            hiệu lực. Muốn làm thật cần: version hoá cấu hình đã publish, model quyền (D09) và audit
            mọi thay đổi cấu hình.
          </p>
        </div>
        <StatusBadge kind="concept" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ConfigPanel title="Dạng xem đang bật" subtitle="View nào xuất hiện trong mini-app">
          <ul className="space-y-2">
            {views.map((entry) => (
              <li key={entry.name} className="flex items-start gap-2.5">
                <ConfigCheckbox checked={entry.enabled} label={entry.name} />
                <span className="min-w-0 text-xs leading-relaxed text-on-surface-muted">
                  {entry.note}
                </span>
              </li>
            ))}
          </ul>
        </ConfigPanel>

        <ConfigPanel
          title="Cột trong danh sách"
          subtitle={`Lấy từ định nghĩa của ${app.object.name}`}
        >
          {listColumns.length === 0 ? (
            <p className="text-xs text-on-surface-muted">
              Loại dữ liệu chưa có trường để hiển thị.
            </p>
          ) : (
            <ul className="space-y-2">
              {listColumns.map((field) => (
                <li key={field.key} className="flex items-center gap-2.5">
                  <ConfigCheckbox checked label={field.label} />
                </li>
              ))}
            </ul>
          )}
        </ConfigPanel>

        <ConfigPanel
          title="Action theo trạng thái"
          subtitle={
            statusField
              ? `Trạng thái lấy từ trường ${statusField.label}`
              : 'Cần một trường lựa chọn để có trạng thái'
          }
        >
          {statusField?.options && statusField.options.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-on-surface-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Trạng thái
                    </th>
                    {CONFIG_ACTIONS.map((action) => (
                      <th key={action} scope="col" className="px-2 py-1.5 font-medium">
                        {action}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {statusField.options.map((option) => (
                    <tr key={option.value}>
                      <td className="py-2 pr-3">
                        {option.label}
                        <span className="ml-1.5 font-mono text-[10px] text-on-surface-muted">
                          {option.value}
                        </span>
                      </td>
                      {CONFIG_ACTIONS.map((action) => (
                        <td key={action} className="px-2 py-2">
                          <ConfigCheckbox checked label={`${action} khi ${option.label}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-on-surface-muted">
              Object này chưa khai field trạng thái nên chưa minh hoạ được action theo trạng thái.
            </p>
          )}
        </ConfigPanel>

        <ConfigPanel title="Quyền theo role" subtitle="Ai xem, ai tạo, ai duyệt (ví dụ)">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-on-surface-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Xem
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Tạo
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Duyệt
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CONFIG_ROLES.map((row) => (
                  <tr key={row.role}>
                    <td className="py-2 pr-3">{row.role}</td>
                    <td className="px-2 py-2">
                      <ConfigCheckbox checked={row.canView} label={`Xem — ${row.role}`} />
                    </td>
                    <td className="px-2 py-2">
                      <ConfigCheckbox checked={row.canCreate} label={`Tạo — ${row.role}`} />
                    </td>
                    <td className="px-2 py-2">
                      <ConfigCheckbox checked={row.canApprove} label={`Duyệt — ${row.role}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ConfigPanel>
      </div>
    </div>
  );
}

function ConfigPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised/40 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-[11px] text-on-surface-muted">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ConfigCheckbox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <input
      type="checkbox"
      defaultChecked={checked}
      disabled
      aria-label={label}
      className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
    />
  );
}
