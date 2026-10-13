import type { components } from './generated/schema';

/** A business entity kind configured by an administrator. */
export type BusinessObject = components['schemas']['BusinessObject'];
/** One configurable field on a business object. */
export type FieldDefinition = components['schemas']['FieldDefinition'];
/** Field kinds supported by the form builder. */
export type FieldType = components['schemas']['FieldType'];
/** One selectable option of a `select` field. */
export type FieldOption = components['schemas']['FieldOption'];
/** Request body for creating a business object definition. */
export type CreateBusinessObjectRequest = components['schemas']['CreateBusinessObjectRequest'];
/** One stored record of a business object. */
export type ObjectRecord = components['schemas']['ObjectRecord'];
/** Request body for creating a business object record. */
export type CreateObjectRecordRequest = components['schemas']['CreateObjectRecordRequest'];
/** Stable error envelope returned by every failing endpoint. */
export type ErrorResponse = components['schemas']['ErrorResponse'];
/** Build identity reported by the API. */
export type Meta = components['schemas']['Meta'];
/** Liveness/readiness answer. `ok` or `unavailable`. */
export type HealthStatus = components['schemas']['HealthStatus'];

export interface ApiClient {
  getMeta(): Promise<Meta>;
  getReadiness(): Promise<HealthStatus>;
  listBusinessObjects(): Promise<BusinessObject[]>;
  getBusinessObject(key: string): Promise<BusinessObject>;
  createBusinessObject(input: CreateBusinessObjectRequest): Promise<BusinessObject>;
  listObjectRecords(key: string): Promise<ObjectRecord[]>;
  createObjectRecord(key: string, input: CreateObjectRecordRequest): Promise<ObjectRecord>;
}

/** ApiError carries the HTTP status and the stable machine-readable error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Creates a typed client for the OPVARYN API.
 *
 * Every call goes through this client so error envelopes are decoded in one
 * place; callers switch on stable error codes, never on messages.
 */
export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiClient {
  const base = baseUrl.replace(/\/$/, '');

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const error = payload as Partial<ErrorResponse> | undefined;
      throw new ApiError(
        response.status,
        error?.code ?? 'unknown',
        error?.message ?? `request failed with status ${response.status}`,
      );
    }
    return payload as T;
  }

  return {
    getMeta: () => request<Meta>('/api/v1/meta'),

    // Readiness answers from the body, not the status code: 503 with
    // status=unavailable is a valid answer, not a transport error.
    async getReadiness() {
      const response = await fetchImpl(`${base}/readyz`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => undefined)) as
        | Partial<HealthStatus>
        | undefined;
      if (payload?.status === 'ok' || payload?.status === 'unavailable') {
        return { status: payload.status };
      }
      throw new ApiError(response.status, 'unknown', 'readiness probe returned an unexpected body');
    },

    async listBusinessObjects() {
      const payload = await request<{ data: BusinessObject[] }>('/api/v1/business-objects');
      return payload.data;
    },

    getBusinessObject: (key) =>
      request<BusinessObject>(`/api/v1/business-objects/${encodeURIComponent(key)}`),

    createBusinessObject: (input) =>
      request<BusinessObject>('/api/v1/business-objects', { method: 'POST', body: input }),

    async listObjectRecords(key) {
      const payload = await request<{ data: ObjectRecord[] }>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/records`,
      );
      return payload.data;
    },

    createObjectRecord: (key, input) =>
      request<ObjectRecord>(`/api/v1/business-objects/${encodeURIComponent(key)}/records`, {
        method: 'POST',
        body: input,
      }),
  };
}
