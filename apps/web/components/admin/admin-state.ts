/** The state every administration form action answers with. */
export interface AdminActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set after creating a person, so the form can link to their edit screen. */
  userId?: string;
  /** The shared secret of the second step, handed out once (ADR 0030). */
  twoFactorSecret?: string;
  /** The link an authenticator app reads, handed out once. */
  twoFactorUri?: string;
  /** The single-use recovery codes, handed out once. */
  recoveryCodes?: string[];
}

export const INITIAL_ADMIN_STATE: AdminActionState = { status: 'idle' };
