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
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="08 / Settings"
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
