# apps/web — Next.js admin shell

## Routes and shell

- Routes follow the demo nav defined once in `app/nav.ts` (`NAV_ITEMS`, `navItemFor`):
  `/` overview, `/objects`, `/forms`, `/workflows`, `/tasks`, `/analytics`, `/apps`, `/settings`.
  Only `/` and `/objects` have real behavior; the rest render
  `components/ui/module-placeholder.tsx` with an explicit stage label.
- Root layout (`app/layout.tsx`) reads the theme cookie server-side, sets `data-theme` on
  `<html>` (no flash, no client theme script), loads Inter via `next/font`, and mounts
  `Sidebar` (lg+) / `Topbar` (breadcrumb + compact mobile nav + theme toggle).
- Theme plumbing: `lib/theme.ts` (`Theme`, `getTheme`, `nextTheme`, cookie `opvaryn.theme`,
  `DEFAULT_THEME = 'dark'`) + server action `app/actions/theme.ts`.
- `components/app-shell/nav.tsx` exports `SidebarNav` (desktop) and `CompactNav` (mobile), both
  client components using `usePathname`; `breadcrumb.tsx` resolves the current area via
  `navItemFor`.

## Data access

- `lib/api/server.ts`: `createServerApiClient()` (base URL `API_BASE_URL` ??
  `NEXT_PUBLIC_API_BASE_URL` ?? `http://localhost:21501`) and `describeApiError()` mapping stable
  error codes to Vietnamese user messages. The client and all API types come from
  `@opvaryn/contracts` (generated; regenerate via `make contract-generate`).
- Overview page (`app/page.tsx`) reads `/api/v1/meta` + `/readyz` in parallel and must stay
  failure-tolerant (try/catch → dependency chips + setup hint, never a crash when the API is off).
- Objects vertical slice: server page fetch → `components/objects/object-list.tsx` (deterministic
  `Intl.DateTimeFormat` with explicit `timeZone: 'Asia/Ho_Chi_Minh'`); create form is a client
  component (`useActionState`, `useFormStatus`) → `app/objects/actions.ts` server action →
  API → `revalidatePath('/objects')`.

## Styling and UI primitives

- Tokens: two layers in `app/globals.css` — raw CSS variables under `[data-theme='dark'|'light']`,
  then `@theme inline` mapping them to Tailwind color utilities. Dark is the default. Add tokens
  there; never hard-code hex in components.
- `components/ui/`: `status-badge.tsx` (mandatory `live`/`mock`/`concept` labeling with tooltips),
  `page-header.tsx` (eyebrow/title/lead/aside rhythm), `card.tsx`
  (`Card`/`CardTitle`/`CardDescription`), `module-placeholder.tsx` (planned scope + honest stage
  for not-yet-built modules).
- Icons: `@phosphor-icons/react` — server components MUST import
  `@phosphor-icons/react/dist/ssr`.

## Config and tests

- Dev/start ports are hardcoded in `apps/web/package.json` (`next dev --port 21500`).
  `next.config.ts` only sets `transpilePackages: ['@opvaryn/contracts']`.
- Tests in `apps/web/__tests__/` (`setup.ts` imports `@testing-library/jest-dom/vitest`,
  `shell.test.tsx` covers badge labels and nav integrity). Vitest aliases `@` → app root and sets
  `environment: 'jsdom'`; coverage has no thresholds yet — the gate arms when demo features land.
