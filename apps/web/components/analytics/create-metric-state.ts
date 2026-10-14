/**
 * Shared state for creating a metric. It lives outside the server action module because
 * a 'use server' file may only export async functions.
 */
export interface CreateMetricState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success; also remounts the form so the next metric starts blank. */
  createdKey?: string;
}

export const INITIAL_CREATE_METRIC_STATE: CreateMetricState = { status: 'idle' };
