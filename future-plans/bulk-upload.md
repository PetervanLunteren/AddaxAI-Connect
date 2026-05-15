# Bulk image upload

A future-plan note. Captures the discussion around letting users upload
images from non-connected camera traps (SD card pulls) into Connect.

## Context

The request came from Quentin. He wants to use AddaxAI Connect as a
management platform for cameras that do not have an FTPS uplink. Today
Connect is shaped entirely around live drip-feed ingestion: cameras
upload via FTPS, ingestion picks up the file, the pipeline runs.

There is nothing structurally preventing a bulk-upload path. The
question is whether it is the right product move and what it costs.

## What changes between live and bulk

The current pipeline assumes the camera tells us almost everything.
Camera id, GPS, timestamp, battery, signal all come from the FTPS path,
EXIF, and the daily health report. The user does not enter anything per
image.

Bulk upload breaks that on one axis: camera id has to come from the
user, who picks which registered camera the SD card belongs to.
Everything else still works:

- Timestamp comes from EXIF `DateTimeOriginal`, same as live.
- GPS comes from the Camera row (matches how live cameras work,
  because EXIF GPS is unreliable on most camera-trap models).
- Storage, detection, classification, dashboard, exports all reuse the
  existing pipeline.
- Camera health metrics (battery, SD usage, signal) are N/A for bulk
  and just stay null.

## Pros

- Opens Connect to users who run a mix of connected and SD-card cameras.
  Today they have to use two products for one workflow.
- Technical lift is bounded. The pipeline is mostly reusable.
- Quentin framed it as a "real game changer", which suggests it would
  unblock real adoption in some user segments.
- Lets users centralise dashboards and exports across all of their
  cameras instead of stitching results from two tools.

## Cons

- **Product positioning shift.** Connect was sold as the real-time
  self-hosted live-alerts platform. Adding bulk import moves it into
  WebUI / Wildlife Insights territory. Now there are two products in
  the family doing overlapping work.
- **WebUI already does this.** The offline-batch tool from the same
  family already handles SD-card pulls. Duplicating that capability
  splits maintenance across two codebases.
- **Disk and compute economics change.** Connect was sized for "tens to
  hundreds of images per day per project". Bulk dumps push that into
  "tens of thousands at a time". The cold-tier plan in
  `COLD_TIER_PLAN.md` was scoped for live drip. Costs go up, and bulk
  data is usually old enough to fall straight into cold-tier on first
  ingestion, which is its own design question.
- **Two ops modes is a tax.** Camera health pages only make sense for
  live cameras. The notifications page, the health dashboard, the camera
  detail view all have to learn "is this camera live, bulk-only, or
  both?". That branching accretes.
- **Real-time promise at risk.** Detection on the dev box takes roughly
  1-2 seconds per image on CPU. A 5,000-image SD card dump is 2-3 hours
  of solid queue. Live cameras during that window get stale
  notifications. This is the most important risk and the rest of this
  doc takes it seriously.

## The live-starvation problem and the fix

If a bulk dump goes into the same queue as live uploads, FIFO ordering
means live alerts wait behind the entire bulk batch. That breaks the
core product promise.

The fix is a **priority queue**, not interleaving.

Redis `BLPOP` supports a priority list natively. Today the workers do:

```
BLPOP image-ingested 0
```

The replacement is:

```
BLPOP image-ingested image-ingested-bulk 0
```

Redis scans queues in argument order and pops from the first non-empty
one. Live wins every time. Bulk is processed only when live is empty.
The fairness guarantee is total. About five lines in
`shared/shared/queue.py` plus a new queue constant. Same pattern
repeats for `detection-complete` and `classification-complete`.

This is cleaner than the "process 10 bulk then check live" idea because
it needs no batching logic on the worker side and gives live a hard
priority guarantee.

## Bulk uploads must skip live notifications

If a user dumps 5,000 photos of a roe-deer hotspot from three months
ago, Telegram fires 5,000 species-detection alerts in a row. That is
unacceptable.

Fix: add `Image.origin` with values `live` or `bulk`. The notifications
service skips the species_detection event for `origin = 'bulk'`. Battery
and system-health events are not generated for bulk anyway. The daily
and weekly project reports can still include bulk uploads, since those
are summary, not real-time.

Database migration is small. One column, one default, one backfill of
existing rows to `live`.

## Duplicate detection

A user re-uploading the same SD card a week later should not double the
counts. Cheapest reliable test:

- Hash the file content on upload.
- Check `(camera_id, captured_at, content_hash)` uniqueness.
- Refuse with a clear message naming the existing image uuid if there
  is a match.

A content-hash column on `Image` makes this trivial. Adds maybe 32
bytes per row. Backfilling existing rows is optional, only matters if
we want duplicate detection against historical FTPS uploads as well.

## Cold-tier interaction

Bulk uploads often have a `captured_at` from weeks or months ago. The
60-day age-based ILM rule in the cold-tier plan would push them to
Wasabi immediately on ingestion. Two reasonable options:

- **Tier on ingestion age, not capture age.** Newly uploaded images
  stay hot for 60 days regardless of when they were captured. Matches
  the user's mental model ("the image just arrived"). Simple to code:
  ILM rule operates on object age, not EXIF date.
- **Tier on capture age.** Bulk uploads go to cold immediately. Saves
  hot-tier space but makes the first review pass slow.

Default recommendation: tier on ingestion age. The user uploading a
batch wants to look at it.

## Effort

MVP that ships and is actually useful:

| Piece | Effort |
| --- | --- |
| Upload API endpoint (multipart, validation, EXIF, MinIO write, DB row, publish to bulk queue) | half day |
| Add `image-ingested-bulk` and `detection-complete-bulk` queues, workers use priority BLPOP | half day |
| Suppress live notifications for `origin = 'bulk'` | 2 hours |
| Duplicate detection (camera + captured_at + content hash) | half day |
| Frontend (pick a camera, drag-drop folder, per-file progress) | 1 day |
| Background job tracking (uploading 5k images in a browser tab is fragile, users will close it) | 1 day |
| Cold-tier interaction (decide and code the ILM rule) | half day |
| **MVP total** | **4-5 days** |

Add roughly the same again for polish: resumable uploads, server-side
job dashboard, per-file error reporting, manual timestamp entry when
EXIF is missing.

## The alternative path I would actually recommend

Add **CamtrapDP import** to Connect, with WebUI as the producer.

- WebUI already does SD-card detection, classification, and export as
  CamtrapDP.
- Connect already has CamtrapDP export logic in
  `services/api/routers/export.py` (see `_build_datapackage_json` and
  the `camtrap-dp` endpoint), so the schema is half-known already.
- An import endpoint reads the zip, validates the schema, writes
  Image rows with their pre-classified detections, no inference needed.
- The live pipeline is untouched, no priority queue, no notification
  suppression flag, no GPU concerns.
- The user workflow becomes: "WebUI for SD-card pulls, then
  one-click CamtrapDP import into Connect". They get one dashboard.

Effort estimate: roughly 2 days, mostly CamtrapDP schema validation and
the import endpoint. No queue or notification work.

This collapses the surface area while delivering the same end-user
outcome that Quentin actually wants ("see all my cameras in one place").

## Open questions

Captured here so they are answered before any code starts.

1. Is the CamtrapDP-import answer viable for Quentin's real workflow,
   or does he need the ML inference to happen inside Connect (for
   example because he does not run WebUI locally)?
2. If full bulk-upload-with-ML, what is the expected upload size per
   session? 500 images is a different problem from 50,000.
3. Cold-tier semantics. Tier on ingestion age (recommended) or
   capture age? See section above.
4. Are bulk-uploaded images counted in the same dashboard stats as
   live ones, or shown separately? A 5k import will shift
   detection-per-100-trap-days metrics for the project sharply if
   they share a denominator.
5. Should the upload UI allow assigning a folder to multiple cameras
   (e.g. one zip per camera), or is the per-batch model "one camera at
   a time"?

## Recommendation

Do not build full bulk-upload-with-ML yet. The technical work is
bounded but the product surface widening is the real cost.

If Quentin's actual workflow can be served by "WebUI for the offline
batch, CamtrapDP import into Connect for the management view", build
the CamtrapDP import path instead. Two days of work, no pipeline
changes, no notification suppression, no priority-queue gymnastics.

If the CamtrapDP path is not enough and we do go for the full
bulk-with-ML feature, the priority queue and notification suppression
are non-negotiable. Without them the live promise breaks the first
time someone uploads an SD card.
