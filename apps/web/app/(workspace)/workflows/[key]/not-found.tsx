import Link from 'next/link';

export default function ProcessDefinitionNotFound() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="font-mono text-xs tracking-widest text-on-surface-muted uppercase">
        404 / process definition
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Quy trình không tồn tại</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-muted">
        Có thể địa chỉ bị gõ sai, hoặc quy trình này chưa được phát hành trong môi trường hiện tại.
        Danh sách quy trình hiện có nằm ở trang Workflows.
      </p>
      <Link
        href="/workflows"
        className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
      >
        Về danh sách quy trình
      </Link>
    </div>
  );
}
