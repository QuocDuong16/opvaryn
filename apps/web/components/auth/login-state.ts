/**
 * Shared state for the sign-in form. It lives outside the 'use server' module
 * because such a file may only export async functions.
 */
export interface LoginState {
  status: 'idle' | 'error';
  message?: string;
  /**
   * True when the password was right and the account asks for a code from its
   * authenticator app (ADR 0030). The form then shows the field.
   */
  twoFactorRequired?: boolean;
}

export const INITIAL_LOGIN_STATE: LoginState = { status: 'idle' };
