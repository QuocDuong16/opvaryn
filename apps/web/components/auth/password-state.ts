/** The state the change-password action answers with. */
export interface PasswordState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

export const INITIAL_PASSWORD_STATE: PasswordState = { status: 'idle' };
