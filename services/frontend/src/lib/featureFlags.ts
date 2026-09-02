/**
 * Feature flags for work that is merged but not released.
 *
 * A flag here keeps an unfinished feature out of sight without a branch.
 * The flag hides the entry point only (a menu item); the routes, API and
 * worker stay in place, so the feature can still be reached by URL for
 * testing on the dev server. Production servers deploy release tags, so
 * a flag on main only affects the dev server anyway.
 */

// TEMPORARY. On while the EarthRanger (Gundi) integration is finished on
// the dev server. Remove the flag altogether when the integration is
// released. See GUNDI_INTEGRATION.md in the repo root while the work is
// running.
export const SHOW_INTEGRATIONS_MENU = true;
