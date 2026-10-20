import { isAdmin } from '@/lib/access';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

/**
 * The answer an administration screen gets when it asks whether the caller may see it.
 * `denied` means the API answered and the person is not an administrator; `error` means the
 * API could not answer at all, which is not the same thing and must not be shown as a 404.
 */
export type AdminAccess = { kind: 'ok' } | { kind: 'denied' } | { kind: 'error'; message: string };

/** loadAdminAccess asks the API who is signed in and whether they hold the admin role. */
export async function loadAdminAccess(): Promise<AdminAccess> {
  try {
    const me = await createServerApiClient().getMe();
    return isAdmin(me.roles) ? { kind: 'ok' } : { kind: 'denied' };
  } catch (cause) {
    return { kind: 'error', message: describeApiError(cause) };
  }
}
