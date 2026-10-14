/**
 * Shared state for publishing the next version of a process definition. It lives
 * outside the server action module because a 'use server' file may only export async
 * functions.
 */
export interface PublishDefinitionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set on success; also remounts the editor. */
  publishedVersion?: number;
}

export const INITIAL_PUBLISH_DEFINITION_STATE: PublishDefinitionState = { status: 'idle' };
