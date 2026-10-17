/**
 * Shared state for creating a process definition. It lives outside the server action
 * module because a 'use server' file may only export async functions.
 *
 * There is no success branch: a created definition redirects to its own screen (ADR 0019),
 * so the only thing the form can still have to say is what the service refused.
 */
export interface CreateDefinitionState {
  status: 'idle' | 'error';
  message?: string;
}

export const INITIAL_CREATE_DEFINITION_STATE: CreateDefinitionState = { status: 'idle' };
