import { notFound } from 'next/navigation';
import { ApiError, type WebhookDeliveryList } from '@opvaryn/contracts';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { isAdmin } from '@/lib/access';
import { advancedVisible } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { formatTimestamp } from '@/lib/format';

export const metadata = { title: 'Cài đặt' };

// The endpoint table of the running system. `scripts/check-docs.mjs` compares it with the
// OpenAPI document, so a new endpoint cannot be added without appearing here.
const ENDPOINTS: readonly { method: string; path: string; purpose: string }[] = [
  { method: 'GET', path: '/healthz', purpose: 'Liveness probe' },
  { method: 'GET', path: '/readyz', purpose: 'Readiness, kiểm tra database' },
  { method: 'GET', path: '/api/v1/meta', purpose: 'Tên, phiên bản và giai đoạn build' },

  { method: 'POST', path: '/api/v1/auth/login', purpose: 'Đăng nhập, mở phiên làm việc' },
  { method: 'POST', path: '/api/v1/auth/logout', purpose: 'Kết thúc phiên hiện tại' },
  { method: 'GET', path: '/api/v1/me', purpose: 'Người dùng hiện tại kèm vai trò và bộ phận' },
  { method: 'POST', path: '/api/v1/me/password', purpose: 'Đổi mật khẩu của chính mình' },
  { method: 'GET', path: '/api/v1/roles', purpose: 'Danh mục vai trò có ít nhất một người giữ' },
  {
    method: 'GET',
    path: '/api/v1/me/two-factor',
    purpose: 'Tài khoản này đã bật xác thực hai bước chưa',
  },
  {
    method: 'POST',
    path: '/api/v1/me/two-factor',
    purpose: 'Tạo khoá bí mật cho ứng dụng xác thực',
  },
  {
    method: 'POST',
    path: '/api/v1/me/two-factor/enable',
    purpose: 'Bật xác thực hai bước và nhận mã cứu hộ',
  },
  {
    method: 'POST',
    path: '/api/v1/me/two-factor/disable',
    purpose: 'Tắt xác thực hai bước',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/users/{userId}/two-factor',
    purpose: 'Tài khoản kia đã bật xác thực hai bước chưa',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/users/{userId}/two-factor/reset',
    purpose: 'Gỡ xác thực hai bước khi người đó mất thiết bị',
  },
  {
    method: 'GET',
    path: '/api/v1/tasks',
    purpose: 'Hộp việc của các vai trò người đang đăng nhập giữ',
  },

  {
    method: 'GET',
    path: '/api/v1/admin/users',
    purpose: 'Danh sách tài khoản (có phân trang và tìm kiếm)',
  },
  { method: 'POST', path: '/api/v1/admin/users', purpose: 'Tạo tài khoản' },
  { method: 'GET', path: '/api/v1/admin/users/{userId}', purpose: 'Một tài khoản' },
  { method: 'PUT', path: '/api/v1/admin/users/{userId}', purpose: 'Sửa hồ sơ và bộ vai trò' },
  {
    method: 'POST',
    path: '/api/v1/admin/users/{userId}/password',
    purpose: 'Đặt lại mật khẩu và kết thúc mọi phiên của người đó',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/users/{userId}/sessions',
    purpose: 'Đăng xuất mọi phiên của một người',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/users/{userId}/unlock',
    purpose: 'Mở khoá đăng nhập sau khi gõ sai mật khẩu quá nhiều lần',
  },
  { method: 'GET', path: '/api/v1/admin/departments', purpose: 'Danh sách phòng ban' },
  { method: 'POST', path: '/api/v1/admin/departments', purpose: 'Tạo phòng ban' },
  { method: 'PUT', path: '/api/v1/admin/departments/{key}', purpose: 'Đổi tên phòng ban' },
  {
    method: 'DELETE',
    path: '/api/v1/admin/departments/{key}',
    purpose: 'Xoá phòng ban không còn ai',
  },
  {
    method: 'GET',
    path: '/api/v1/app-configs/{key}',
    purpose: 'Cấu hình của màn ứng dụng: tên, trường gom cột kanban, các cột của danh sách',
  },
  {
    method: 'PUT',
    path: '/api/v1/app-configs/{key}',
    purpose: 'Lưu cấu hình của màn ứng dụng',
  },
  {
    method: 'GET',
    path: '/api/v1/lookups/{key}',
    purpose: 'Các lựa chọn lấy từ hệ thống ngoài cho những trường của loại dữ liệu này',
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/lookups/{key}/{fieldKey}',
    purpose: 'Gắn một trường vào danh mục của hệ thống khác, và nơi ghi bản ghi về lại',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/lookups/writebacks',
    purpose: 'Nhật ký các lần ghi bản ghi về hệ thống ngoài',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/work-policies/{key}',
    purpose: 'Chính sách của một loại việc: hạn mặc định, ưu tiên, vai trò nhận việc khi quá hạn',
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/work-policies/{key}',
    purpose: 'Đặt chính sách của một loại việc',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/working-hours',
    purpose: 'Lịch giờ làm việc của tổ chức — hạn xử lý tính theo lịch này',
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/working-hours',
    purpose: 'Đặt lại lịch giờ làm việc',
  },
  { method: 'GET', path: '/api/v1/admin/roles', purpose: 'Danh mục vai trò' },
  { method: 'POST', path: '/api/v1/admin/roles', purpose: 'Thêm vai trò vào danh mục' },
  { method: 'PUT', path: '/api/v1/admin/roles/{key}', purpose: 'Đổi tên hiển thị của vai trò' },
  { method: 'DELETE', path: '/api/v1/admin/roles/{key}', purpose: 'Xoá vai trò không ai giữ' },

  { method: 'GET', path: '/api/v1/business-objects', purpose: 'Danh sách định nghĩa dữ liệu' },
  {
    method: 'POST',
    path: '/api/v1/business-objects',
    purpose: 'Tạo định nghĩa và publish phiên bản đầu',
  },
  {
    method: 'GET',
    path: '/api/v1/business-objects/{key}',
    purpose: 'Đọc một định nghĩa theo key (kèm phiên bản đang dùng)',
  },
  {
    method: 'PUT',
    path: '/api/v1/business-objects/{key}',
    purpose: 'Publish phiên bản mới của định nghĩa (bất biến)',
  },
  {
    method: 'GET',
    path: '/api/v1/business-objects/{key}/versions',
    purpose: 'Lịch sử phiên bản đã publish, mới nhất trước',
  },
  {
    method: 'GET',
    path: '/api/v1/business-objects/{key}/records',
    purpose: 'Danh sách bản ghi kèm phiên bản định nghĩa của chúng',
  },
  {
    method: 'POST',
    path: '/api/v1/business-objects/{key}/records',
    purpose: 'Tạo bản ghi, validate theo schema của phiên bản đang dùng',
  },
  {
    method: 'GET',
    path: '/api/v1/business-objects/{key}/records/{recordId}',
    purpose: 'Một bản ghi kèm quyền sửa của người đọc',
  },
  {
    method: 'PUT',
    path: '/api/v1/business-objects/{key}/records/{recordId}',
    purpose: 'Sửa bản ghi theo đúng phiên bản định nghĩa của nó',
  },
  {
    method: 'DELETE',
    path: '/api/v1/business-objects/{key}/records/{recordId}',
    purpose: 'Xoá bản ghi; bản ghi đang có lần chạy thì từ chối',
  },
  {
    method: 'GET',
    path: '/api/v1/business-objects/{key}/records/{recordId}/history',
    purpose: 'Lịch sử thay đổi từng trường của bản ghi',
  },
  {
    method: 'GET',
    path: '/api/v1/business-objects/{key}/records/export',
    purpose: 'Xuất bản ghi ra CSV theo phạm vi đọc',
  },
  {
    method: 'POST',
    path: '/api/v1/business-objects/{key}/records/import',
    purpose: 'Nhập bản ghi từ CSV, có chạy thử và ghi tất cả hoặc không ghi gì',
  },

  { method: 'GET', path: '/api/v1/process-definitions', purpose: 'Danh sách quy trình' },
  {
    method: 'POST',
    path: '/api/v1/process-definitions',
    purpose: 'Tạo quy trình, validate graph và publish v1',
  },
  {
    method: 'GET',
    path: '/api/v1/process-definitions/{key}',
    purpose: 'Đọc một quy trình theo key',
  },
  {
    method: 'PUT',
    path: '/api/v1/process-definitions/{key}',
    purpose: 'Publish phiên bản mới của quy trình (lần chạy đang chạy giữ phiên bản cũ)',
  },
  {
    method: 'GET',
    path: '/api/v1/process-definitions/{key}/versions',
    purpose: 'Lịch sử phiên bản của quy trình',
  },
  {
    method: 'GET',
    path: '/api/v1/process-instances',
    purpose: 'Lần chạy theo phạm vi đọc, lọc theo định nghĩa hoặc bản ghi',
  },
  {
    method: 'POST',
    path: '/api/v1/process-instances',
    purpose: 'Khởi tạo lần chạy từ một bản ghi đã lưu',
  },
  {
    method: 'GET',
    path: '/api/v1/process-instances/{instanceId}',
    purpose: 'Một lần chạy kèm việc và nhật ký sự kiện',
  },
  {
    method: 'POST',
    path: '/api/v1/process-instances/{instanceId}/tasks/{taskId}/decisions',
    purpose: 'Duyệt / trả về / từ chối, so khớp trên việc, một transaction',
  },
  {
    method: 'GET',
    path: '/api/v1/process-metrics',
    purpose: 'Read model vận hành: lần chạy, cycle time, thời gian bước, tỉ lệ duyệt / chạy lại',
  },

  { method: 'GET', path: '/api/v1/metrics', purpose: 'Danh sách chỉ số đã định nghĩa' },
  {
    method: 'POST',
    path: '/api/v1/metrics',
    purpose: 'Tạo chỉ số (cần admin hoặc process_designer)',
  },
  { method: 'GET', path: '/api/v1/metrics/{key}', purpose: 'Đọc định nghĩa của một chỉ số' },
  {
    method: 'PUT',
    path: '/api/v1/metrics/{key}',
    purpose: 'Sửa định nghĩa chỉ số; key là định danh nên không đổi được',
  },
  {
    method: 'GET',
    path: '/api/v1/metrics/{key}/result',
    purpose: 'Chạy chỉ số theo phạm vi dữ liệu của người gọi',
  },

  { method: 'POST', path: '/api/v1/attachments', purpose: 'Tải tệp lên, gắn vào bản ghi khi lưu' },
  {
    method: 'GET',
    path: '/api/v1/attachments/{attachmentId}',
    purpose: 'Tải tệp về (luôn tải xuống, không hiển thị)',
  },
  {
    method: 'DELETE',
    path: '/api/v1/attachments/{attachmentId}',
    purpose: 'Xoá tệp chưa gắn vào bản ghi',
  },
  {
    method: 'GET',
    path: '/api/v1/webhook-deliveries',
    purpose: 'Nhật ký gửi sự kiện ra hệ thống khác',
  },
];

/**
 * endpointGroup names the area an endpoint belongs to, so the table reads as a list of
 * areas instead of one long wall of paths.
 */
function endpointGroup(path: string): string {
  if (path.startsWith('/api/v1/admin')) {
    return 'Quản trị tổ chức';
  }
  if (path.startsWith('/api/v1/business-objects')) {
    return 'Định nghĩa dữ liệu và bản ghi';
  }
  if (path.startsWith('/api/v1/process')) {
    return 'Quy trình phê duyệt';
  }
  if (path.startsWith('/api/v1/metrics')) {
    return 'Chỉ số báo cáo';
  }
  if (path.startsWith('/api/v1/attachments')) {
    return 'Tệp đính kèm';
  }
  if (path.startsWith('/api/v1/webhook')) {
    return 'Tích hợp ra ngoài';
  }
  if (
    path.startsWith('/api/v1/auth') ||
    path.startsWith('/api/v1/me') ||
    path === '/api/v1/roles'
  ) {
    return 'Phiên làm việc và vai trò';
  }
  if (path === '/api/v1/tasks') {
    return 'Hộp việc';
  }
  return 'Hệ thống';
}

/** endpointGroups keeps the order of the table and drops the empty groups. */
function endpointGroups(): {
  title: string;
  items: readonly { method: string; path: string; purpose: string }[];
}[] {
  const groups = new Map<string, { method: string; path: string; purpose: string }[]>();
  for (const endpoint of ENDPOINTS) {
    const title = endpointGroup(endpoint.path);
    const items = groups.get(title) ?? [];
    items.push(endpoint);
    groups.set(title, items);
  }
  return [...groups.entries()].map(([title, items]) => ({ title, items }));
}

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending: 'đang chờ gửi lại',
  delivered: 'đã gửi',
  failed: 'bỏ cuộc',
};

/** DELIVERY_EVENT_LABELS name the engine events the log carries. */
const DELIVERY_EVENT_LABELS: Record<string, string> = {
  instance_started: 'Lần chạy bắt đầu',
  task_created: 'Việc được giao',
  instance_completed: 'Lần chạy kết thúc',
  instance_rejected: 'Lần chạy bị từ chối',
};

export default async function SettingsPage() {
  // This screen describes how the system is built and operated, so it belongs to the
  // administrator and only while advanced mode is on (ADR 0015). Everyone else gets a 404,
  // the same answer as any other address they have no business at.
  const [me, advanced] = await Promise.all([loadRoles(), getAdvancedMode()]);
  if (!advancedVisible(isAdmin(me), advanced)) {
    notFound();
  }

  // The integration card is live data, and it is allowed to fail on its own: a missing
  // session or a stopped API must not blank the reference tables below.
  const api = createServerApiClient();
  let deliveries: WebhookDeliveryList | null = null;
  let deliveriesError: string | null = null;
  try {
    deliveries = await api.listWebhookDeliveries({ limit: 10 });
  } catch (cause) {
    deliveriesError =
      cause instanceof ApiError && cause.code === 'forbidden'
        ? 'Cần vai trò process_designer hoặc admin để xem nhật ký giao.'
        : describeApiError(cause);
  }

  return (
    <>
      <PageHeader
        eyebrow="09 / Vận hành"
        title="Vận hành"
        lead="Trang dành cho người vận hành hệ thống: endpoint, cổng, phiên bản công cụ và nhật ký tích hợp. Tài khoản, phòng ban và vai trò nằm ở khu vực Quản trị."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Endpoint đang chạy</CardTitle>
          <CardDescription>
            Hợp đồng đầy đủ nằm ở <code>apps/api/openapi/openapi.yaml</code>.
          </CardDescription>
          <div className="mt-4 space-y-5 text-sm">
            {endpointGroups().map((group) => (
              <section key={group.title}>
                <h3 className="text-xs font-semibold tracking-wide text-on-surface-muted uppercase">
                  {group.title}
                </h3>
                <ul className="mt-2 space-y-2">
                  {group.items.map((endpoint) => (
                    <li
                      key={`${endpoint.method} ${endpoint.path}`}
                      className="flex items-baseline gap-3"
                    >
                      <span className="w-14 shrink-0 font-mono text-xs whitespace-nowrap text-accent-strong">
                        {endpoint.method}
                      </span>
                      <span className="font-mono text-xs">{endpoint.path}</span>
                      <span className="text-xs text-on-surface-muted">{endpoint.purpose}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Cổng và công cụ local</CardTitle>
          <CardDescription>Dải 21xxx để không đụng các project khác trên máy.</CardDescription>
          <dl className="mt-4 space-y-3 text-sm">
            <PortRow label="Web (Next.js)" value="21500" />
            <PortRow label="API (Go)" value="21501" />
            <PortRow label="PostgreSQL" value="21532" />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-on-surface-muted">
            Toolchain được pin bằng mise (<code>go 1.27.2</code>, <code>node 26.9.0</code>,{' '}
            <code>pnpm 12.12.0</code>). Chạy <code>mise install</code> sau khi clone.
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Dữ liệu mẫu và bộ lệnh kiểm tra</CardTitle>
          <CardDescription>
            Bản ghi nằm trong PostgreSQL; mọi màn hình đọc lại từ đó nên dữ liệu bạn nhập sẽ còn sau
            khi khởi động lại API/web.
          </CardDescription>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-mono text-xs text-accent-strong">make seed-demo</dt>
              <dd className="mt-0.5 text-xs text-on-surface-muted">
                Nạp ba business object pilot (purchase_request, it_incident, hr_onboarding), quy
                trình của chúng và một số bản ghi qua chính API. Idempotent: chạy lại không tạo
                trùng.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-accent-strong">make smoke-api</dt>
              <dd className="mt-0.5 text-xs text-on-surface-muted">
                Kiểm tra API end-to-end gồm cả tạo bản ghi và các nhánh lỗi 400/404/409.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-accent-strong">make smoke-demo-flows</dt>
              <dd className="mt-0.5 text-xs text-on-surface-muted">
                Build cả API và web, replay form của các luồng chính (nhập bản ghi, tạo object, lưu
                bố cục) rồi kiểm chứng dữ liệu đã lưu. Dừng dev server trước khi chạy.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-accent-strong">make docker-clean</dt>
              <dd className="mt-0.5 text-xs text-on-surface-muted">
                Xoá volume Postgres — toàn bộ business object và bản ghi sẽ mất, kể cả object do các
                lần chạy smoke test tạo ra.
              </dd>
            </div>
          </dl>
        </Card>
      </div>
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Tích hợp ra ngoài (webhook)</h2>
          {deliveriesError ? null : <StatusBadge kind="live" />}
        </div>
        <Card>
          <CardDescription>
            Khi một quy trình chạy mà hệ thống khác cần biết — lần chạy bắt đầu, một việc được giao,
            instance kết thúc hoặc bị từ chối — nó gửi một POST JSON đã ký HMAC tới
            <code className="mx-1 font-mono text-xs">OPVARYN_WEBHOOK_URL</code>. Thông báo được ghi
            vào hàng đợi <em>cùng transaction</em> với sự kiện, gửi lại khi bên nhận lỗi, và bỏ cuộc
            sau số lần thử cho phép — một thông báo cũ không được chặn việc mới, và quyết định của
            người dùng không bao giờ phụ thuộc vào việc gửi này.
          </CardDescription>

          {deliveriesError ? (
            <p className="mt-4 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">
              {deliveriesError}
            </p>
          ) : null}

          {deliveries ? (
            <>
              <p className="mt-4 text-sm">
                {deliveries.enabled
                  ? 'Đang bật: mọi sự kiện được thông báo ra ngoài.'
                  : 'Đang tắt: chưa cấu hình OPVARYN_WEBHOOK_URL, không có thông báo nào được xếp hàng.'}
              </p>
              {deliveries.data.length === 0 ? (
                <p className="mt-2 text-sm text-on-surface-muted">
                  Chưa có lần giao nào được ghi lại.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Sự kiện
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Trạng thái
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Số lần thử
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Lỗi cuối
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Tạo lúc
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-surface-raised/40">
                      {deliveries.data.map((delivery) => (
                        <tr key={delivery.id}>
                          <td className="px-4 py-3 align-top font-mono text-xs">
                            {DELIVERY_EVENT_LABELS[delivery.event] ?? delivery.event}
                            <span className="mt-0.5 block text-[10px] text-on-surface-muted">
                              {`lần chạy ${delivery.instanceId.slice(0, 8)}…`}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-xs">
                            {DELIVERY_STATUS_LABELS[delivery.status] ?? delivery.status}
                          </td>
                          <td className="px-4 py-3 align-top text-xs">{delivery.attempts}</td>
                          <td className="px-4 py-3 align-top text-xs text-on-surface-muted">
                            {delivery.lastError ?? '—'}
                          </td>
                          <td className="px-4 py-3 align-top text-xs whitespace-nowrap text-on-surface-muted">
                            {formatTimestamp(delivery.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </Card>
      </section>
    </>
  );
}

function PortRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-on-surface-muted">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

/** loadRoles answers who is asking; a broken API hides this screen rather than showing it. */
async function loadRoles(): Promise<string[]> {
  try {
    const me = await createServerApiClient().getMe();
    return me.roles;
  } catch {
    return [];
  }
}
