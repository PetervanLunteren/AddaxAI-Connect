# Site as a first-class concept

A future-plan note. Captures the design for adding a Site entity to
AddaxAI Connect so the data model matches the Camtrap-DP standard
and AddaxAI WebUI vocabulary.

## Context

Connect today models things as `Project → Camera → Image`, with
`Camera.location` holding the camera's *current* GPS. When a camera
moves, the location is overwritten and historical spatial queries
silently drift to the new coords. There is also an internal
`CameraDeploymentPeriod` that the ingestion service maintains
automatically when GPS changes by more than 100 m, but it is not
surfaced anywhere in the UI or export.

Two real-world cases break this model already:

1. **Duinpoort NW + NO**: two cameras pointing different directions
   at one physical location. Today the place-name ("Duinpoort") is
   encoded into both camera names by hand. Spatial queries against
   "the Duinpoort site" need string matching.
2. **SD-card recovery bulk uploads**: a bulk batch is conceptually
   one (camera × site × time-range) tuple, exactly a deployment.
   Without a first-class Deployment, the bulk-upload feature
   shoehorns the date-range info into Image.captured_at and the
   site identity into Camera.location.

Camtrap-DP, GBIF, AddaxAI WebUI, Wildlife Insights, Camelot,
TRAPPER, WildTrax and Agouti all converge on the same model:

```
Project → Site/Location → Deployment → Media → Observation
              (place)      (camera at      (file)   (detection
                            place for                or label)
                            time range)
```

The goal of this work is to align Connect with that model, in a
deliberate multi-phase refactor that keeps the live FTPS pipeline
working at every step.

## Decisions confirmed with the user

- **Backfill strategy**: GPS-cluster sites. Build sites on top of the
  existing deployment rows, grouping deployments within one project that
  are within the single site threshold of each other (see GPS threshold
  below). Cameras that share a physical location (Duinpoort NW + NO)
  collapse to one Site.
- **`Image.deployment_id` is nullable**: live ingestion always tries
  to assign one, but legacy rows and edge cases (missing GPS,
  ingestion races) leave the column null rather than rejecting the
  image. Matches WebUI's nullable `Deployment.site_id`.
- **Naming axis**: Site carries the friendly place name ("Duinpoort"),
  Deployment carries a free-text orientation label ("NW", "main view").
  Camera keeps its current name as-is. We do NOT rename it to a hardware
  id (KISS, avoids touching every view plus the alert email and Telegram
  copy). The canonical display label across the UI, map, notifications and
  export is Site + deployment: a merged site shows "Duinpoort / NW", a
  single-camera site shows "Duinpoort NW" (empty deployment label). This
  reproduces the current look with no regression. `Camera.name` becomes a
  legacy field that display no longer reads; hide or drop it much later, or
  never.
- **CameraGroup stays separate from Site**: CameraGroup means
  "cameras sharing FOV, dedupe events between them" (independence
  interval). Site means "cameras at the same physical place". They
  often coincide but are orthogonal in principle. Keep both.
- **Rollout**: iterate on a dev box loaded with a prod data copy, then
  verify on a fresh dev box loaded with the second prod's copy, then apply
  to the real servers. Mistakes on dev are fine. The backfill `--dry-run`
  output is the review aid; no heavy snapshot ceremony required.

## Decisions I'm calling without asking

- **GPS threshold**: one single threshold, 100 m, defined once in
  `shared/shared/geo.py` as `SITE_THRESHOLD_METERS`. Two readings within
  100 m are the same site; a camera that moves more than 100 m leaves its
  site, which starts a new deployment. There is deliberately no separate
  deployment-vs-site threshold: two numbers were inconsistent (the same
  distance meant "same place" within a camera but "different place" across
  cameras). 100 m matches the historical relocation distance, so existing
  deployments stay consistent with zero recompute, and is ~16x the observed
  jitter (<6 m). Not per-project configurable in v1; can become a `Project`
  field later. A camera moving more than 100 m to a new spot at the same
  clearing therefore creates a new site; the user can merge sites by hand
  once the Sites UI lands.
- **`Camera.location` retained as a denormalised cache**: not
  user-editable, populated as "the location of the camera's currently
  active deployment". Backward compat for any code that reads
  `Camera.location` today. Mark it deprecated in the model docstring;
  remove only after every read site has been migrated to
  `Deployment.site.location`.
- **Camtrap-DP export refactor**: separate follow-up, not part of
  this work. The existing export endpoint can adapt later to read
  Site + Deployment instead of re-deriving from Camera + Image.
- **UI surfacing order**: bulk upload first (most direct benefit),
  Camera management second (replaces "edit location" with "view
  deployment history"), dashboard map third (multi-site
  aggregation). Each ships in its own PR.

## Schema

`shared/shared/models.py` changes plus matching migrations:

### New `sites` table

| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `uuid` | str(36) unique | external identifier, like Image.uuid |
| `project_id` | int FK→projects | ON DELETE CASCADE, indexed |
| `name` | str(255) | user-editable, defaults to `Site #N` or coords |
| `location` | Geography(POINT, 4326) | required |
| `habitat_type` | str(100) | optional, Camtrap-DP `habitat` field |
| `notes` | text | optional |
| `tags` | JSON | optional |
| `created_at` | timestamptz | server_default now |
| `updated_at` | timestamptz | onupdate now |

Unique constraint on `(project_id, name)`. Index on `(project_id)`
already present via FK.

### `bulk_upload_jobs.camera_id` rename? No

Keep `BulkUploadJob.camera_id`. The bulk-upload flow stays
camera-targeted at v1 even after Site lands. A future Slice 3
(multi-camera ZIP) is what would change that.

### Rename `CameraDeploymentPeriod` → `Deployment` and add `site_id`

| column | type | notes |
|---|---|---|
| existing columns | | keep as-is |
| `site_id` | int FK→sites | NULLABLE, ON DELETE SET NULL, indexed |
| `name` | str(100) | optional free-text orientation label, e.g. "NW" or "main view" |

Numeric `camera_heading` (0-359, Camtrap-DP `cameraHeading`) is deferred to
the Phase 6 export work. v1 uses the free-text `name` only; a later "N"→0
mapping or manual entry can fill the numeric field when export needs it.

The Deployment's location is now derived from `site.location`. The
existing `latitude/longitude` columns on `CameraDeploymentPeriod`
become redundant; keep them for the migration window, drop in a
later phase once every read switches to `site.location`.

### `images.deployment_id`

Already exists from the bulk-upload work (`bulk_upload_job_id` was
added in `20260516_image_bulk_job_fk`). Add `deployment_id` as a
sibling: nullable FK to `deployments.id`, indexed, ON DELETE SET NULL.

Live ingestion resolves `deployment_id` at write-time: find the
camera's currently-active deployment, set the column. Pre-existing
images stay null until the backfill runs.

## Auto-creation logic

In `services/ingestion/db_operations.py`, replace the current
`update_or_create_deployment` with a function that also handles site
matching:

```python
def update_or_create_site_and_deployment(
    camera_id: int,
    new_gps: Tuple[float, float],
    event_date: date,
) -> Tuple[int, int]:
    """
    Returns (site_id, deployment_id). Reuses an existing site within
    SITE_THRESHOLD_METERS in the same project; auto-creates if none.
    A new GPS reading outside the camera's current site (more than
    SITE_THRESHOLD_METERS away) closes the active deployment and starts
    a new one; otherwise it reuses the active deployment.
    """
```

The function is idempotent per (camera, gps) pair. Site auto-naming
default: `Site at {lat:.4f}, {lon:.4f}`. User renames via the new
Sites page when they care.

## Backfill

A one-off script in `scripts/backfill_sites.py` that builds sites on top
of the deployment rows that already exist (created by
`backfill_deployment_periods.py` and live ingestion). It does not re-detect
deployments from image GPS. For each project it:

1. Loads the project's deployments with their coordinates, skipping zombie
   rows (Null Island (0, 0) or inverted date range), matching the defense
   the stats and export queries already apply.
2. Greedily clusters those deployments into sites: deployments within
   `SITE_THRESHOLD_METERS` of each other share one site. A cluster within
   the threshold of an existing site reuses it instead of duplicating.
3. Derives the site name and per-deployment label (see naming rules below)
   and sets `deployments.site_id` and `deployments.name`.
4. Sets `Image.deployment_id` to the deployment whose date range covers
   `Image.captured_at`, again skipping zombie deployments.

Ships with `--dry-run` to print the full proposed mapping without writing.

Site and deployment naming on backfill:
- Single camera maps to one site: Site name = the original `Camera.name`
  ("Duinpoort NW"), deployment label empty. Display stays "Duinpoort NW".
- Several cameras collapse into one site (Duinpoort NW + NO): split each
  camera name on space, hyphen or underscore, take the longest shared
  leading token(s) as the Site name ("Duinpoort") and the remainder as
  each Deployment label ("NW", "NO").
- No common prefix in a collapsed group (e.g. "Duinpoort NW" + "Old gate"):
  fall back to a coordinate-based Site name and keep each full camera name
  as its deployment label. Flag these rows in the dry-run report for manual
  cleanup.

Idempotent and re-runnable: deployments that already have a `site_id` are
left alone, and images that already have a `deployment_id` are skipped. The
`--dry-run` output is the review aid on each dev iteration before applying.

Expected outcome on the current dev dataset (9k images, ~10 cameras):
- ~10 sites (since each camera mostly stays put; the Duinpoort NW+NO
  case collapses one pair, otherwise one site per camera)
- ~10-12 deployments (one per camera, plus any that relocated)
- All images get a non-null `deployment_id`

## Phases

Each phase is its own PR. Live FTPS keeps working at every phase
boundary; the system tolerates a mixed dataset (some images with
deployment_id, some without) throughout the migration.

**Phase 1 — Schema and idle backfill (~1 day)**
- Migration: new `sites` table, rename `camera_deployment_periods` →
  `deployments`, add `site_id` + `name` (free-text label) to
  Deployment, add `deployment_id` to Image.
- Models updated in `shared/shared/models.py`.
- Backfill script runs once on dev; verified.
- No ingestion changes yet. No UI changes. Live FTPS still uses
  `update_or_create_deployment` which keeps writing the
  Deployment row without a site (site_id null).

**Phase 2 — Live ingestion writes sites + deployments (~1 day)**
- Replace `update_or_create_deployment` with
  `update_or_create_site_and_deployment`.
- New live images get `Image.deployment_id` set.
- New sites auto-created on first GPS report.
- `Camera.location` still maintained as a cache for backward compat.

**Phase 3 — Bulk-upload integrates Site (~1 day)**
- BulkUpload review modal asks the user to confirm or override the
  detected site (in addition to the camera).
- The "+ Add new camera" inline form gains a "+ Add new site" sibling
  (the existing lat/lon fields are repurposed as Site coords, not
  Camera).
- Auto-detect in the inspect phase suggests both camera and site:
  match camera by EXIF SerialNumber as today, match site by GPS
  proximity (within `SITE_THRESHOLD_METERS`) to any existing site in the project.

**Phase 4 — UI surfaces: Sites page, deployment history (~2-3 days)**
- New project sidebar entry "Sites". Lists project sites with name,
  coords, image count, camera count, last activity.
- Site detail page: list of deployments at that site (each = camera +
  date range), recent images aggregated.
- Camera detail page gains a "Deployment history" tab.

**Phase 5 — Deprecate Camera.location (optional, off the critical path)**
- Not required for the Site feature to work. Do it later only if the
  denormalised `Camera.location` cache actually causes drift bugs.
- If done: switch every read to `Deployment.site.location`, make
  `Camera.location` a derived view in code (no DB writes), drop the column
  in a separate later migration.
- `Camera.name` is left untouched throughout (KISS decision); display reads
  Site + deployment instead.

**Phase 6 — Camtrap-DP export refactor (separate work)**
- Read Sites + Deployments instead of re-deriving from Camera +
  Image. Standards-compliant export naturally.

## Critical files

Create:
- `services/api/alembic/versions/<rev>_add_sites.py` (Phase 1 migration)
- `scripts/backfill_sites.py`
- `services/api/routers/sites.py` (Phase 4)
- `services/frontend/src/pages/SitesPage.tsx` (Phase 4)
- `services/frontend/src/api/sites.ts` (Phase 4)

Modify (Phase 1):
- `shared/shared/models.py` — new `Site` model, rename `CameraDeploymentPeriod` → `Deployment`, add `site_id` / `camera_heading` / `name`, add `Image.deployment_id`.

Modify (Phase 2):
- `services/ingestion/db_operations.py` — replace
  `update_or_create_deployment` with the site-aware version.
- `services/ingestion/main.py` — propagate the returned deployment_id
  into the Image row.

Modify (Phase 3):
- `services/bulk-upload/worker.py` — inspect phase emits suggested
  site (matched by GPS or auto-create); process phase writes
  `Image.deployment_id`.
- `services/api/routers/bulk_upload.py` — confirm endpoint accepts
  `site_id` (in addition to `camera_id`); auto-create site if a new
  one is requested.
- `services/frontend/src/pages/admin/BulkUploadPage.tsx` — review
  modal gains site picker (auto-pre-filled from manifest).

Modify (Phase 5):
- Any module reading `Camera.location` directly. Grep for it; expect
  a few places in `routers/cameras.py`, `routers/images.py`, the
  map components, the deployment-timeline page.

## Open product questions for later

1. **Site rename / merge UX**: if a user renames Site #3 to "Old
   Beech", what happens to the auto-create's "default to coords"
   naming logic? Probably fine — it only kicks in for net-new
   sites. Worth confirming with a user once Phase 4 lands.
2. **Sites moved**: if a user physically moves the cameras at one
   site to a different location (more than `SITE_THRESHOLD_METERS`) and re-deploys, do
   they want a new Site or an updated Site? Default: new Site (sites
   are immutable in coords). Surface via "+ Add new site" workflow.
3. **Cross-project site sharing**: should two projects share a
   physical site (one Site row, two project_ids)? WildTrax does
   this at org level. Connect's projects are isolated per access
   control, so probably not. Keep sites project-scoped.
4. **Anti-poaching coordinate masking**: at export time, should Site
   coords be rounded for sensitive species? GBIF guide mentions this.
   Out of scope for now; can be added at the export layer when it
   comes time to refactor Camtrap-DP export (Phase 6).

## Total cost estimate

| Phase | Effort | Risk |
|---|---|---|
| 1 — Schema + backfill | 1 day | Low (additive only) |
| 2 — Live ingestion writes | 1 day | Low (writes to new nullable column) |
| 3 — Bulk-upload integrates | 1 day | Low (new field on existing flow) |
| 4 — UI surfaces | 2-3 days | Medium (new pages, new nav) |
| 5 — Camera.location deprecation | optional | deferred, off critical path |
| **Total for the Site feature** | **5-6 days** | |

The work is staged so each phase is shippable independently and the
system never breaks at a boundary. Stop at any phase if priorities
shift; the model is internally consistent at each step.

## Recommendation

Do Phases 1 and 2 together as one PR (~1.5 days). They go together:
without Phase 2 the new tables sit empty for new data; without
Phase 1 there's nowhere to write. Phase 3 (bulk upload) follows
immediately because that's where the Site concept pays off most
clearly for the user. Phase 4 can wait until you see how the data
shapes up after Phase 3 has been running for a week. Phase 5 is
optional cleanup with no deadline. Cameras are never renamed.

The whole thing is doable in a focused week. The cost is real but
bounded, and the payoff is a model that matches every other camera
trap platform you might ever want to interoperate with.
