# Detection alert rules

Status. Idea captured, not planned, not built. This document is the starting
point for a future session. Read it, then do a fresh audit (code moves) and a
proper plan mode before building. Written 9 Aug 2026 after the camera
condition alert rules shipped and were bug hunted.

## The idea in one paragraph

Replace the current species detection notification settings (one species
multiselect plus one sites multiselect per user, stored in a JSON blob) with
rules-as-rows, the same architecture the camera condition alerts use since
commit `e49d67a`. Each user creates any number of private detection rules,
each rule combines a species selection with optional ecological conditions
(time of day, minimum group size, a rarity condition, a cooldown), and picks
its own delivery channels. The existing behaviour migrates automatically,
every user's current selection becomes one seeded rule.

## Why, the three real problems with the current path

These were verified by reading the whole chain on 9 Aug 2026, not guessed.

1. **Telegram only.** `rule_engine.get_matching_users` hard-requires a linked
   `telegram_chat_id` in its base query, so a user without Telegram receives
   no real-time alerts at all. Email is not offered anywhere on this path.
2. **No burst control.** Every classified image that passes the filters fires
   one message per matching user. There is no cooldown, dedup, or rate limit
   anywhere in the chain (checked `event_handlers.py`, `rule_engine.py`, and
   the classifier producers). A deer feeding in front of one camera for
   twenty minutes means one Telegram message per photo. It survives today
   only because users filter to rare species.
3. **One filter set per user.** A user cannot express "wolves anywhere,
   instantly" and "boar, but only at night" at the same time. The config is a
   single species list and a single site list inside
   `notification_channels.species_detection`, the same fragile
   whole-replace JSON blob whose semantics already silently killed the old
   battery digest (that story is in the camera alerts commit message).

## Where the current code lives (as of 9 Aug 2026, re-verify before use)

- Event producers: `services/classification-deepfaune/worker.py` (~L226 and
  ~L443) and the speciesnet twin publish `species_detection` events to the
  `notification-events` queue. Event payload carries `image_uuid`, `species`,
  `confidence`, `detection_count`, `camera_id`, `camera_name`,
  `camera_location`, `annotated_minio_path`, `timestamp` (camera capture
  time), `project_id`. Bulk uploads are already suppressed at the producer.
- Matching: `services/notifications/rule_engine.py`,
  `get_matching_users` plus `_evaluate_json_preferences` (species membership,
  sites membership via `get_image_site_id`, project detection threshold,
  per-species classification threshold).
- Message building and Telegram delivery:
  `services/notifications/event_handlers.py`, `handle_species_detection`.
- User config: `ProjectNotificationPreference.notification_channels`
  (`shared/shared/models.py`), edited on
  `services/frontend/src/pages/NotificationsPage.tsx` (the "Real-time
  detection alerts" section with the two multiselects).

## The prior art to clone

The camera condition alert rules are the template and most decisions can be
copied instead of re-made.

- Model pattern: `CameraAlertRule` in `shared/shared/models.py`. Private per
  user, `created_by_user_id` with ON DELETE CASCADE, typed `rule_type`,
  JSON state column reassigned as a new list (never mutated).
- Delivery-aware state: `next_notified_state` in
  `services/notifications/camera_alerts.py`. A rule only counts as having
  alerted when at least one channel actually queued a message. This exact
  lesson came from the bug hunt (a telegram-only rule without a linked chat
  used to swallow alerts silently) and applies one to one here.
- UI pattern: `CameraAlertRulesSheet.tsx` plus the notifications page row
  with the count badge. The dialog blocks telegram-only rules when no
  Telegram is linked, keep that.
- Router pattern: `services/api/routers/camera_alert_rules.py`, pure
  `validate_rule_fields` helper, ownership with 404 not 403, order
  insensitive camera comparison before resetting state.
- Time-of-day semantics with midnight wrap: the images page hour filter
  (`hour_from`/`hour_to` in `services/api/routers/images.py`, wrap when from
  is later than to). Reuse the exact same rule so the two features feel like
  one system. For detection rules the camera capture time is the right
  basis, animals live by local time (unlike camera silence, which measures
  server receive time on purpose).

## The condition catalogue, ranked

Tier 1, recommended for the first build. Each one earns its place.

- **Time of day window.** From and to hour, wrapping past midnight. The
  flagship ecological case is unusual diurnal activity, a wolf or badger in
  broad daylight is behaviourally abnormal and sometimes a health signal
  (rabies-suspect behaviour), diurnal boar activity indicates disturbance.
  Data already in the event (`timestamp` is camera capture time).
- **Minimum group size.** Fire only when the image shows at least N animals.
  `detection_count` is already in the event. Use cases, boar sounder size
  for African swine fever management, herd events for damage prevention,
  pack sightings.
- **Cooldown per rule.** No repeat alert for the same species at the same
  site within N minutes. Not ecological, but it is the condition that makes
  everything else usable, it collapses a feeding sequence into one message.
  Sensible default is the project's independence interval. Needs a small
  state store on the rule row (last fired per species and site, the
  `notified_camera_ids` JSON-state pattern).
- **Returns after N days (rarity).** Fire only when the species has not been
  detected in the project for at least N days before this event. This is
  the alert ecologists actually want, the lynx that comes back after eight
  months, the first wolf of the season. Needs one indexed lookback query
  per event, cheap at current scale. Decide in plan mode whether the
  lookback is project-wide or per site (project-wide is simpler and likely
  the right first version).

Tier 2, sensible later additions, do not build in round one.

- New species for this site, never recorded at that site before
  (colonisation and range expansion mapping, a per-site variant of the
  rarity lookback).
- Season or month window, only alert during the hunting season or the
  breeding season.
- Verified-only alerts, fire when a human verifies the species instead of
  when the AI classifies it. Different trigger point (the verification save
  endpoint would publish an event), useful for high-stakes identifications.

Tier 3, considered and rejected as over-engineering.

- Predator and prey co-occurrence within a time window. Scientifically
  attractive, operationally a stateful correlation engine.
- Weather-linked conditions, the system has no weather data.
- Abundance threshold alerts, that is reporting, not alerting.

## Migration thoughts

- Each user's existing `species_detection` blob (species list, sites list,
  enabled flag) becomes one seeded `DetectionAlertRule` with no extra
  conditions and channels `["telegram"]`, so behaviour is identical on
  update day. The blob key then retires the way `battery_digest` did.
- Open question for plan mode, does the migration run as an alembic data
  migration or as a lazily seeded row on first page visit. Alembic is the
  honest option, one moment, done, testable.
- The notifications page section "Real-time detection alerts" gets replaced
  by a rules row (manage button plus badge), not kept alongside. One mental
  model, not a simple mode and an advanced mode. The Telegram link CTA that
  lives in that section must survive the rearrangement.

## Pros and cons, honest

Pros.

- Fixes three real defects (telegram-only delivery, zero burst control,
  single filter set), not just architecture taste.
- One rules mental model across the whole notifications page, users already
  learned it with the camera alerts.
- The conditions are cheap because the event already carries the needed data
  (time, count, species, site), only the rarity lookback and the cooldown
  state add machinery.
- Kills the last of the fragile notification_channels blob usage for
  real-time alerts.

Cons and risks.

- Touches the live event path, not a daily cron. A bug here loses or
  duplicates real-time alerts, the tests and the e2e need to drive real
  events through the pipeline (the camera-alerts fire drill pattern works,
  publish a synthetic event or reclassify an image on dev).
- The migration must be exactly behaviour-preserving or users will silently
  lose alerts on update day. Seed rule generation needs its own test.
- Cooldown state on the rule row gets written per event, not per day. Write
  volume is still tiny (only on actual alerts), but the PATCH-races-writer
  window is wider than with the daily cron. Same accepted trade-off, one
  duplicate message at worst, but state it in the plan.
- The notifications page loses its most prominent section to a slideout,
  discoverability of the Telegram link CTA needs care.
- More conditions means a bigger dialog. Keep every condition optional and
  collapsed behind sensible defaults, the base case (pick species, save)
  must stay two clicks.

## Open questions to settle in plan mode

1. Rarity lookback per project or per site, and does an AI detection count
   as "seen" or only verified ones.
2. Cooldown on by default for new rules (suggest yes, default to the
   project's independence interval) and is it keyed per species and site or
   per species only.
3. Do seeded migration rules get a cooldown applied, which changes current
   behaviour slightly but for the better, or strict behaviour preservation.
4. Email as a channel for real-time alerts, per event it can be spammy,
   maybe email only makes sense with cooldown on. Decide whether email
   requires cooldown.
5. What happens to `rule_engine.py`, it shrinks to just the threshold
   checks or disappears into the new matcher entirely.
6. Person and vehicle detections, the current path alerts on them like
   species, rules should keep that (they are ranger-relevant), but decide
   whether the ecological conditions (rarity, group size) apply to them.

## Effort guess

One and a half to two days including plan mode, migration, event-path
matching with lookback and cooldown, UI slideout, tests, an e2e that pushes
a real event through the dev pipeline, and deploy. Bigger than the camera
alerts because of the live path and the migration.
