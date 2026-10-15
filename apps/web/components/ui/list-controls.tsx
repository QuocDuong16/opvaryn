import Link from 'next/link';

/**
 * ListSearch is the search field every list screen uses. It is a plain GET form, so the term
 * travels in the URL: a search can be shared, bookmarked and used without JavaScript, and the
 * server does the filtering.
 */
export function ListSearch({
  basePath,
  value = '',
  placeholder,
  label,
  keep = {},
}: {
  basePath: string;
  value?: string;
  placeholder: string;
  label: string;
  /** Other query parameters the list is using, so a search keeps them. */
  keep?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([name, kept]) =>
        kept ? <input key={name} type="hidden" name={name} value={kept} /> : null,
      )}
      <input
        type="search"
        name="q"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm placeholder:text-on-surface-muted/60 focus:border-accent-strong focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-overlay"
      >
        Tìm
      </button>
      {value ? (
        <Link href={basePath} className="text-sm text-accent-strong hover:underline">
          Xoá lọc
        </Link>
      ) : null}
    </form>
  );
}

/**
 * Pagination renders the controls for a server-side page of a list. The API does the slicing
 * (ADR 0017): this only says where you are and links to the neighbours, keeping the search
 * term and any other filter in the URL.
 */
export function Pagination({
  total,
  limit,
  offset,
  basePath,
  params = {},
  offsetParam = 'offset',
}: {
  total: number;
  limit: number;
  offset: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  /** The parameter that carries the offset, when a screen paginates two lists at once. */
  offsetParam?: string;
}) {
  if (total <= limit) {
    return null;
  }

  const first = Math.min(offset + 1, total);
  const last = Math.min(offset + limit, total);
  const previous = Math.max(offset - limit, 0);
  const next = offset + limit;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value) {
        search.set(name, value);
      }
    }
    if (target > 0) {
      search.set(offsetParam, String(target));
    }
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav
      aria-label="Phân trang"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-xs text-on-surface-muted">{`${first}–${last} trên ${total}`}</p>
      <div className="flex items-center gap-2">
        {offset > 0 ? (
          <Link
            href={href(previous)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-overlay"
          >
            ← Trang trước
          </Link>
        ) : (
          <span className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-on-surface-muted/60">
            ← Trang trước
          </span>
        )}
        {next < total ? (
          <Link
            href={href(next)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-overlay"
          >
            Trang sau →
          </Link>
        ) : (
          <span className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-on-surface-muted/60">
            Trang sau →
          </span>
        )}
      </div>
    </nav>
  );
}

/** pageOffset turns an offset search parameter into a page start the API accepts. */
export function pageOffset(raw: string | undefined, limit: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  // Snap to a page boundary: an offset the UI never produces is treated as the first page
  // rather than asking the API for a slice between two pages.
  return Math.floor(parsed / limit) * limit;
}
