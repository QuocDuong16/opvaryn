/** The state every administration form action answers with. */
export interface AdminActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set after creating a person, so the form can link to their edit screen. */
  userId?: string;
}

export const INITIAL_ADMIN_STATE: AdminActionState = { status: 'idle' };
