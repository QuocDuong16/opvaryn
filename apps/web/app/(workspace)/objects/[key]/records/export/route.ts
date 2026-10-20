import { NextResponse } from 'next/server';

import { fetchApiWithSession } from '@/lib/api/server';

/**
 * Downloads the records of one definition as CSV. The browser never calls the API directly:
 * this route forwards the session cookie and streams the file back, so the download is the
 * same scoped data the screen shows (ADR 0008). The API sets the filename and the UTF-8 BOM.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const { key } = await params;
  const query = new URL(request.url).searchParams.get('q') ?? '';
  const suffix = query ? `?q=${encodeURIComponent(query)}` : '';

  let upstream: Response;
  try {
    upstream = await fetchApiWithSession(
      `/api/v1/business-objects/${encodeURIComponent(key)}/records/export${suffix}`,
    );
  } catch {
    return plainText('Không gọi được API. Thử lại sau ít phút.', 503);
  }

  if (!upstream.ok) {
    return plainText(exportErrorMessage(upstream.status), upstream.status);
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8');
  headers.set(
    'Content-Disposition',
    upstream.headers.get('content-disposition') ?? `attachment; filename="${key}-records.csv"`,
  );
  headers.set('Cache-Control', 'no-store');
  // A download is data, never something the browser should render.
  headers.set('X-Content-Type-Options', 'nosniff');
  return new NextResponse(upstream.body, { status: 200, headers });
}

function exportErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Danh sách quá lớn để xuất. Hãy thu hẹp tìm kiếm rồi thử lại.';
    case 401:
      return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.';
    case 404:
      return 'Không tìm thấy loại dữ liệu này.';
    default:
      return 'Không xuất được dữ liệu. Thử lại sau ít phút.';
  }
}

function plainText(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
