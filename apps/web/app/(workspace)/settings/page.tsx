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

const ENDPOINTS: readonly { method: string; path: string; purpose: string }[] = [
  { method: 'GET', path: '/healthz', purpose: 'Liveness probe' },
  { method: 'POST', path: '/api/v1/auth/login', purpose: 'Đăng nhập, mở phiên làm việc' },
  { method: 'POST', path: '/api/v1/auth/logout', purpose: 'Kết thúc session hiện tại' },
  { method: 'GET', path: '/api/v1/me', purpose: 'Người dùng hiện tại kèm vai trò và bộ phận' },
  {
    method: 'GET',
    path: '/api/v1/roles',
    purpose: 'Danh mục vai trò có ít nhất một người giữ (trình thiết kế dùng để gợi ý)',
  },
  {
    method: 'GET',
    path: '/api/v1/tasks',
    purpose: 'Hộp việc: việc đang mở của các vai trò mà người đang đăng nhập giữ',
  },
  { method: 'GET', path: '/readyz', purpose: 'Readiness, kiểm tra database' },
  { method: 'GET', path: '/api/v1/meta', purpose: 'Tên, phiên bản và giai đoạn build' },
  { method: 'GET', path: '/api/v1/business-objects', purpose: 'Danh sách business object' },
  { method: 'POST', path: '/api/v1/business-objects', purpose: 'Tạo business object mới' },
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
  { method: 'GET', path: '/api/v1/process-definitions', purpose: 'Danh sách process definition' },
  {
    method: 'POST',
    path: '/api/v1/process-definitions',
    purpose: 'Tạo process definition, validate graph và publish v1',
  },
  {
    method: 'PUT',
    path: '/api/v1/process-definitions/{key}',
    purpose: 'Publish phiên bản mới của quy trình (instance đang chạy giữ phiên bản cũ)',
  },
  {
    method: 'GET',
    path: '/api/v1/process-definitions/{key}/versions',
    purpose: 'Lịch sử phiên bản của quy trình',
  },
  {
    method: 'GET',
    path: '/api/v1/process-instances',
    purpose: 'Instance theo phạm vi đọc, lọc theo business object hoặc quy trình',
  },
  { method: 'GET', path: '/api/v1/metrics', purpose: 'Danh sách metric đã định nghĩa' },
  {
    method: 'POST',
    path: '/api/v1/metrics',
    purpose: 'Tạo metric (cần admin hoặc process_designer)',
  },
  {
    method: 'PUT',
    path: '/api/v1/metrics/{key}',
    purpose: 'Sửa định nghĩa metric; key là định danh nên không đổi được',
  },
  {
    method: 'GET',
    path: '/api/v1/metrics/{key}/result',
    purpose: 'Chạy metric theo phạm vi dữ liệu của người gọi',
  },
  {
    method: 'GET',
    path: '/api/v1/process-metrics',
    purpose: 'Read model vận hành: instance, cycle time, thời gian bước, tỉ lệ duyệt / chạy lại',
  },
  {
    method: 'POST',
    path: '/api/v1/process-instances',
    purpose: 'Khởi tạo instance từ một bản ghi đã lưu',
  },
  {
    method: 'GET',
    path: '/api/v1/process-instances/{id}',
    purpose: 'Một lần chạy kèm việc và nhật ký sự kiện',
  },
  {
    method: 'POST',
    path: '/api/v1/process-instances/{id}/tasks/{taskId}/decisions',
    purpose: 'Duyệt / trả về / từ chối, CAS trên task, một transaction',
  },
];

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending: 'đang chờ gửi lại',
  delivered: 'đã gửi',
  failed: 'bỏ cuộc',
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
    deliveries = await api.listWebhookDeliveries(10);
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
        lead="Trang dành cho người vận hành hệ thống: endpoint, cổng, phiên bản công cụ và nhật ký tích hợp. Cấu hình tổ chức (đăng nhập, phân quyền, môi trường) chưa có trong bản này."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Endpoint đang chạy</CardTitle>
          <CardDescription>
            Hợp đồng đầy đủ nằm ở <code>apps/api/openapi/openapi.yaml</code>.
          </CardDescription>
          <ul className="mt-4 space-y-2 text-sm">
            {ENDPOINTS.map((endpoint) => (
              <li key={`${endpoint.method} ${endpoint.path}`} className="flex items-baseline gap-3">
                <span className="w-10 shrink-0 font-mono text-xs text-accent-strong">
                  {endpoint.method}
                </span>
                <span className="font-mono text-xs">{endpoint.path}</span>
                <span className="text-xs text-on-surface-muted">{endpoint.purpose}</span>
              </li>
            ))}
          </ul>
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
                            {delivery.event}
                            <span className="mt-0.5 block text-[10px] text-on-surface-muted">
                              {`instance ${delivery.instanceId.slice(0, 8)}…`}
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
