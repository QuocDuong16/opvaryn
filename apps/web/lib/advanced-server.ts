import { cookies } from 'next/headers';

import { ADVANCED_COOKIE, parseAdvanced, type AdvancedMode } from '@/lib/advanced';

/**
 * Reads the advanced switch from a cookie. It changes what the interface *shows* an
 * administrator, never what they are allowed to do — the API decides that (ADR 0008).
 */
export async function getAdvancedMode(): Promise<AdvancedMode> {
  const store = await cookies();
  return parseAdvanced(store.get(ADVANCED_COOKIE)?.value);
}
