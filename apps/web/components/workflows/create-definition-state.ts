/**
 * Shared state for creating a process definition. It lives outside the server action
 * module because a 'use server' file may only export async functions.
 */
export interface CreateDefinitionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success; also remounts the editor so the next definition starts blank. */
  createdKey?: string;
}

export const INITIAL_CREATE_DEFINITION_STATE: CreateDefinitionState = { status: 'idle' };
