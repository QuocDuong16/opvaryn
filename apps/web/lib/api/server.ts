import { ApiError, createApiClient, type ApiClient } from '@opvaryn/contracts';

import { getSessionToken, SESSION_COOKIE } from '@/lib/session';

// Server-side base URL: the API is reached container-to-container or over
// loopback. NEXT_PUBLIC_API_BASE_URL is only the browser fallback.
const DEFAULT_API_BASE_URL = 'http://localhost:21501';

/** apiBaseUrl is the API origin every server-side call uses. */
export function apiBaseUrl(): string {
  return (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).replace(/\/$/, '');
}

/**
 * Server-side API client. Server Components and Server Actions use this so the
 * browser never needs a CORS-enabled direct API call for reads and mutations.
 *
 * The session token lives in an httpOnly cookie of the web app and is forwarded to
 * the API as a Cookie header; the browser never holds or sends it (ADR 0008).
 */
export function createServerApiClient(): ApiClient {
  const withSession: typeof fetch = async (input, init) => {
    const token = await getSessionToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
    }
    return fetch(input, { ...init, headers });
  };

  return createApiClient(apiBaseUrl(), withSession);
}

/**
 * fetchApiWithSession calls the API and hands back the raw response, for the few endpoints
 * that are not JSON (the CSV export streams a file). Everything else should go through the
 * typed client.
 */
export async function fetchApiWithSession(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
  }
  return fetch(`${apiBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
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
        return 'Không tìm thấy dữ liệu được yêu cầu. Có thể nó vừa bị xoá.';
      case 'conflict':
        return 'Dữ liệu này đã tồn tại. Chọn tên khác.';
      case 'in_use':
        return 'Không thể thực hiện: dữ liệu này vẫn đang được dùng ở nơi khác.';
      case 'service_unavailable':
        return 'Hệ thống đang bận. Thử lại sau ít phút.';
      default:
        // The screen speaks to the person doing the work: no status codes, no internals.
        return 'Hệ thống không xử lý được yêu cầu này. Thử lại sau ít phút.';
    }
  }
  return 'Không gọi được máy chủ. Thử lại sau ít phút.';
}
