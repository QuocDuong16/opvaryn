/**
 * Shared form state for creating a business object. It lives outside the server
 * action module because a 'use server' file may only export async functions.
 */
export interface CreateObjectState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success so the UI can link to the new object. */
  createdKey?: string;
}

export const INITIAL_CREATE_OBJECT_STATE: CreateObjectState = { status: 'idle' };
