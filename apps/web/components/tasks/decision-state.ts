/**
 * Shared state for a task decision. It lives outside the server action module
 * because a 'use server' file may only export async functions.
 */
export interface DecisionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success; also remounts the form so the next decision starts blank. */
  decided?: string;
}

export const INITIAL_DECISION_STATE: DecisionState = { status: 'idle' };
