/**
 * The advanced switch: a cookie of the browser, behind a server action, exactly like the
 * theme and the dashboard layout (ADR 0004). It only ever turns *on* extra information for an
 * administrator — it never grants access, which stays with the API (ADR 0008).
 */
export const ADVANCED_COOKIE = 'opvaryn.advanced';

export const ADVANCED_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const;

export type AdvancedMode = 'on' | 'off';

/** parseAdvanced reads the cookie value; anything unknown means off. */
export function parseAdvanced(value: string | undefined): AdvancedMode {
  return value === 'on' ? 'on' : 'off';
}

/** toggleAdvanced is the next state of the switch. */
export function toggleAdvanced(current: AdvancedMode): AdvancedMode {
  return current === 'on' ? 'off' : 'on';
}

/** advancedVisible answers the only question the UI asks: show the build/operations info? */
export function advancedVisible(isAdminUser: boolean, mode: AdvancedMode): boolean {
  return isAdminUser && mode === 'on';
}
