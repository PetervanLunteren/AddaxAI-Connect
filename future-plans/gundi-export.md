# Export to Gundi (EarthRanger)

A future-plan note. Proposes letting a project push its camera-trap
detections into [Gundi](https://www.earthranger.com/), EarthRanger's
data-ingestion gateway, as Events with image Attachments.

## Context

Several conservation deployments run EarthRanger as their operational
platform: rangers watch a live map of events, get alerts, and dispatch
from it. Gundi is the gateway EarthRanger provides for third-party
sensors — you push Events (a detection, with coordinates, a timestamp
and free-form details) and Event Attachments (images) to a simple REST
API, and Gundi routes them to the connected EarthRanger site (or SMART,
wpsWatch, etc.).

Connect already produces exactly the data such sites want — classified,
geo-located camera-trap detections — but today the only way out is a
file download (CamTrap DP, CSV, spatial formats). Getting detections in
front of a ranger team means manual re-import, which defeats the
real-time value Connect was built around.

There are already traces of this ambition in the codebase: a
commented-out `notification-earthranger` queue name in
`shared/shared/queue.py`, an `earthranger` channel mentioned in the
notifications docstrings and `NotificationLog` comments. This note
proposes doing it properly, via Gundi rather than the EarthRanger API
directly, because one Gundi integration covers EarthRanger, SMART and
the rest of their supported platforms for free.

## What Gundi expects

Verified against the [Gundi v2 API docs](https://support.earthranger.com/developer_docs/gundi-api):

- `POST https://sensors.api.gundiservice.org/v2/events/` with an
  `apikey` header. Payload: `source` (device identifier), `title`,
  `event_type`, `recorded_at`, `location` (`lat`/`lon`), and a
  free-form `event_details` object. Returns an `object_id`.
- `POST .../v2/events/{object_id}/attachments/` — multipart file
  upload, one or more images per call.
- `PATCH .../events/{object_id}/` — update an existing event's
  properties.

The API key comes from a Connection created in the Gundi Portal, so
the pairing of an AddaxAI Connect project with a Gundi connection is
something the user sets up on the Gundi side first.

## Mapping Connect data to Gundi

**One Gundi Event per independence-interval group.** Connect already
groups consecutive images of the same species at the same deployment
within `independence_interval_minutes` into an "event" for exports
(`utils/independence_filter.compute_event_assignments`). That grouping
is the right granularity for EarthRanger: one animal visit, one event
on the ranger's map, with all its images attached — rather than one
event per image flooding the feed.

Per event:

- `source`: the camera's `device_id`, so each camera shows up as its
  own subject downstream.
- `event_type`: one type per detection category (see open questions;
  the types must exist on the EarthRanger side — documented setup
  step).
- `title`: e.g. `Leopard at Site 4 (CAM-012)`.
- `recorded_at`: the first image's capture time, converted to UTC
  using the server timezone (`captured_at` is naive camera-clock
  time).
- `location`: the deployment's coordinates.
- `event_details`: species common and scientific name, animal count,
  top confidence, camera / site / deployment identifiers, number of
  images, and whether the identification is AI or human-verified.

**Attachments are blurred thumbnails**, not full-resolution originals.
The thumbnail pipeline already applies the person/vehicle privacy blur,
uploads stay small, and an EarthRanger event view does not need 12 MP.
Person and vehicle detections are exported as their own event types —
that is the security use case several EarthRanger sites care about
most — and the blur guarantee is what makes exporting them defensible.

## User experience

Two modes, both per project:

**Continuous sync.** A project admin opens a new "Gundi" card in
project settings, pastes the Gundi endpoint and API key, hits *Test
connection*, and flips *Enable sync*. From then on every image that
finishes classification flows out automatically. The card shows last
sync time, events sent, and the last error if something is wrong —
same shape as the Telegram integration card, but project-scoped.

**Batch backfill.** A "Send to Gundi" row on the existing Exports page
with a date-range picker. It creates a background job and shows live
progress (n of m events sent), like the bulk-upload page. Backfill is
how a site gets its historical data into EarthRanger once, and how you
recover if sync was off for a while.

## Architecture

Follows the two patterns the codebase already proved out: the
bulk-upload job pattern for long-running work with progress, and the
Telegram config pattern for third-party credentials.

**A new `services/gundi-sync/` worker container.** Pushing to an
external API over the network — with retries, backoff and per-event
state — is exactly the kind of concern this codebase isolates into its
own service. It consumes two Redis queues with live-over-backfill
priority (`consume_forever_priority`, same as detection does for
live vs. bulk):

- `gundi-sync-live` — a small hook at the end of classification
  publishes the image id when its project has sync enabled.
- `gundi-sync-backfill` — jobs enqueued by the API.

**New tables (one Alembic migration):**

- `gundi_integration` — one row per project: endpoint URL, API key,
  `sync_enabled`, `is_configured`, `health_status`,
  `last_health_check`, `events_sent`, `last_synced_at`, `last_error`.
- `gundi_event` — the sync ledger: project, group key
  (species + deployment + interval window), the `object_id` Gundi
  returned, status (`pending` / `sent` / `failed`), retry count,
  timestamps.
- `gundi_attachment` — one row per image attached: `gundi_event` FK,
  `image_id`, status.
- `gundi_backfill_job` — mirrors `BulkUploadJob`: date range, status,
  `total_events` / `sent_events` / `failed_events`, `error_message`.

**API additions** (`services/api/routers/gundi.py`, project-admin
only): get/set/delete integration config, test-connection (calls Gundi
with the stored key, updates `health_status`), create backfill job,
poll backfill job, integration status for the settings card.

**Frontend:** the Gundi card in project settings, the backfill row +
progress on `ExportsPage.tsx`, and an `api/gundi.ts` client. No new
pages.

## Sync semantics

**Continuous sync groups incrementally.** When a classified image
arrives, the worker looks for an open `gundi_event` with the same
species + deployment whose window still covers the image. If none
exists it creates the Gundi event immediately (fast alerting — the
first leopard image reaches the ranger map within seconds) and records
the returned `object_id`. Subsequent images in the same group append
via the attachments endpoint and bump the image count / confidence in
`event_details` via PATCH. If PATCH proves awkward in practice, the
fallback is attach-only: later images still land on the event, only
the details go stale.

**Idempotency.** Every send checks the ledger first. Backfill re-runs
and overlapping date ranges skip groups already `sent`; a worker
restart never duplicates an event in EarthRanger. Backfill reuses
`compute_event_assignments` so batch grouping is identical to what the
CamTrap DP export produces.

**Failures.** A failed send keeps its row `failed` with a retry count;
the worker retries with exponential backoff. Persistent failures
surface on the settings card via `last_error` and flip
`health_status`. Gundi itself buffers delivery to EarthRanger, so
Connect only needs to get data reliably as far as Gundi.

**Backpressure.** Live priority means a 50,000-image historical
backfill never delays a real-time alert.

## Pros

- Turns Connect from a dashboard-with-downloads into a live sensor
  feed for the platform ranger teams actually operate from.
- One integration reaches every Gundi-supported destination
  (EarthRanger, SMART, wpsWatch), not just EarthRanger.
- Almost everything hard is already built: event grouping, thumbnails
  with privacy blur, the job/progress pattern, the credentials-with-
  health-check pattern. The new code is mostly plumbing between them.
- Per-project configuration fits the multi-tenant model: different
  projects can feed different EarthRanger sites, or none.

## Cons

- One more service container to build, deploy and monitor, and four
  new tables.
- A standing dependency on an external SaaS API: outages and API
  changes become support load. The ledger + retry design contains
  this, but does not remove it.
- The Gundi-side setup (Portal connection, API key, event types
  defined in EarthRanger) is outside Connect's control and will need
  a documentation page; misconfiguration there will look like a
  Connect bug to users.
- API keys stored in the database, like the Telegram bot token today.
  Acceptable under the existing threat model, but it widens what a DB
  leak exposes.

## Open questions

- Should human verification (phase 3) PATCH the existing Gundi event
  with corrected species, or is stale-AI-until-reviewed acceptable?
- Do any target sites want full-resolution attachments? If so, a
  per-integration toggle is easy, but the blur would have to be
  applied to originals on the fly.
- Should person/vehicle export be an opt-in toggle per integration,
  given some projects will not want any human imagery leaving the
  system even blurred?
- Event-type naming: one generic `camera_trap_detection` vs. per
  category (`ct_animal`, `ct_person`, `ct_vehicle`) so EarthRanger
  sites can style and route them differently. Leaning per-category.

## Phasing

1. **Batch backfill** — integration config card, test connection,
   backfill job + progress UI. Delivers value on its own and
   exercises the full mapping end to end.
2. **Continuous sync** — the classification hook, live queue,
   incremental grouping.
3. **Refinements** — verification updates via PATCH, per-integration
   filters (species/category selection, full-res toggle).
