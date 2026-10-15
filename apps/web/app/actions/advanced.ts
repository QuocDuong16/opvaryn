'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { ADVANCED_COOKIE, ADVANCED_COOKIE_OPTIONS, toggleAdvanced } from '@/lib/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';

/**
 * Flips the advanced switch for this browser. Only an administrator is offered the control;
 * the value itself grants nothing, so a forged cookie can only change what that person sees.
 */
export async function toggleAdvancedAction(): Promise<void> {
  const next = toggleAdvanced(await getAdvancedMode());

  const store = await cookies();
  store.set(ADVANCED_COOKIE, next, {
    ...ADVANCED_COOKIE_OPTIONS,
    maxAge: 60 * 60 * 24 * 30,
  });

  revalidatePath('/', 'layout');
}
