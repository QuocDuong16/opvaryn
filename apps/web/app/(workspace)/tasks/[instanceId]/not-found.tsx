import Link from 'next/link';

export default function ProcessInstanceNotFound() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
        404 / Việc của tôi
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Không tìm thấy việc này</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-muted">
        Đường dẫn có thể bị gõ sai, hoặc việc này thuộc một bản ghi nằm ngoài phạm vi bạn được đọc.
        Hộp việc chỉ liệt kê việc thuộc vai trò bạn giữ.
      </p>
      <Link
        href="/tasks"
        className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
      >
        Về hộp việc
      </Link>
    </div>
  );
}
