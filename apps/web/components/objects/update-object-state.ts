/**
 * Shared form state for publishing the next version of a definition. It lives
 * outside the server action module because a 'use server' file may only export
 * async functions.
 */
export interface UpdateObjectState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Version number the action published, so the UI can point at it. */
  publishedVersion?: number;
}

export const INITIAL_UPDATE_OBJECT_STATE: UpdateObjectState = { status: 'idle' };
