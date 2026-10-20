import { NextResponse } from 'next/server';

import { fetchApiWithSession } from '@/lib/api/server';

/**
 * Downloads one attachment. The browser never calls the API directly: this route forwards
 * the session cookie and streams the file back, and the API decides whether the caller may
 * read it (uploader while unbound, record scope once bound — ADR 0025).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let upstream: Response;
  try {
    upstream = await fetchApiWithSession(`/api/v1/attachments/${encodeURIComponent(id)}`);
  } catch {
    return plainText('Không tải được tệp. Thử lại sau ít phút.', 503);
  }

  if (!upstream.ok) {
    const message =
      upstream.status === 404
        ? 'Không tìm thấy tệp, hoặc bạn không có quyền đọc tệp này.'
        : upstream.status === 401
          ? 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.'
          : 'Không tải được tệp. Thử lại sau ít phút.';
    return plainText(message, upstream.status);
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'content-length'] as const) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new NextResponse(upstream.body, { status: 200, headers });
}

function plainText(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
