import { ApiError, createApiClient, type ApiClient } from '@opvaryn/contracts';

// Server-side base URL: the API is reached container-to-container or over
// loopback. NEXT_PUBLIC_API_BASE_URL is only the browser fallback.
const DEFAULT_API_BASE_URL = 'http://localhost:21501';

/**
 * Server-side API client. Server Components and Server Actions use this so the
 * browser never needs a CORS-enabled direct API call for reads and mutations.
 */
export function createServerApiClient(): ApiClient {
  const baseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  return createApiClient(baseUrl);
}

/** describeApiError turns any thrown value into one user-facing sentence. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid_request':
        return `Dữ liệu chưa hợp lệ: ${error.message}`;
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
