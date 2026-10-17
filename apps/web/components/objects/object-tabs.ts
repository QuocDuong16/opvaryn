/**
 * The three subjects of one data definition (ADR 0020): what it is made of, what has been
 * entered, and what has run on it. A screen shows one at a time — the page had grown into
 * four stacked sections with two side panels, and nobody could find anything in it.
 *
 * The tab lives in the URL (`?tab=records`), so a link can point at one and a reload keeps
 * it (ADR 0017).
 */
export const OBJECT_TABS = ['fields', 'records', 'processes'] as const;

export type ObjectTab = (typeof OBJECT_TABS)[number];

/** The tab a plain `/objects/<key>` opens: the definition itself. */
export const DEFAULT_OBJECT_TAB: ObjectTab = 'fields';

/** resolveObjectTab reads the query parameter; anything unknown opens the default tab. */
export function resolveObjectTab(value: string | undefined | null): ObjectTab {
  return (OBJECT_TABS as readonly string[]).includes(value ?? '')
    ? (value as ObjectTab)
    : DEFAULT_OBJECT_TAB;
}
