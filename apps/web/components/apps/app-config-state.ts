/** The state the configuration form answers with. */
export interface AppConfigState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

export const INITIAL_APP_CONFIG_STATE: AppConfigState = { status: 'idle' };
