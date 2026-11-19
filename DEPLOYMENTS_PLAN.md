# Deployments plan

Plan for one place to see and manage where every camera stood and when,
including cameras without GPS. Written 19 November 2026 after an audit of the
code, three research rounds and a discussion with Peter. Nothing in this plan is
built yet.

File and line references come from the audit at v0.23.0 and must be looked up
again before use.

## Continue from here

When Peter says he wants to continue with the deployments plan, do this:

1. Read this file in full.
2. Find the next step in the table below: the first one that is not done.
3. Tell Peter in one or two sentences which step that is and what it covers,
   and what was done last.
4. If the step is "not started", start its planning session. Follow the prompt
   under "How each step is planned" as if Peter had just pasted it, with that
   step as the task.
5. If the step is "planned" or "in progress", read its notes below the table
   and carry on from there. Ask Peter if the notes are not enough.
6. When the step is built, deploy it to dev and test it end to end, see
   "Deploy to dev". A step is not done before that.
7. When something changes, update the table and the notes in the same session:
   the status, the branch, the commit or release, and what the next session
   must know. Keep the notes short.

| Step | Status | Where |
|---|---|---|
| 1a | in progress | `main` |
| 1b | not started | `main` |
| 2a | not started | branch for phase 2 |
| 2b | not started | branch for phase 2 |
| 2c | not started | branch for phase 2 |
| 3a | not started | `main` |
| 3b | not started | its own branch |
| 3c | not started | `main` |
| 4 | not started | `main` |
| 5 | not started | `main` |

A status is one of: not started, planned (Peter agreed with the step's plan),
in progress, done (with the release it shipped in).

Notes per step:

- **1a**, planned and built on 19 November 2026.
  - GPS columns `gps_lat` and `gps_lon` on `images` and
    `camera_health_reports`, filled by ingestion and the bulk worker. Migration
    `20261119_gps_readings` adds them and backfills old photos. See "GPS
    readings" in `DEVELOPERS.md`.
  - The behaviour tests are not in the repo. They live in
    `~/Documents/Repos/AddaxAI-Connect-deployment-tests/` on Peter's Mac, run
    with `./run.sh` there (needs OrbStack), against a throwaway PostGIS. Not in
    CI, so run them before and after any change to the deployment code. Delete
    the folder when phase 2 is merged. Its README lists what they cover.
  - Three tests pin behaviour that looks wrong, as today's baseline: two
    photos of one burst confirm a move (phase 5), "New site" in the updates
    panel leaves the emptied auto site behind, and a site merge leaves two
    adjacent deployments of one camera apart.
  - The test on an old SD card confirms the audit: photos with GPS from
    elsewhere, imported without a chosen site, become the camera's current
    deployment, and the live one is closed on its own start day.
  - Deployed to dev on 19 November 2026 (commit `1ed08657`). The migration took
    39 s for 47,513 photos, all of them filled and equal to the JSON.
    Deployments and image links were byte for byte the same before and after.
    `verify-server.sh` passed. End to end: a photo through ingestion and a
    daily report through the upload folder both stored their reading.
  - Left to do before 1a is done: time the migration against the largest
    production dataset restored on dev, and check the GPS shapes there,
    including INSTAR photos, which the data on dev does not have.

## How to work on this plan

These rules hold for every phase and every session that builds from this plan.
They come before any detail further down. When a detail in this plan conflicts
with them, the rules win and the detail is discussed with Peter.

- **KISS, DRY, YAGNI.** Prefer the simple, robust solution. Build nothing
  before it is needed. A minimal set that caters for all is good design.
- **A simple model beats a perfect one.** The goal is rules a user can predict
  and a maintainer can read. No pile of heuristics to fit every scenario. When
  a case does not fit, say so and leave it out. Do not add a rule for it.
- **Be critical and honest.** Say when an idea is bad, also when it is in this
  plan. No sugar coating.
- **Be thorough.** Simple is not the same as half done. Do not cut corners.
- **Separate concerns.** The readings, the statements, the build function and
  the screens each do one job.
- **Do not reinvent the wheel, inside the app.** Before writing a component, a
  helper or a query, search the codebase for one that does the job. Use it or
  extend it. Never write a second version next to it. The pages already share
  a lot:
  - UI parts in `services/frontend/src/components/ui/`: `FilterBar`,
    `TabStrip`, `Sheet`, `ConfirmDialog`, `ImpactBox`, `ChoiceCards`,
    `StatusPill`, `Callout`, `BulkActionBar` with `useBulkSelection`,
    `RowActionsMenu`, `DateRangePicker`
  - map parts in `components/map/` and `components/sites/`:
    `BaseLayersControl`, `FullscreenControl`, `FitBounds`, `SitesMapView`,
    `SiteLocationPicker`, `SiteMergePicker`, `MapSelectDialog`, spiderfy
  - `DeploymentTimelineChart`, `DeploymentJourney`, `SiteFormModal`
  - page layout, filters in the URL, the z-index ladder and the responsive
    rules from `FRONTEND_CONVENTIONS.md`
  - backend: `shared/shared/geo.py`, `get_allowed_site_ids` and
    `site_scope.py` for viewer scope, `can_admin_project`, `shared.logger`
  When two pages need the same new thing, build it once as a shared part.
- **Do not reinvent the wheel, outside the app.** Before designing a part, look
  up how established platforms and well tested products solve it. Do web
  searches, read their docs, repos, issues and user forums, and base the choice
  on proven practice and real user experience. Record the sources in this
  file. The research of 19 November 2026 covers the model and the page as a
  whole. Each phase still does its own research for its details, for example
  the form in phase 2, the timeline interaction in phase 3 and the move check
  in phase 5.
- **Use built-in features first.** Check what Postgres, PostGIS, FastAPI,
  React and the libraries already in the repo offer before writing custom
  code. If a built-in option is close but not complete, stop and discuss.
- **Follow the conventions.** `CONVENTIONS.md`, `FRONTEND_CONVENTIONS.md` and
  `DEVELOPERS.md` apply in full: crash early and loudly, type hints, no quick
  fixes, tests with the change.
- **Plan with Peter.** Every step gets its own plan first, see the next
  section. No code before he agrees with the approach.

## How each step is planned

This file is the general guideline. It is not set in stone and it does not fix
every detail. The details are filled in per step, and a step may move away from
this file when there is good evidence or a discussion that points another way.
When that happens, update this file so it stays true.

The phases are cut into steps, listed under "Phases". Every step starts with
its own planning session, in plan mode, with the prompt below. Only after Peter
agrees with that plan is the step built.

```
## plan

Instructions:
* Switch to plan mode, I want this task to be done with "plan mode on"
* Codex will review your output once you are done, so make sure you exceed his expectations
* do not sugar coat, be honest and clear
* Read all MD file in root to get a understanding of the project.
* If something is unclear at any point, stop and ask before continuing.
* Prioritize simplicity and clarity over perfection. The code must be clean, easy to read, and understandable for collaborators. Avoid unnecessary complexity.
* I'm not in a rush. Please be precise and do the task thoroughly.
* Follow the KISS principle (Keep It Simple Stupid). Keep things as simple as possible.
* Follow the DRY principle (Don't Repeat Yourself). Avoid duplication and maintain a single source of truth.
* Follow the YAGNI principle (You Aren't Gonna Need It). Do not build functionality until it is actually needed.
* Before changing code, explain the current architecture and the intended change in your own words.
* Make the smallest safe change that solves the problem.
* Prefer simple, boring, maintainable code over clever abstractions.
* You can do web queries if you wish.
* A minimalist set that caters for all is a good design.
* Do not introduce new dependencies unless there is a clear benefit.
* Preserve existing behaviour unless explicitly asked to change it.
* Update or add tests for the changed behaviour.
* Please do webqueries if you wish to clarify things. I'm not in a rush and have enough tokens.
* I do not want complex heuristics designed to handle every possible edge case. Prefer a simple, consistent rule that works well across all situations.
* Run the relevant checks, tests, linters, and type checks before finishing (backend only).
* Document any important trade-offs, risks, or follow-up work.
* If you find unrelated issues, mention them separately, but do not fix them unless asked.
* Use a clear mental model that makes the feature easy for users to understand. Good UX should feel simple.
* make sure you test it properly and only stop when everything passes. I want you to test it e2e. You have the crome claude extention.
* Please ask me any question for clarification. I would rather that you ask too many questions than assume certain details.
* KISS, DRY, YAGNI. Be critical and honest. Prefer simple, robust solutions. Be thorough and don't cut corners. A minimal set that caters for all is good design. Research established solutions and industry best practices when needed. Learn from proven implementations. Don't reinvent the wheel. Separate concerns. Follow coding best practices..
* at the top of the plan file show a ballpark figure of the proposed (estimated) Line changes (separated by code/comments/docs/tests), the net line changes (+ / - (net)) and the number of files.
* Ask me clarifying questions before beginning. Based on the conventions set out in the MD files in root and your knowledge, give your recommended solution to each questions you ask me. The minimum number of questions (in interactive mode with selectable predefined multiple choice answers, the first always being your recommended answer) to ask me is 4
```

Peter does not paste this prompt each time. Saying that he wants to continue
with the deployments plan is enough, see "Continue from here" at the top.

## Deploy to dev

Every step that changes code ends on the dev server, with the prompt below.
Ask Peter for the go first: nothing goes to dev without it, also when the step
is otherwise finished. Once he gives the go, follow the prompt as if he had
pasted it.

```
Read conventions.md, commit, ssh into test server with "ssh dev", pull, restart whatever you need to, deploy, and perform e2e tests
```

- Code is baked into the images, so rebuild every service the step touched
  before running anything on dev, and run the migrations when there is one.
- Dev holds restored production data. Test on that data, and say per check
  what was tested and what it showed.
- A step on a branch (phase 2, step 3b): check out that branch on dev for the
  test and put dev back on `main` afterwards, unless Peter says otherwise.
- After the push, watch CI (`gh run watch`) before calling the step green.

## Main or a branch

Servers run tagged releases and never the head of `main`, so unfinished work on
`main` reaches nobody. The reason for a branch is releases: `main` must stay in
a state from which an urgent bug fix can be released.

- **On `main`**: steps 1a, 1b, 3a, 3c, 4 and 5. They only add things: columns,
  tests, a script, a read-only page. Half-finished work there breaks nothing.
- **On one branch for all of phase 2**: steps 2a, 2b and 2c. Phase 2 swaps the
  code that decides deployments and rewrites existing data when it carries
  over the past. For a while it cannot be released, and step 2a alone leaves
  the app in an in-between state. The three steps make one release together.
- **On its own branch**: step 3b. It removes the updates panel and the feed
  table.

Keep a branch short-lived and rebase it on `main` often, because `main` moves
fast. Rehearse the merge on dev with production data first, as was done for
`sites-migration-cleanup` in July 2026. Ask Peter before opening a branch, as
`CONVENTIONS.md` says.

## The problem

Connect was built on one idea: every photo carries GPS, and the app works out
sites and deployments from it. That holds up, but four needs have grown around
it and none has a home.

1. **Insight.** The 250 m rule and the two-reading check work, but nobody can
   see what they did or why. Users call it a black box.
2. **Correction.** Fixes exist but sit in three places with three sets of
   words: the updates panel, the camera panel and the Sites page. Most fixes
   delete data, so they cannot be taken back.
3. **Cameras without GPS.** SPARROW with Reolink cameras, the older cameras of
   Écrins National Park (issue #81), and GPS cameras whose firmware forgets the
   GPS. Today every such photo is rejected.
4. **Sites you declare yourself.** Add the sites of an area up front, link
   cameras and SD card uploads to them, remove them again. The Sites page has
   no add button today.

All four are about the same thing: a camera stood at a site for a period. That
is a deployment.

## What the audit found

- **No history.** There is no audit or undo table for sites or deployments.
- **Corrections destroy data.** "It did not move", "Change site" and site merge
  delete deployment rows and move the images over
  (`shared/shared/deployments.py`, `services/api/utils/deployment_edits.py`,
  `services/api/routers/feed.py`, `services/api/routers/sites.py`). Auto-made
  sites are deleted with their names.
- **GPS per photo cannot be queried.** It sits in `images.image_metadata` JSON
  as `gps_decimal`. For INSTAR it sits in `image_metadata['relative_path']`
  (and in the stored path). GPS from daily reports is not kept, only the
  latest fix in `cameras.config['gps_from_report']`. Step 1a moved both into
  columns.
- **A deployment can only come from GPS.** All three camera profiles set
  `requires_gps=True`. No endpoint creates a deployment or edits its dates.
  A daily report can open a camera's first deployment, dated with the
  server's date of that day and not with the report's own date. A bulk
  upload to a chosen site makes one without GPS.
- **The move check counts photos, not events.** Two photos near the same far
  spot confirm a move (`RELOCATION_CONFIRMATIONS = 2`). There is no check on
  time between them, so two photos of one burst can confirm a move.
- **State hides in JSON.** The pending move candidate and its held photos live
  in `cameras.config['gps_relocation_candidate']`.
- **Images are matched to deployments in two ways.** Viewer scope, pooling and
  alerts use `images.deployment_id`. Trap-days, the Camtrap DP export and
  pruning use camera plus date range. The two can disagree.
- **Two rules for "current site".** Highest deployment number in the API, open
  deployment first in notifications and theft watch. They differ after a bulk
  upload to a site.
- **Bulk upload side effects.** A recognised camera on an old SD card runs
  through the live rule, so old GPS can move the camera's current deployment.
  Confirmed by a test in step 1a.
- **No tests** on the deployment rule, the reassign and merge, the feed
  actions, the site merge or the bulk deployment helper.

Reusable parts that exist: the sites map, location picker, merge picker, box
selection, fullscreen and spiderfy under `services/frontend/src/components/map`
and `components/sites`, the SVG chart `DeploymentTimelineChart`, the list
`DeploymentJourney`, `SiteFormModal`, and the shared UI parts from
`FRONTEND_CONVENTIONS.md`. The Écrins fork (`PnEcrins/AddaxAI-Connect`, branch
`feat/ui-improvement`) has an add site button, upload from a site, and a camera
picker in bulk upload, in about 130 lines.

## What others do

Sources are listed at the end.

- **Every camera trap platform has the same three things**: a camera, a place,
  and a deployment that joins them for a period. Wildlife Insights, Agouti,
  TRAPPER, Camelot, EcoSecrets and the Camtrap DP standard all work this way.
- **In all of them a person links the camera to the place.** None derives it
  from GPS. A deployment set by a person is the proven standard, and it is the
  part Connect lacks. The automatic part of Connect has no example to copy.
- **Movebank is the best model.** Raw data is never deleted. Suspect points get
  a flag from the algorithm or from a person, and the person wins. Removing a
  deployment keeps the data. Its deployment manager is a timeline with devices
  as rows and a bar per deployment.
- **Google Photos uses layers for location**: from the camera, estimated, and
  set by you. Only the last two can change.
- **Move or noise.** Tracking systems use a distance plus agreement over time.
  A count of readings alone is a known but weak form. A median position is
  more robust than a mean. 250 m is in line with what others use.
- **Complaints elsewhere**: typed dates go wrong, strict date checks block
  uploads, and corrections cannot be reset to the original.
- **Map plus timeline** does not exist in any camera trap platform. The proven
  form comes from planning tools: rows are resources, bars are assignments, a
  click on a bar opens a side panel. Research on linked views says to keep it
  to two views and to filter by click. Playback and 3D views are too much for
  non-experts.
- **Timeline libraries** are heavy, in beta for years, or not free. Drawing our
  own SVG is the better choice, since the app already has one.

## The model

Three rules. A user and a maintainer should both be able to keep them in their
head.

1. The app cuts each camera's history into deployments from its GPS.
2. A person can say "from this moment to this moment, the camera stood at this
   site". Nothing automatic changes that period again.
3. After that period the app carries on from where the person said the camera
   is, with the same rule as always.

It is the same idea as a verified image. Verifying fixes that image, not the
images of tomorrow.

### Three layers of data

1. **Raw readings.** The GPS of every photo and every daily report, in real
   columns. Written once, never changed.
2. **Statements by people.** One row per decision: camera, site, from, until,
   who, when. Rows are never edited. A newer statement wins over an older one
   where they overlap. Removing a statement shows what is underneath. This
   table is also the history.
3. **Deployments.** The result, computed from layers 1 and 2 per camera. The
   rest of the app keeps reading the `deployments` table and
   `images.deployment_id` as it does today.

### How one camera's deployments are built

One function in `shared/`, without database access, takes the camera's readings
in capture order and its statements, and returns the deployments.

- It walks the readings with today's rule: 250 m from the deployment's own pin,
  two readings to confirm a move, the move dated back to the first far reading.
- A move is measured against the camera's own earlier readings, never against
  the pin of the site. The site is a label on the deployment. So a person can
  assign a period to a site 400 m away without the next photo causing a move.
- Inside a statement's period there is one deployment at the stated site, and
  cuts from GPS are ignored there.
- After the period the walk carries on at the stated site. If readings exist it
  measures from them. If none exist, as for a camera without GPS, nothing
  contradicts the statement and it runs until the next one.
- Every photo belongs to the deployment that covers its capture time. This also
  holds for a photo without GPS.

A second step writes the result to the database. It matches new deployments to
existing rows by camera and start, so ids stay stable. Only a deployment that is
new gets a site: the nearest site within 250 m, or a new site named from its
coordinates, as today. A site the app picked stays on that deployment on later
rebuilds.

The rebuild runs per camera whenever a reading or a statement for that camera
is added or removed. One camera has at most some tens of thousands of readings,
so a full rebuild is cheap. Measure it in phase 1 and only add a shortcut if it
is slow.

### Sites

- A site has a name, a pin and its notes, as today.
- A pin set by a person stays where it is. An automatic pin follows the
  readings of its deployments. One column says which of the two it is.
- A person can add a site on the map and move its pin.
- Merging keeps the merged site as a hidden row and records which deployments
  and statements moved, so the merge can be reversed.

### What needs review

There is no separate feed table any more. A deployment needs review when it
starts with a cut the app made and no statement covers that start. The tick
"reviewed" writes a statement for the period as it stands. One mechanism does
both the review and the correction.

### How each case plays out

| Case | What happens |
|---|---|
| Camera without GPS | A person says "from 3 March at site A". It runs until the next statement |
| Firmware forgets the GPS | The photo is accepted and joins the deployment that covers its time |
| GPS returns 2 km away | A normal move, made by the app and shown for review |
| False move from noise | A person states the period was at site A. The two bars become one. The readings stay |
| Wrong decision from months ago | A newer statement for that period wins. Removing a statement shows the GPS result |
| Old SD card arrives late | Its photos fall inside periods that exist and follow them |
| Two cameras at one place | Same as today: one site by default, a statement splits one off to its own site |

### What this model does not solve

- A camera with noisy GPS can produce a false move again and need fixing again.
  The cure is a better move check, which is phase 5.
- A camera that always sends a wrong position would need correcting over and
  over. There is no evidence this happens. If it does, the fix is one switch
  per camera to ignore its GPS. Not built now.
- A real move that the app snapped to the wrong site gives wrong numbers until
  someone reviews it. That is true in every design.

## Words

- **Deployment** is the word in the UI, the docs and the code. It is what
  camera trappers know, and what Camtrap DP, Wildlife Insights, Agouti, TRAPPER
  and Movebank use. The camera panel tab "Placements" is renamed.
- **Site** stays the word for the place.
- **Statement** is the working name in the code for a person's decision. The
  UI wording is open: "set by a person" against "automatic" is the starting
  point.

## Phases

All phases share the model above. Each one ships on its own and leaves the app
working.

The phases are cut into ten steps. Each step is one planning session and one
piece of work that can be reviewed and tested by itself. The cut is a first
estimate. A planning session may split a step further or join two.

| Step | What it covers |
|---|---|
| 1a | Tests that pin down today's behaviour. GPS columns, ingestion fills them, backfill of old photos |
| 1b | The build function with its tests, timestamps on deployments, the replay script and the replay on every production dataset |
| 2a | The statements table, carrying over the past, ingestion and bulk worker switch to the rebuild, every correction writes a statement |
| 2b | Photos without GPS are accepted, "no site yet", the "Set deployment" form and the statements list in the camera panel |
| 2c | One helper for "current site", one way to match images to deployments, the docs |
| 3a | The Deployments page, read only: map, timeline, filters, raw readings, phone list |
| 3b | Editing on the page, "needs review" folded in, the updates panel and the feed table removed |
| 3c | Sites page: add site, move pin, reversible merge |
| 4 | Bulk upload asks for a camera and a site |
| 5 | The better move check, by replay on stored readings |

### Phase 1: store the readings and prove the rebuild

Nothing changes for users.

- Tests first. Pin down today's behaviour of
  `update_or_create_site_and_deployment`, `reassign_deployment_site`, the
  contiguous merge, the feed actions, the site merge and
  `get_or_create_bulk_deployment`. The scenarios in
  `scripts/dev_simulate_feed.py` are the starting list.
- Migration: GPS columns on `images` and on `camera_health_reports`. Ingestion
  and the bulk worker fill them from now on.
- Backfill of old photos in the same migration, from
  `image_metadata['gps_decimal']` and from the INSTAR path. Not a separate
  script: phase 2 needs every old reading, so no server may skip it. Report
  GPS has no history to backfill.
- The build function in `shared/` with its own tests. It reproduces today's
  rule exactly, including the two-reading check and the mean pin.
- A replay script that builds deployments from the stored readings per camera
  and compares them with the `deployments` table. Run it on dev against every
  production dataset, as the release test does. Every difference gets a reason:
  a correction by a person, arrival order, a report that opened a deployment,
  or a bug.
- Timestamps. Deployments have dates today. The build cuts on capture time, so
  add start and end timestamps and derive the dates from them. Settle the
  details here, with trap-days and the Camtrap DP export in view.

Done when the replay explains every difference on every production dataset and
the numbers on dev are unchanged.

Steps 1a and 1b each end with a deploy to dev and an end to end test, see
"Deploy to dev".

### Phase 2: statements and cameras without GPS

The switch. From here the app stops destroying data.

- Migration: the statements table.
- Carry over the past. Where the replay matches a deployment and nobody acted
  on it, it stays automatic. Where a person acted (a resolved feed entry,
  `site_source='manual'`) or the replay differs, write a statement that pins
  the deployment as it is. Statistics before and after the update must be
  identical on every production dataset.
- Ingestion and the bulk worker call the rebuild in place of the old resolver.
  The candidate in `cameras.config` and the relink of held photos go away.
- Every correction writes a statement: "Change site" in the camera panel and
  the actions of the updates panel. The panel itself stays until phase 3, but
  "It did not move" no longer deletes anything, so its warning goes.
- A missing GPS no longer rejects a photo. `requires_gps` goes from the camera
  profiles. An invalid GPS such as (0, 0) counts as missing.
- A photo from a camera with no deployment at that time is processed and has no
  site yet. Project admins see it. Viewers limited to sites do not, which is
  the existing rule. The Cameras page shows how many cameras have photos
  without a site.
- One form, "Set deployment", built once as a component: site (pick one or add
  one on the map), from, until. The dates default to the photos, so they are
  rarely typed. It lives in the camera panel for now and moves into the page in
  phase 3.
- A list of statements per camera with who and when, and "Remove" on each.
- One helper for "current site of a camera" and one way to match images to
  deployments. Replace the double rules found in the audit.
- Docs: rewrite `docs/sites-and-deployments.md`, add cameras without GPS to
  `docs/camera-requirements.md`.

Done when a camera without GPS can be registered, placed and moved from a desk,
and every correction of the past can be made and removed again. The SPARROW
profile is separate work that needs this phase.

Steps 2a, 2b and 2c each end with a deploy of the phase 2 branch to dev and an
end to end test, see "Deploy to dev". Step 2a also rehearses carrying over the
past on the restored production data there.

### Phase 3: the Deployments page

- A new page in the sidebar between Cameras and Service. Read only for viewers,
  limited to their sites.
- Desktop: a map on the left and a timeline on the right. Rows are cameras,
  bars are deployments coloured by site, with a switch to rows per site.
- The bars carry marks for the photo dates, so gaps and photos outside a
  deployment stand out.
- A click on a site filters the rows. A click on a bar zooms the map and opens
  the side panel with the "Set deployment" form and the statements of that
  camera. One filter bar on top: camera, site, date range, needs review. The
  filter lives in the URL.
- With one camera or one site selected, the map shows the raw readings as faded
  dots, the pin, and the 250 m ring. A bar set by a person looks different from
  an automatic one. The panel says in words why the app cut where it did, for
  example "2 readings 310 m away on 12 March".
- The timeline is our own SVG. It shares its scale and drawing code with
  `DeploymentTimelineChart`, so the Insights timeline and this page do not
  drift.
- Tablet stacks the two views. A phone shows a list of deployments per camera
  with a map toggle. Every edit works through the form. Drag on the bars is not
  built.
- The updates panel folds in. The page gets "needs review" as a filter with the
  tick and "Mark all as reviewed". The badge moves to the Deployments item.
  `CameraUpdatesSheet`, the feed router and the `feed_events` table go.
- Sites page: an add site button, moving a pin, and a merge that can be
  reversed. The camera panel and the site panel link into the page with their
  filter set.
- Docs and the screenshot sweep route list.

Done when a project admin can answer "where was this camera, and why does the
app think so" on one page, and fix it there.

Steps 3a, 3b (from its branch) and 3c each end with a deploy to dev and an end
to end test in the browser, see "Deploy to dev".

### Phase 4: bulk upload

- The review step asks for a camera (an existing one, a new one, or unknown)
  and a site. That becomes a statement for the date range of the photos.
- A recognised camera with GPS only adds readings. The rebuild runs once at the
  end of the job, so an old SD card can no longer disturb the current
  deployment.
- The made-up camera `bulk-cam-<site>` stays only for "unknown camera".
- An "Upload images" button on a site, as in the Écrins fork.
- Check with Théo Lechémia (issue #81) before building. He offered pull
  requests for the same three changes.

Ends with a deploy to dev and an end to end test with a real SD card upload,
see "Deploy to dev".

### Phase 5: a better move check

This phase must not be dropped. It starts when phases 1 to 3 are live and
green.

- The stored readings make every rule testable. The statements people wrote are
  the answer key: each "it did not move" is a known false move, and each
  reviewed move is a known real one.
- Candidates from the research, to try in this order:
  1. count trigger events in place of photos, so one burst cannot confirm a
     move
  2. a median pin in place of the mean
  3. confirm a move when several far readings agree with each other over a
     minimum time
  4. skip poor fixes when a camera reports fix quality
- Replay each candidate on every production dataset. Accept one only when it
  gives fewer false moves and misses no real move. Periods fixed by a statement
  do not change, whatever the rule.
- Keep one threshold. Do not add a second radius or a setting per project
  unless the replay shows the need.

The replays run on dev against the production datasets. A rule that is
accepted ends with a deploy to dev and an end to end test, see "Deploy to dev".

## Decided and rejected

Decided on 19 November 2026:

- One plan with phases, cameras without GPS first.
- The place of a camera without GPS is set at a desk. Photos that arrive before
  that are kept.
- Raw data is never destroyed. A correction is a layer on top, and a later one
  can overrule it.
- Deployments are visible again, as bars on a timeline.
- The page has its own item in the sidebar and is called Deployments.
- The updates panel folds into the page.
- A person's decision fixes a period. It does not lock the camera.
- The move rule stays as it is until phase 5.
- Bulk upload asks for a camera and a site.

Decided on 19 November 2026, in the planning of step 1a:

- The behaviour tests run against a real PostGIS, because the deployment
  logic lives in SQL and fakes would prove nothing. They stay outside the repo
  until phase 2 is merged, then they are deleted. No CI job, no new packages.
- The tests assert on the resulting rows, not on the functions, so they keep
  working when phase 2 replaces the code.
- GPS readings are two plain number columns, not a PostGIS point. Nothing
  queries readings by area, and the build function reads them in Python.
- The backfill runs in the migration, not as a script.

Rejected, with the reason:

- **Locking a camera after a correction.** It needs a flag, accept and dismiss,
  a "back to automatic" button and a rule for what counts as locking. The
  period model needs none of them.
- **An undo stack or event sourcing.** Undoing a diff breaks once later changes
  touch the same thing, as Wikipedia and OpenStreetMap show. Layers do not have
  that problem.
- **A timeline library.** Heavy, in beta, or not free, and none links to a map.
- **Playback, a time slider with animation, a 3D view.** Cameras stand still
  for months. Research says these confuse non-experts.
- **Drag on the timeline bars.** The form covers every edit and works on a
  phone.
- **Setting the place in the field on a phone.** Not asked for.

This plan reopens three choices of July 2026: no undo, no sites made by hand,
and no deployments in the UI. The reasons then were sound for cameras that
always send GPS. Cameras without GPS and the complaints from users changed
that.

Later ideas, left out on purpose:

- Import of sites from a CSV, and of deployments from a CSV. Common elsewhere
  and useful for a backlog. The statements table can take them when asked for.
- A switch per camera to ignore its GPS.
- A threshold per project.

## Open points

To settle at the start of the phase named.

- Phase 1: the exact form of the timestamps on deployments, and what a move in
  the middle of a day means for trap-days.
- Phase 1: whether a daily report may still open a first deployment, as it
  does today.
- Phase 2: the name of the statements table and the wording in the UI.
- Phase 2: whether a site that has deployments can be deleted, or only merged.
- Phase 2: what alerts do for a photo that has no site yet.
- Phase 3: whether viewers see the "needs review" state.
- Phase 3: how the Insights timeline and the new page share code, or become
  one.

## Sources

Camera trap platforms:

- Camtrap DP, https://camtrap-dp.tdwg.org/data/
- GBIF camera trap guide, https://docs.gbif.org/camera-trap-guide/en/
- Wildlife Insights deployments, https://www.wildlifeinsights.org/node/3076
- Wildlife Insights forum, a date typo that locked a record,
  https://groups.google.com/g/wildlifeinsights/c/gCjYhaD4k5w
- Wildlife Insights forum, no reset after a wrong correction,
  https://groups.google.com/g/wildlifeinsights/c/5XSRZMq2nQc
- Agouti, https://docs.agouti.eu/using/deployments.html
- TRAPPER, https://trapper-project.readthedocs.io/en/latest/tutorial.html
- Camelot, https://camelot-project.readthedocs.io/en/latest/surveymanagement.html
- EcoSecrets, https://github.com/naturalsolutions/ecoSecrets
- camtrapR camera operation matrix,
  https://search.r-project.org/CRAN/refmans/camtrapR/html/cameraOperation.html
- WildCo error checking,
  https://bookdown.org/c_w_beirne/wildCo-Data-Analysis/error-checking.html

Raw data, layers and history:

- Movebank deployment manager,
  https://www.movebank.org/cms/movebank-content/deployment-manager
- Movebank data filters, https://www.movebank.org/cms/movebank-content/data-filters
- EarthRanger subject and source assignments,
  https://earthranger-support.helpjuice.com/en_US/subject-and-source-administration
- Google Photos locations, https://support.google.com/photos/answer/6153599
- Wikipedia on undo conflicts, https://en.wikipedia.org/wiki/Help:Reverting
- OpenStreetMap rollback, https://wiki.openstreetmap.org/wiki/Change_rollback
- Fowler on retroactive events, https://martinfowler.com/eaaDev/RetroactiveEvent.html

Move or noise:

- Traccar filters, https://www.traccar.org/configuration-file/
- Android geofencing,
  https://developer.android.com/develop/sensors-and-location/location/geofencing
- Digital Matter GPS wander,
  https://digitalmatter.helpjuice.com/heartbeats-suppress-gps-wander
- SOTI geofence settings,
  https://soti.net/mc/help/v2024.0/en/console/devices/monitoring/locationservices/troubleshooting_geofences.html
- Geometric median, https://en.wikipedia.org/wiki/Geometric_median

Map and timeline:

- kepler.gl time playback, https://docs.kepler.gl/docs/user-guides/h-playback
- EarthRanger time slider, https://earthranger-support.helpjuice.com/en_US/timeslider
- Baymard on split views, https://baymard.com/blog/accommodations-split-view
- NN/g on mobile maps, https://www.nngroup.com/articles/mobile-maps-locations/
- Linked views for novices, https://arxiv.org/pdf/2209.01599
- Space-time cube study, https://arxiv.org/pdf/0707.1618
- react-calendar-timeline, https://github.com/namespace-ee/react-calendar-timeline
- vis-timeline, https://github.com/visjs/vis-timeline
- Resource Guru on clashes, https://help.resourceguruapp.com/en/articles/1955778

Context:

- Issue #81, https://github.com/PetervanLunteren/AddaxAI-Connect/issues/81
- The Écrins fork, https://github.com/PnEcrins/AddaxAI-Connect
- The SPARROW thread of October and November 2026, in Peter's mail.
