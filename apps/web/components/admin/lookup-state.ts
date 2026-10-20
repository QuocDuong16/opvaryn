/** The state the lookup form answers with. */
export interface LookupState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

export const INITIAL_LOOKUP_STATE: LookupState = { status: 'idle' };
