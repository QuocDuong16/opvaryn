import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

export const metadata = { title: 'Cài đặt' };

const ENDPOINTS: readonly { method: string; path: string; purpose: string }[] = [
  { method: 'GET', path: '/healthz', purpose: 'Liveness probe' },
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
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="09 / Settings"
        title="Cài đặt"
        lead="Cấu hình theo tổ chức (identity, phân quyền, môi trường) chưa thuộc phạm vi demo. Trang này ghi lại cấu hình kỹ thuật đang có để dev và người trình diễn đối chiếu."
        aside={<StatusBadge kind="live" />}
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
          <CardTitle>Dữ liệu demo</CardTitle>
          <CardDescription>
            Bản ghi nằm trong PostgreSQL local; mọi màn hình đọc lại từ đó nên dữ liệu bạn nhập sẽ
            còn sau khi khởi động lại API/web.
          </CardDescription>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-mono text-xs text-accent-strong">make seed-demo</dt>
              <dd className="mt-0.5 text-xs text-on-surface-muted">
                Nạp hai business object mẫu (purchase_request, it_incident) và một số bản ghi qua
                chính API. Idempotent: chạy lại không tạo trùng.
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
                Build cả API và web, replay form của các luồng demo (nhập bản ghi, tạo object, lưu
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
