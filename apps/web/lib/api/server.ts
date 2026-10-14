import { ApiError, createApiClient, type ApiClient } from '@opvaryn/contracts';

import { getSessionToken, SESSION_COOKIE } from '@/lib/session';

// Server-side base URL: the API is reached container-to-container or over
// loopback. NEXT_PUBLIC_API_BASE_URL is only the browser fallback.
const DEFAULT_API_BASE_URL = 'http://localhost:21501';

/**
 * Server-side API client. Server Components and Server Actions use this so the
 * browser never needs a CORS-enabled direct API call for reads and mutations.
 *
 * The session token lives in an httpOnly cookie of the web app and is forwarded to
 * the API as a Cookie header; the browser never holds or sends it (ADR 0008).
 */
export function createServerApiClient(): ApiClient {
  const baseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  const withSession: typeof fetch = async (input, init) => {
    const token = await getSessionToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
    }
    return fetch(input, { ...init, headers });
  };

  return createApiClient(baseUrl, withSession);
}

/** describeApiError turns any thrown value into one user-facing sentence. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'unauthorized':
        return 'Cần đăng nhập để xem dữ liệu này.';
      case 'forbidden':
        return 'Tài khoản đang đăng nhập không có quyền cho hành động này.';
      case 'invalid_request':
        return `Dữ liệu chưa hợp lệ: ${error.message}`;
      case 'not_found':
        return 'Không tìm thấy dữ liệu được yêu cầu. Có thể nó vừa bị xoá hoặc key chưa tồn tại.';
      case 'conflict':
        return 'Key này đã tồn tại. Chọn key khác.';
      case 'service_unavailable':
        return 'API chưa kết nối được database. Kiểm tra Postgres và chạy migration.';
      default:
        return `API trả lỗi (${error.status}): ${error.message}`;
    }
  }
  return 'Không gọi được API. Kiểm tra server Go đang chạy ở cổng 21501.';
}
