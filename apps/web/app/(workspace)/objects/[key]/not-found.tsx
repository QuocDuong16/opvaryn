import Link from 'next/link';

export default function ObjectNotFound() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
        404 / loại dữ liệu
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Không có loại dữ liệu này</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-muted">
        Key có thể bị gõ sai hoặc chưa được tạo trong môi trường này. Danh sách định nghĩa hiện có
        nằm ở trang Business Objects.
      </p>
      <Link
        href="/objects"
        className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
      >
        Về danh sách dữ liệu
      </Link>
    </div>
  );
}
