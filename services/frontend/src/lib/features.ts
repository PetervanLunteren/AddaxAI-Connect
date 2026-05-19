/**
 * Hand-toggled feature flags.
 *
 * No env var, no runtime config: flip the constant in this file and
 * redeploy. Intentional simplicity over a full feature-flag system,
 * because the only flag we have right now is "is this feature ready
 * to expose to users".
 *
 * bulkUpload:
 *   In active development. Hidden from production users until the
 *   workflow has had more real-world testing. Backend services
 *   (bulk-upload worker, API routes, DB tables) remain deployed and
 *   functional, only the frontend entry points are gated by this
 *   flag.
 *
 *   To work on the feature, locally flip this to true and redeploy
 *   the frontend. Do NOT commit the flipped value unless you're
 *   actually ready to ship the feature to all users.
 */
export const FEATURES = {
  bulkUpload: false,
} as const;
