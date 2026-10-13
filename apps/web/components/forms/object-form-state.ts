/**
 * Shared form state for creating a business object record. It lives outside the
 * server action module because a 'use server' file may only export async functions.
 */
export interface CreateRecordState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success; also remounts the form so the next entry starts blank. */
  recordId?: string;
}

export const INITIAL_CREATE_RECORD_STATE: CreateRecordState = { status: 'idle' };
