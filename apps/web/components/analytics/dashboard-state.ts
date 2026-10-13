/**
 * Shared state for saving the dashboard layout. It lives outside the server
 * action module because a 'use server' file may only export async functions.
 */
export interface SaveDashboardState {
  status: 'idle' | 'saved' | 'error';
  message?: string;
}

export const INITIAL_SAVE_DASHBOARD_STATE: SaveDashboardState = { status: 'idle' };
