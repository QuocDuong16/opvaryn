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
/** One account as the administration screen shows it. */
export type AdminUser = components['schemas']['AdminUser'];
/** Whether an account may sign in. */
export type AdminUserStatus = components['schemas']['AdminUserStatus'];
/** Request body for creating one account. */
export type CreateAdminUserRequest = components['schemas']['CreateAdminUserRequest'];
/** Request body for replacing an account's profile and roles. */
export type UpdateAdminUserRequest = components['schemas']['UpdateAdminUserRequest'];
/** Request body for replacing an account's password. */
export type SetAdminUserPasswordRequest = components['schemas']['SetAdminUserPasswordRequest'];
/** One department with its head count. */
export type AdminDepartment = components['schemas']['AdminDepartment'];
/** Request body for adding a department. */
export type CreateAdminDepartmentRequest = components['schemas']['CreateAdminDepartmentRequest'];
/** Request body for renaming a department. */
export type UpdateAdminDepartmentRequest = components['schemas']['UpdateAdminDepartmentRequest'];
/** One role of the catalogue with its holder count. */
export type AdminRole = components['schemas']['AdminRole'];
/** Request body for adding a role. */
export type CreateAdminRoleRequest = components['schemas']['CreateAdminRoleRequest'];
/** Request body for renaming a role. */
export type UpdateAdminRoleRequest = components['schemas']['UpdateAdminRoleRequest'];

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
export type AppConfig = components['schemas']['AppConfig'];
export type WorkPolicy = components['schemas']['WorkPolicy'];
export type LookupField = components['schemas']['LookupField'];
export type LookupOption = components['schemas']['LookupOption'];
/** One queued write-back of a record to the system its options come from (ADR 0037). */
export type LookupWriteback = components['schemas']['LookupWriteback'];
export type FieldColumn = components['schemas']['FieldColumn'];
export type FieldCondition = components['schemas']['FieldCondition'];
export type WorkingHour = components['schemas']['WorkingHour'];
export type WorkingHours = components['schemas']['WorkingHours'];
export type TwoFactorStatus = components['schemas']['TwoFactorStatus'];
export type TwoFactorSetup = components['schemas']['TwoFactorSetup'];
export type TwoFactorEnabled = components['schemas']['TwoFactorEnabled'];
/** Request body for changing the signed-in user's own password. */
export type ChangeMyPasswordRequest = components['schemas']['ChangeMyPasswordRequest'];
/** One entry of a record's append-only history. */
export type RecordHistoryEntry = components['schemas']['RecordHistoryEntry'];
/** One changed field in a history entry, already rendered for a person. */
export type RecordHistoryChange = components['schemas']['RecordHistoryChange'];
/** Build identity reported by the API. */
export type Meta = components['schemas']['Meta'];
/** Liveness/readiness answer. `ok` or `unavailable`. */
export type HealthStatus = components['schemas']['HealthStatus'];

/**
 * One page of a list, with the total behind it: a screen paginates with this instead of
 * asking for every row. The API applies the page; the browser never slices a full table.
 */
export interface Paged<T> {
  data: T[];
  total: number;
}

/** Query a list endpoint accepts: a search term and one page. */
export interface PageQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

/** pageParams turns a query into the URL parameters the API expects. */
export function pageParams(query: PageQuery = {}): string {
  const params = new URLSearchParams();
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.offset !== undefined) {
    params.set('offset', String(query.offset));
  }
  return params.size > 0 ? `?${params.toString()}` : '';
}

export interface ApiClient {
  getMeta(): Promise<Meta>;
  getMe(): Promise<Me>;
  changeMyPassword(input: ChangeMyPasswordRequest): Promise<void>;
  getReadiness(): Promise<HealthStatus>;
  listBusinessObjects(query?: PageQuery): Promise<Paged<BusinessObject>>;
  getBusinessObject(key: string): Promise<BusinessObject>;
  createBusinessObject(input: CreateBusinessObjectRequest): Promise<BusinessObject>;
  updateBusinessObject(key: string, input: UpdateBusinessObjectRequest): Promise<BusinessObject>;
  listBusinessObjectVersions(key: string): Promise<BusinessObjectVersion[]>;
  listObjectRecords(key: string, query?: PageQuery): Promise<Paged<ObjectRecord>>;
  createObjectRecord(key: string, input: CreateObjectRecordRequest): Promise<ObjectRecord>;
  getObjectRecord(key: string, recordId: string): Promise<ObjectRecord>;
  listObjectRecordHistory(
    key: string,
    recordId: string,
    query?: PageQuery,
  ): Promise<Paged<RecordHistoryEntry>>;
  updateObjectRecord(
    key: string,
    recordId: string,
    input: CreateObjectRecordRequest,
  ): Promise<ObjectRecord>;
  deleteObjectRecord(key: string, recordId: string): Promise<void>;
  listProcessDefinitions(query?: PageQuery): Promise<Paged<ProcessDefinition>>;
  getProcessDefinition(key: string): Promise<ProcessDefinition>;
  createProcessDefinition(input: CreateProcessDefinitionRequest): Promise<ProcessDefinition>;
  updateProcessDefinition(
    key: string,
    input: UpdateProcessDefinitionRequest,
  ): Promise<ProcessDefinition>;
  listProcessDefinitionVersions(key: string): Promise<ProcessDefinitionVersion[]>;
  listInboxTasks(query?: PageQuery): Promise<Paged<InboxItem>>;
  /** Role keys held by at least one user: what the workflow designer offers. */
  listRoles(query?: PageQuery): Promise<Paged<RoleEntry>>;
  /** Whether the signed-in account has the second step of a sign-in switched on (ADR 0030). */
  getMyTwoFactor(): Promise<TwoFactorStatus>;
  /** Makes a fresh shared secret for the authenticator app. */
  setupMyTwoFactor(): Promise<TwoFactorSetup>;
  /** Switches the second step on and hands out the recovery codes. */
  enableMyTwoFactor(code: string): Promise<TwoFactorEnabled>;
  /** Switches the second step off. */
  disableMyTwoFactor(code: string): Promise<void>;
  /** The external options of the fields that take them from another system (ADR 0034). */
  listLookups(objectKey: string): Promise<{ data: LookupField[] }>;
  /** Points one field at an external catalogue; an empty address removes the source. */
  saveLookupSource(
    objectKey: string,
    fieldKey: string,
    config: { url: string; writeUrl?: string; writeFields?: string[] },
  ): Promise<void>;
  /** The log of what was written back to the outside systems (ADR 0037). */
  listLookupWritebacks(query?: PageQuery): Promise<Paged<LookupWriteback>>;
  /** The policy of one kind of work: the default deadline, priority and escalation. */
  getWorkPolicy(objectKey: string): Promise<WorkPolicy>;
  /** Stores the policy of one kind of work. */
  saveWorkPolicy(
    objectKey: string,
    policy: {
      defaultDueHours: number;
      defaultPriority: string;
      escalationRole: string;
    },
  ): Promise<WorkPolicy>;
  /** The configuration of the application view (ADR 0033). */
  getAppConfig(objectKey: string): Promise<AppConfig>;
  /** Stores the configuration of the application view. */
  saveAppConfig(
    objectKey: string,
    config: { name: string; kanbanField: string; listColumns: readonly string[] },
  ): Promise<AppConfig>;
  /** The organisation's working calendar (ADR 0031). */
  listWorkingHours(): Promise<WorkingHours>;
  /** Replaces the working calendar as a whole. */
  replaceWorkingHours(hours: readonly WorkingHour[]): Promise<void>;
  /** Whether one account has the second step switched on. */
  getAdminUserTwoFactor(userId: string): Promise<TwoFactorStatus>;
  /** Turns the second step off for one account: the way back in when the device was lost. */
  resetAdminUserTwoFactor(userId: string): Promise<void>;
  listAdminUsers(query?: PageQuery): Promise<Paged<AdminUser>>;
  getAdminUser(userId: string): Promise<AdminUser>;
  createAdminUser(input: CreateAdminUserRequest): Promise<AdminUser>;
  updateAdminUser(userId: string, input: UpdateAdminUserRequest): Promise<AdminUser>;
  setAdminUserPassword(userId: string, input: SetAdminUserPasswordRequest): Promise<void>;
  revokeAdminUserSessions(userId: string): Promise<void>;
  /** Ends the sign-in cooldown of an account, so the person can sign in again (ADR 0028). */
  unlockAdminUser(userId: string): Promise<void>;
  listAdminDepartments(query?: PageQuery): Promise<Paged<AdminDepartment>>;
  createAdminDepartment(input: CreateAdminDepartmentRequest): Promise<AdminDepartment>;
  updateAdminDepartment(
    key: string,
    input: UpdateAdminDepartmentRequest,
  ): Promise<AdminDepartment>;
  deleteAdminDepartment(key: string): Promise<void>;
  listAdminRoles(query?: PageQuery): Promise<Paged<AdminRole>>;
  createAdminRole(input: CreateAdminRoleRequest): Promise<AdminRole>;
  updateAdminRole(key: string, input: UpdateAdminRoleRequest): Promise<AdminRole>;
  deleteAdminRole(key: string): Promise<void>;
  listMetrics(query?: PageQuery): Promise<Paged<MetricDefinition>>;
  getMetric(key: string): Promise<MetricDefinition>;
  createMetric(input: CreateMetricDefinitionRequest): Promise<MetricDefinition>;
  updateMetric(key: string, input: UpdateMetricDefinitionRequest): Promise<MetricDefinition>;
  getMetricResult(key: string): Promise<MetricResult>;
  getProcessMetrics(filter?: {
    definitionKey?: string;
    windowDays?: number;
  }): Promise<ProcessMetricsOverview>;
  listWebhookDeliveries(query?: PageQuery): Promise<WebhookDeliveryList>;
  getProcessInstance(instanceId: string): Promise<ProcessInstanceView>;
  listProcessInstances(
    filter?: { objectKey?: string; definitionKey?: string; recordId?: string },
    query?: PageQuery,
  ): Promise<Paged<ProcessInstanceSummary>>;
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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

/**
 * How long any one API call may take. A server that accepts the connection and then stops
 * answering must not hold a page (or a server action) open forever; the caller gets the same
 * "could not reach the API" answer it gets when the API is down.
 */
export const API_TIMEOUT_MS = 15_000;

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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
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

    changeMyPassword: (input) =>
      request<void>('/api/v1/me/password', { method: 'POST', body: input }),

    // Readiness answers from the body, not the status code: 503 with
    // status=unavailable is a valid answer, not a transport error.
    async getReadiness() {
      const response = await fetchImpl(`${base}/readyz`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => undefined)) as
        | Partial<HealthStatus>
        | undefined;
      if (payload?.status === 'ok' || payload?.status === 'unavailable') {
        return { status: payload.status };
      }
      throw new ApiError(response.status, 'unknown', 'readiness probe returned an unexpected body');
    },

    async listBusinessObjects(query) {
      return request<Paged<BusinessObject>>(`/api/v1/business-objects${pageParams(query)}`);
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

    async listObjectRecords(key, query) {
      return request<Paged<ObjectRecord>>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/records${pageParams(query)}`,
      );
    },

    createObjectRecord: (key, input) =>
      request<ObjectRecord>(`/api/v1/business-objects/${encodeURIComponent(key)}/records`, {
        method: 'POST',
        body: input,
      }),

    getObjectRecord: (key, recordId) =>
      request<ObjectRecord>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/records/${encodeURIComponent(recordId)}`,
      ),

    async listObjectRecordHistory(key, recordId, query) {
      return request<Paged<RecordHistoryEntry>>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/records/${encodeURIComponent(recordId)}/history${pageParams(query)}`,
      );
    },

    updateObjectRecord: (key, recordId, input) =>
      request<ObjectRecord>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/records/${encodeURIComponent(recordId)}`,
        { method: 'PUT', body: input },
      ),

    deleteObjectRecord: (key, recordId) =>
      request<void>(
        `/api/v1/business-objects/${encodeURIComponent(key)}/records/${encodeURIComponent(recordId)}`,
        { method: 'DELETE' },
      ),

    async listInboxTasks(query) {
      return request<Paged<InboxItem>>(`/api/v1/tasks${pageParams(query)}`);
    },

    getMyTwoFactor: () => request<TwoFactorStatus>('/api/v1/me/two-factor'),

    setupMyTwoFactor: () => request<TwoFactorSetup>('/api/v1/me/two-factor', { method: 'POST' }),

    enableMyTwoFactor: (code) =>
      request<TwoFactorEnabled>('/api/v1/me/two-factor/enable', {
        method: 'POST',
        body: { code },
      }),

    disableMyTwoFactor: (code) =>
      request<void>('/api/v1/me/two-factor/disable', {
        method: 'POST',
        body: { code },
      }),

    listLookups: (objectKey) =>
      request<{ data: LookupField[] }>(`/api/v1/lookups/${encodeURIComponent(objectKey)}`),

    saveLookupSource: (objectKey, fieldKey, config) =>
      request<void>(
        `/api/v1/admin/lookups/${encodeURIComponent(objectKey)}/${encodeURIComponent(fieldKey)}`,
        { method: 'PUT', body: config },
      ),

    listLookupWritebacks: (query) =>
      request<Paged<LookupWriteback>>(
        `/api/v1/admin/lookups/writebacks${pageParams(query)}`,
      ),

    getWorkPolicy: (objectKey) =>
      request<WorkPolicy>(`/api/v1/admin/work-policies/${encodeURIComponent(objectKey)}`),

    saveWorkPolicy: (objectKey, policy) =>
      request<WorkPolicy>(`/api/v1/admin/work-policies/${encodeURIComponent(objectKey)}`, {
        method: 'PUT',
        body: policy,
      }),

    getAppConfig: (objectKey) =>
      request<AppConfig>(`/api/v1/app-configs/${encodeURIComponent(objectKey)}`),

    saveAppConfig: (objectKey, config) =>
      request<AppConfig>(`/api/v1/app-configs/${encodeURIComponent(objectKey)}`, {
        method: 'PUT',
        body: config,
      }),

    listWorkingHours: () => request<WorkingHours>('/api/v1/admin/working-hours'),

    replaceWorkingHours: (hours) =>
      request<void>('/api/v1/admin/working-hours', {
        method: 'PUT',
        body: { data: hours },
      }),

    getAdminUserTwoFactor: (userId) =>
      request<TwoFactorStatus>(`/api/v1/admin/users/${encodeURIComponent(userId)}/two-factor`),

    resetAdminUserTwoFactor: (userId) =>
      request<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/two-factor/reset`, {
        method: 'POST',
      }),

    async listRoles(query) {
      return request<Paged<RoleEntry>>(`/api/v1/roles${pageParams(query)}`);
    },

    async listAdminUsers(query) {
      return request<Paged<AdminUser>>(`/api/v1/admin/users${pageParams(query)}`);
    },

    getAdminUser: (userId) =>
      request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`),

    createAdminUser: (input) =>
      request<AdminUser>('/api/v1/admin/users', { method: 'POST', body: input }),

    updateAdminUser: (userId, input) =>
      request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        body: input,
      }),

    setAdminUserPassword: (userId, input) =>
      request<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/password`, {
        method: 'POST',
        body: input,
      }),

    revokeAdminUserSessions: (userId) =>
      request<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/sessions`, {
        method: 'DELETE',
      }),

    unlockAdminUser: (userId) =>
      request<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/unlock`, {
        method: 'POST',
      }),

    async listAdminDepartments(query) {
      return request<Paged<AdminDepartment>>(`/api/v1/admin/departments${pageParams(query)}`);
    },

    createAdminDepartment: (input) =>
      request<AdminDepartment>('/api/v1/admin/departments', { method: 'POST', body: input }),

    updateAdminDepartment: (key, input) =>
      request<AdminDepartment>(`/api/v1/admin/departments/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: input,
      }),

    deleteAdminDepartment: (key) =>
      request<void>(`/api/v1/admin/departments/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }),

    async listAdminRoles(query) {
      return request<Paged<AdminRole>>(`/api/v1/admin/roles${pageParams(query)}`);
    },

    createAdminRole: (input) =>
      request<AdminRole>('/api/v1/admin/roles', { method: 'POST', body: input }),

    updateAdminRole: (key, input) =>
      request<AdminRole>(`/api/v1/admin/roles/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: input,
      }),

    deleteAdminRole: (key) =>
      request<void>(`/api/v1/admin/roles/${encodeURIComponent(key)}`, { method: 'DELETE' }),

    async listMetrics(query) {
      return request<Paged<MetricDefinition>>(`/api/v1/metrics${pageParams(query)}`);
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

    listWebhookDeliveries: (query) =>
      request<WebhookDeliveryList>(`/api/v1/webhook-deliveries${pageParams(query)}`),

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

    async listProcessDefinitions(query) {
      return request<Paged<ProcessDefinition>>(`/api/v1/process-definitions${pageParams(query)}`);
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

    async listProcessInstances(filter = {}, query) {
      const params = new URLSearchParams(pageParams(query).replace(/^\?/, ''));
      if (filter.objectKey) {
        params.set('objectKey', filter.objectKey);
      }
      if (filter.definitionKey) {
        params.set('definitionKey', filter.definitionKey);
      }
      if (filter.recordId) {
        params.set('recordId', filter.recordId);
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return request<Paged<ProcessInstanceSummary>>(`/api/v1/process-instances${suffix}`);
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
