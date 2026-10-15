import Link from 'next/link';

export default function ProcessInstanceNotFound() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
        404 / process instance
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Không tìm thấy quy trình</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-muted">
        Instance có thể đã bị gõ sai, hoặc bản ghi của nó nằm ngoài phạm vi đọc của bạn và API trả
        404 thay vì xác nhận nó tồn tại. Hộp việc của bạn chỉ liệt kê việc thuộc vai trò bạn giữ.
      </p>
      <Link
        href="/tasks"
        className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
      >
        Về inbox
      </Link>
    </div>
  );
}
