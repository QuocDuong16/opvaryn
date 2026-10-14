/**
 * Shared state for the sign-in form. It lives outside the 'use server' module
 * because such a file may only export async functions.
 */
export interface LoginState {
  status: 'idle' | 'error';
  message?: string;
}

export const INITIAL_LOGIN_STATE: LoginState = { status: 'idle' };
