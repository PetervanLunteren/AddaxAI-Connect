/**
 * Feature flags for work that is merged but not released.
 *
 * Servers deploy the head of main, so anything merged is live on the next
 * pull. A flag here keeps an unfinished feature out of sight without a
 * branch. The flag hides the entry point only (a menu item); the routes,
 * API and worker stay in place, so the feature can still be reached by URL
 * for testing on the dev server.
 */

// TEMPORARY. The EarthRanger (Gundi) integration is built and tested end
// to end, but the EarthRanger side is not finished (species field, camera
// alert event type, their help docs). Until that is done and released, the
// Integrations menu stays hidden. Flip to true, or remove the flag
// altogether, when the integration is released. See GUNDI_INTEGRATION.md
// in the repo root while the work is running.
export const SHOW_INTEGRATIONS_MENU = false;
