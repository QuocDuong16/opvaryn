/**
 * Shared state for starting a process instance from the web. It lives outside the
 * server action module because a 'use server' file may only export async functions.
 */
export interface StartInstanceState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success; also remounts the form so the next run starts blank. */
  instanceId?: string;
}

export const INITIAL_START_INSTANCE_STATE: StartInstanceState = { status: 'idle' };
