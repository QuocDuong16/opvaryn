import { cookies } from 'next/headers';

import {
  DRAFT_MAX_SERIALIZED,
  parseDraft,
  type WorkflowDraft,
} from '@/components/workflows/definition-draft-model';

/**
 * A workflow draft is one browser's unfinished arrangement of a process graph (ADR 0013).
 * It lives in an httpOnly cookie behind a server action, like the dashboard layout
 * (ADR 0004): it is user configuration that needs no table, the engine never reads it, and
 * the browser cannot tamper with it silently.
 *
 * The cookie is per definition: editing two processes keeps two drafts.
 */
export const DRAFT_COOKIE_PREFIX = 'opvaryn.workflow_draft.';

export const DRAFT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 90,
} as const;

/** draftCookieName is the cookie that holds one definition's draft. */
export function draftCookieName(definitionKey: string): string {
  // Definition keys are already restricted to [a-z0-9_], so they are safe in a name.
  return `${DRAFT_COOKIE_PREFIX}${definitionKey}`;
}

/**
 * getWorkflowDraft reads the saved draft, or null when there is none (or it is unusable,
 * in which case the caller falls back to the published graph rather than showing nothing).
 */
export async function getWorkflowDraft(definitionKey: string): Promise<WorkflowDraft | null> {
  const store = await cookies();
  const raw = store.get(draftCookieName(definitionKey))?.value;
  if (raw === undefined || raw.length > DRAFT_MAX_SERIALIZED) {
    return null;
  }
  return parseDraft(raw);
}
