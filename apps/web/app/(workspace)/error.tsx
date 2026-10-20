'use client';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/**
 * The workspace error boundary: a screen that could not render says so in one sentence and
 * offers a retry, instead of showing the framework's error page. The API being down is the
 * ordinary case here — every page reads it — so the copy points at the administrator.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="border-warning/40">
      <CardTitle className="text-warning">Trang này không tải được</CardTitle>
      <CardDescription>
        Hệ thống không đọc được dữ liệu cần cho trang bạn vừa mở. Thử lại; nếu vẫn vậy, báo cho
        người quản trị hệ thống.
      </CardDescription>
      {error.digest ? (
        <p className="mt-2 font-mono text-[11px] text-on-surface-muted">
          Mã tra cứu: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
      >
        Thử lại
      </button>
    </Card>
  );
}
