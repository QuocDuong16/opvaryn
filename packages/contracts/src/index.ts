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
/** Request body for publishing the next version of a definition. */
export type UpdateBusinessObjectRequest = components['schemas']['UpdateBusinessObjectRequest'];
/** One immutable published snapshot of a definition. */
export type BusinessObjectVersion = components['schemas']['BusinessObjectVersion'];
/** One stored record of a business object. */
export type ObjectRecord = components['schemas']['ObjectRecord'];
/** Request body for creating a business object record. */
export type CreateObjectRecordRequest = components['schemas']['CreateObjectRecordRequest'];
/** One instance of a process definition, bound to the version it started with. */
export type ProcessInstance = components['schemas']['ProcessInstance'];
/** One human task of an instance. */
export type ProcessTask = components['schemas']['ProcessTask'];
/** One append-only audit event of an instance. */
export type ProcessEvent = components['schemas']['ProcessEvent'];
/** An instance together with its tasks and its event log. */
export type ProcessInstanceView = components['schemas']['ProcessInstanceView'];
/** One instance as a list row: the instance plus the tasks still waiting. */
export type ProcessInstanceSummary = components['schemas']['ProcessInstanceSummary'];
/** Request body for starting an instance from a stored record. */
export type StartProcessInstanceRequest = components['schemas']['StartProcessInstanceRequest'];
/** A process definition with the newest published graph. */
export type ProcessDefinition = components['schemas']['ProcessDefinition'];
/** One immutable published graph of a process definition. */
export type ProcessDefinitionVersion = components['schemas']['ProcessDefinitionVersion'];
/** One node of a process graph. */
export type ProcessNode = components['schemas']['ProcessNode'];
/** One edge of a process graph. */
export type ProcessEdge = components['schemas']['ProcessEdge'];
/** The JSON condition a condition node carries (D04). */
export type ProcessCondition = components['schemas']['ProcessCondition'];
/** Request body for creating a process definition and publishing version 1. */
export type CreateProcessDefinitionRequest =
  components['schemas']['CreateProcessDefinitionRequest'];
/** Request body for publishing the next version of a process definition. */
export type UpdateProcessDefinitionRequest =
  components['schemas']['UpdateProcessDefinitionRequest'];
/** A role as a screen shows it: the key the engine compares, and its display name. */
export type RoleEntry = components['schemas']['RoleEntry'];

/** One open task with the instance it belongs to. */
export type InboxItem = components['schemas']['InboxItem'];
/** Request body for deciding one human task. */
export type DecideProcessTaskRequest = components['schemas']['DecideProcessTaskRequest'];
/** A saved metric: what to count or measure, on which object (D06). */
export type MetricDefinition = components['schemas']['MetricDefinition'];
/** What a metric currently answers, scoped to the caller. */
export type MetricResult = components['schemas']['MetricResult'];
/** One group of a grouped metric. */
export type MetricBucket = components['schemas']['MetricBucket'];
/** Request body for creating a metric. */
export type CreateMetricDefinitionRequest = components['schemas']['CreateMetricDefinitionRequest'];
/** Request body for replacing a metric definition. */
export type UpdateMetricDefinitionRequest = components['schemas']['UpdateMetricDefinitionRequest'];
/** The engine's operational read model over a window (ADR 0011). */
export type ProcessMetricsOverview = components['schemas']['ProcessMetricsOverview'];
/** One duration summary: average, median and how many samples. */
export type DurationStats = components['schemas']['DurationStats'];
/** One outbound webhook delivery (ADR 0012). */
export type WebhookDelivery = components['schemas']['WebhookDelivery'];
/** The delivery log plus whether the integration is on. */
export type WebhookDeliveryList = components['schemas']['WebhookDeliveryList'];
/** Stable error envelope returned by every failing endpoint. */
export type ErrorResponse = components['schemas']['ErrorResponse'];
/** The signed-in user with roles and department. */
export type Me = components['schemas']['Me'];
/** Build identity reported by the API. */
export type Meta = components['schemas']['Meta'];
/** Liveness/readiness answer. `ok` or `unavailable`. */
export type HealthStatus = components['schemas']['HealthStatus'];

export interface ApiClient {
  getMeta(): Promise<Meta>;
  getMe(): Promise<Me>;
  getReadiness(): Promise<HealthStatus>;
  listBusinessObjects(): Promise<BusinessObject[]>;
  getBusinessObject(key: string): Promise<BusinessObject>;
  createBusinessObject(input: CreateBusinessObjectRequest): Promise<BusinessObject>;
  updateBusinessObject(key: string, input: UpdateBusinessObjectRequest): Promise<BusinessObject>;
  listBusinessObjectVersions(key: string): Promise<BusinessObjectVersion[]>;
  listObjectRecords(key: string): Promise<ObjectRecord[]>;
  createObjectRecord(key: string, input: CreateObjectRecordRequest): Promise<ObjectRecord>;
  listProcessDefinitions(): Promise<ProcessDefinition[]>;
  getProcessDefinition(key: string): Promise<ProcessDefinition>;
  createProcessDefinition(input: CreateProcessDefinitionRequest): Promise<ProcessDefinition>;
  updateProcessDefinition(
    key: string,
    input: UpdateProcessDefinitionRequest,
  ): Promise<ProcessDefinition>;
  listProcessDefinitionVersions(key: string): Promise<ProcessDefinitionVersion[]>;
  listInboxTasks(): Promise<InboxItem[]>;
  /** Role keys held by at least one user: what the workflow designer offers. */
  listRoles(): Promise<RoleEntry[]>;
  listMetrics(): Promise<MetricDefinition[]>;
  getMetric(key: string): Promise<MetricDefinition>;
  createMetric(input: CreateMetricDefinitionRequest): Promise<MetricDefinition>;
  updateMetric(key: string, input: UpdateMetricDefinitionRequest): Promise<MetricDefinition>;
  getMetricResult(key: string): Promise<MetricResult>;
  getProcessMetrics(filter?: {
    definitionKey?: string;
    windowDays?: number;
  }): Promise<ProcessMetricsOverview>;
  listWebhookDeliveries(limit?: number): Promise<WebhookDeliveryList>;
  getProcessInstance(instanceId: string): Promise<ProcessInstanceView>;
  listProcessInstances(filter?: {
    objectKey?: string;
    definitionKey?: string;
  }): Promise<ProcessInstanceSummary[]>;
  startProcessInstance(input: StartProcessInstanceRequest): Promise<ProcessInstanceView>;
  decideProcessTask(
    instanceId: string,
    taskId: string,
    input: DecideProcessTaskRequest,
  ): Promise<ProcessInstanceView>;
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
  method?: 'GET' | 'POST' | 'PUT';
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

    getMe: () => request<Me>('/api/v1/me'),

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

    updateBusinessObject: (key, input) =>
      request<BusinessObject>(`/api/v1/business-objects/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: input,
      }),

    async listBusinessObjectVersions(key) {
      const payload = await request<{ data: BusinessObjectVersion[] }>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/versions`,
      );
      return payload.data;
    },

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

    async listInboxTasks() {
      const payload = await request<{ data: InboxItem[] }>('/api/v1/tasks');
      return payload.data;
    },

    async listRoles() {
      const payload = await request<{ data: RoleEntry[] }>('/api/v1/roles');
      return payload.data;
    },

    async listMetrics() {
      const payload = await request<{ data: MetricDefinition[] }>('/api/v1/metrics');
      return payload.data;
    },

    getMetric: (key) => request<MetricDefinition>(`/api/v1/metrics/${encodeURIComponent(key)}`),

    createMetric: (input) =>
      request<MetricDefinition>('/api/v1/metrics', { method: 'POST', body: input }),

    updateMetric: (key, input) =>
      request<MetricDefinition>(`/api/v1/metrics/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: input,
      }),

    getMetricResult: (key) =>
      request<MetricResult>(`/api/v1/metrics/${encodeURIComponent(key)}/result`),

    listWebhookDeliveries: (limit) =>
      request<WebhookDeliveryList>(
        `/api/v1/webhook-deliveries${limit ? `?limit=${limit}` : ''}`,
      ),

    getProcessMetrics: (filter = {}) => {
      const params = new URLSearchParams();
      if (filter.definitionKey) {
        params.set('definitionKey', filter.definitionKey);
      }
      if (filter.windowDays) {
        params.set('windowDays', String(filter.windowDays));
      }
      const query = params.size > 0 ? `?${params.toString()}` : '';
      return request<ProcessMetricsOverview>(`/api/v1/process-metrics${query}`);
    },

    async listProcessDefinitions() {
      const payload = await request<{ data: ProcessDefinition[] }>('/api/v1/process-definitions');
      return payload.data;
    },

    getProcessDefinition: (key) =>
      request<ProcessDefinition>(`/api/v1/process-definitions/${encodeURIComponent(key)}`),

    createProcessDefinition: (input) =>
      request<ProcessDefinition>('/api/v1/process-definitions', { method: 'POST', body: input }),

    updateProcessDefinition: (key, input) =>
      request<ProcessDefinition>(`/api/v1/process-definitions/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: input,
      }),

    async listProcessDefinitionVersions(key) {
      const payload = await request<{ data: ProcessDefinitionVersion[] }>(
        `/api/v1/process-definitions/${encodeURIComponent(key)}/versions`,
      );
      return payload.data;
    },

    getProcessInstance: (instanceId) =>
      request<ProcessInstanceView>(`/api/v1/process-instances/${encodeURIComponent(instanceId)}`),

    async listProcessInstances(filter = {}) {
      const params = new URLSearchParams();
      if (filter.objectKey) {
        params.set('objectKey', filter.objectKey);
      }
      if (filter.definitionKey) {
        params.set('definitionKey', filter.definitionKey);
      }
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const payload = await request<{ data: ProcessInstanceSummary[] }>(
        `/api/v1/process-instances${query}`,
      );
      return payload.data;
    },

    startProcessInstance: (input) =>
      request<ProcessInstanceView>('/api/v1/process-instances', { method: 'POST', body: input }),

    decideProcessTask: (instanceId, taskId, input) =>
      request<ProcessInstanceView>(
        `/api/v1/process-instances/${encodeURIComponent(instanceId)}/tasks/${encodeURIComponent(taskId)}/decisions`,
        { method: 'POST', body: input },
      ),
  };
}
