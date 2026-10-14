/**
 * Shared state for saving a workflow draft. It lives outside the server action module
 * because a 'use server' file may only export async functions.
 */
export interface SaveDraftState {
  status: 'idle' | 'saved' | 'error';
  message?: string;
}

export const INITIAL_SAVE_DRAFT_STATE: SaveDraftState = { status: 'idle' };
