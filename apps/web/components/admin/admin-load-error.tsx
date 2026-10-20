import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/** One sentence for a screen that could not read the API, without shell commands. */
export function AdminLoadError({ message }: { message: string }) {
  return (
    <Card className="border-warning/40">
      <CardTitle className="text-warning">Không đọc được dữ liệu quản trị</CardTitle>
      <CardDescription>{message}</CardDescription>
      <p className="mt-4 text-sm text-on-surface-muted">
        Thử lại sau ít phút. Nếu vẫn không được, báo cho người vận hành hệ thống.
      </p>
    </Card>
  );
}
