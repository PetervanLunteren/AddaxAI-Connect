# Phone friendly plan

## Why

The app today is desktop only by accident, not by design. A grep for `sm:` / `md:` / `lg:` across the frontend finds only a handful of hits per page on roughly 5,300 lines of page code. `index.html` already has the right viewport meta tag, and `AppLayout.tsx` plus `Sidebar.tsx` already implement a drawer pattern behind the `lg:` breakpoint, so the shell is half there. Most of the work is fixing fixed-width tables, dense filter panels, oversized dialogs, and chart containers that overflow.

## Approach

Two phases. Layout shell first (one PR, half a day), then page by page in order of daily-use pain. Layout-first means every page becomes "passable" on day one; the alternative (polish one page at a time) leaves most pages broken longer.

Breakpoint ladder, follow consistently:
- default (no prefix) is the phone view
- `sm:` ≥ 640 px is large phone landscape and small tablets
- `md:` ≥ 768 px is tablet
- `lg:` ≥ 1024 px is desktop, this is where the sidebar becomes permanent

Stick to these four. Do not invent new breakpoints. The current code already uses `lg:` as the desktop boundary, keep it.

## Current state of the shell

- `services/frontend/index.html` has `width=device-width, initial-scale=1.0, viewport-fit=cover` and a theme color. Good.
- `services/frontend/src/components/layout/AppLayout.tsx` already does `lg:pl-64` and uses `px-4 sm:px-6 lg:px-8` for the content container. Good base.
- `services/frontend/src/components/layout/Sidebar.tsx` already has the drawer with backdrop and the `MobileMenuButton`. Good base.
- `MobileMenuButton` is `fixed top-4 left-4 z-30`, which overlaps the page title on every page on mobile because pages have no top offset reserved for it. This is the biggest visual bug on mobile right now.
- Most page-level code uses fixed widths, side-by-side flex layouts, and tables without horizontal scroll wrappers.

## Phase 1, layout shell (today)

Target: every page is at least navigable and readable on a phone, even if individual widgets are still ugly.

1. Reserve space for the mobile menu button in the page content. Either move it into a slim mobile top bar inside `AppLayout.tsx` so the page flows below it, or add `pt-14 lg:pt-0` to the content container. Top bar is cleaner because it gives a place for a page title later.
2. Stop the fixed bottom block in `Sidebar.tsx` (`absolute bottom-0`) from covering nav items when the viewport is short. Move the project info plus `LastUpdate` into the normal flex column with `mt-auto` so the nav scrolls when needed.
3. Tap target audit on icon-only buttons across `services/frontend/src/components/`. Minimum 40 px square (`p-2` on a 20 px icon, `p-3` on a 16 px icon). Most buttons in the codebase are already close, sweep the obvious offenders.
4. Add a reusable `<TableScroll>` wrapper or just enforce `overflow-x-auto` on every `<table>` parent so wide tables scroll horizontally instead of breaking the page width. Apply to `CamerasPage`, `ProjectUsersPage`, `ExportsPage`, `NotificationsPage`, `DocumentsPage`.
5. Dialog / modal width audit. Any `max-w-[xxxpx]` or `w-[xxxpx]` on a Dialog should become `w-full max-w-md sm:max-w-lg` or similar so dialogs do not overflow on narrow screens.
6. Smoke test. Run the dev server and walk through every route on a phone-width window (375 px). Note remaining issues into Phase 2.

## Phase 2, page by page

Order by daily-use frequency and visible pain. Tackle one page per session, ship a small PR each time.

1. **`Dashboard.tsx` (325 lines).** Charts stack vertically on mobile, KPI cards in a 2-column grid, header buttons wrap. Likely the easiest win, do this first after the shell.
2. **`ImagesPage.tsx` (548 lines).** The hardest page. Filter panel becomes a bottom sheet or a drawer triggered by a "Filters" button. Image grid: keep 2 columns on small phones, 3 on `sm:`, current behaviour on `md:` and up. Detail drawer / lightbox already opens, audit it for full-bleed on mobile.
3. **`DetectionRateMapPage.tsx` (16 lines).** This is a thin page, the real work is in the map component it renders. Map controls need bigger tap targets, legend should collapse to a button on mobile.
4. **`CamerasPage.tsx` (1,098 lines).** Wide table → switch to card list on `<md:`. Action buttons in a kebab menu. The deployment timeline view needs horizontal scroll. Big page, plan one full session for it.
5. **`PerformancePage.tsx` (612 lines).** Charts and metric breakdowns. Same pattern as Dashboard, single column on mobile.
6. **`NotificationsPage.tsx` (491 lines).** Long forms with many toggles. Stack labels above inputs on mobile, group sections in collapsible cards.
7. **`ExportsPage.tsx` (293 lines).** Form plus download list. Form stacks naturally; check that the file list table scrolls.
8. **`DocumentsPage.tsx` (362 lines).** File list, upload button. Mostly already simple, a quick polish pass.
9. **`ProjectUsersPage.tsx` (434 lines).** User table → cards on mobile, role-change dialog audit.
10. **`ProjectsPage.tsx` (177 lines), `AboutPage.tsx` (145 lines), auth pages (`Login`, `Register`, `Forgot`, `Reset`, `VerifyEmail`).** These are short and form-shaped. Quick check, low risk.
11. **`pages/admin/*` and `pages/server/*`.** Admin tooling. Lower priority because admins are usually on desktop, but worth a final sweep.

## Phase 3, later or optional

- Pull-to-refresh on list pages. iOS Safari handles native refresh, this is a question of feel.
- Bottom navigation bar on phones for the most common five routes (Dashboard, Cameras, Images, Map, Notifications). Replaces the hamburger drawer with one tap. Only worth it if mobile usage actually picks up.
- Image lightbox swipe between images on phones. Already a feature on desktop with arrow keys, mobile gesture is the missing half.
- Map page offline tile cache is out of scope here, mention only because it comes up on every "phone friendly" mobile-first discussion.

## Conventions while doing the work

- Mobile first. Write the default classes for the phone, then add `sm:` / `md:` / `lg:` overrides for wider screens. Do not start with a desktop layout and patch it for mobile.
- One Tailwind utility per visual concern. No custom CSS unless the utility set genuinely cannot express it.
- Match existing component patterns. shadcn/ui Dialog, Sheet, DropdownMenu primitives are already in the project, prefer them over building from scratch (CONVENTIONS.md #12).
- Tap target minimum 40 px square. The Apple HIG and Material guideline is 44 px, 40 px is the practical floor for icon buttons in shadcn/ui.
- No fixed pixel widths on top-level page sections. Use `w-full`, `max-w-*`, percentage layouts, or grid.
- Test each PR on a 375 px window in dev before opening for review. Type checks and unit tests do not catch layout breaks.

## Gotchas

- `lg:` is 1024 px in Tailwind defaults. iPad portrait is 768 px and falls under `md:`. Verify the iPad layout intentionally, otherwise tablets get the phone layout by surprise.
- The sidebar drawer in `Sidebar.tsx` uses `fixed top-0 left-0 h-screen`. On iOS Safari with the URL bar visible, `h-screen` does not match the actual visible height, sometimes content is clipped. If this bites, switch to `h-[100dvh]`.
- `position: fixed` plus the iOS keyboard pushing the viewport leads to the menu button drifting. If anyone reports it, investigate, do not pre-optimise.
- Some pages use Tabs that overflow the viewport width when there are 5+ tabs. shadcn `Tabs` does not scroll horizontally by default; add `overflow-x-auto` on the `TabsList`.
- Charts from Recharts respond to container width. Make sure the container has `width="100%"` and a sensible `min-h-[xxx]`, otherwise the chart collapses to 0 height on a flex layout.
- Image grid prefetch in `ImageCacheContext.tsx` runs on mount. On a slow phone connection, prefetching dozens of full images hurts. Consider a smaller batch or lazy prefetch on visibility for Phase 2 ImagesPage work.
- Map tiles cost data. The map page already loads on demand, do not eagerly fetch them.

## How to test as you go

```bash
cd services/frontend
npm run dev
```

Open the dev URL, then in Chrome / Safari devtools open the device toolbar, set viewport to iPhone 14 Pro (393 × 852) and walk every route. Also test at 375 px (smallest mainstream phone) and at 768 px (iPad portrait, `md:` boundary) to confirm both ends.

## Out of scope

- Native mobile app. This plan is web-only, responsive design within the existing React app.
- Service worker / PWA install. Possible later, not part of phone friendly polish.
- Reworking the design system colors or typography for mobile contrast. Use what is there.
