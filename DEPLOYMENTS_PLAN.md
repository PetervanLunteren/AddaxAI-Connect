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
| 1a | done, release pending | `main` |
| 1b | done, release pending | `main` |
| 2a | done, release with the branch | `deployments-phase-2` |
| 2b | done, release with the branch | `deployments-phase-2` |
| 2c | done, release with the branch | `deployments-phase-2` |
| 3a | done, release with the branch | `deployments-phase-2` |
| 3b | done, walkthrough with Peter at S03 | `deployments-phase-2` |
| 3c | dropped, see the notes of 3b | |
| 4 | not started | `deployments-phase-2` |
| docs | not started | `deployments-phase-2` |
| 5 | measured 26 Nov 2026, no change: the rule stays | |

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
    the folder when the branch is merged. Its README lists what they cover.
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
  - spw restored on dev the same day (`test-update.sh`, pass in 218 s). The
    migration alone took 4 s for 41,665 photos. Every photo with GPS in the
    JSON is filled with the same values, except 11 live photos at (0, 0)
    from before the guard, which stay empty as they should. Run twice, the
    columns, image links and deployments came out identical.
  - spw project 4 holds 11,811 bulk photos with no GPS at all, uploaded to a
    chosen site. Phase 2 must keep them on their deployments, since the
    rebuild has no reading for them.
  - No INSTAR photos on drenthe or spw. Their backfill is covered by the
    local test only. Nobody uses INSTAR now, so Peter decided on 19 November
    2026 to leave it until a project has one.
  - No separate run on pwn, the largest dataset (about 72k photos). At 4 s
    for 41k photos the time is no concern, and the release test restores
    every production dataset on dev before a release anyway.
  - Built and tested on dev. Not in a release yet.
- **1b**, planned and built on 19 November 2026.
  - `build_deployments` in `shared/shared/deployment_build.py`, tests in
    `tests/shared/test_deployment_build.py`. It keeps every quirk of today's
    rule on purpose. Nothing in the app calls it yet.
  - The local test folder proves it equals the live resolver: each scenario
    goes through the real resolver on PostGIS and the stored rows must match
    the build in arrival order (`test_build_equals_live_rule.py`, including a
    long random walk with noise, outliers and late photos).
  - `scripts/replay_deployments.py` compares the build with the stored rows
    for a whole server and gives each differing camera a reason. Read only.
    The cutoff for "older rule" is the most common `ingested_at`, the stamp
    migration `20260616_rejections_feed` put on every photo that existed
    then. A server that ran v0.6.0 before v0.6.2 has a few weeks after that
    stamp under the old rule, which shows as unexplained cameras to check by
    hand.
  - Replayed on dev on 19 November 2026 against every production dataset with
    a backup. Every camera has a reason, none is unexplained. The build took
    under a second per server, at most 0.16 s for one camera, so a full
    rebuild per camera needs no shortcut.

    | Server | Cameras | Same | Person | Upload | Report | Deleted | Older rule | Arrival order |
    |---|---|---|---|---|---|---|---|---|
    | lab | 5 | 2 | 3 | | | | | |
    | npuh | 8 | 7 | | | 1 | | | |
    | drenthe | 30 | 30 | | | | | | |
    | spw | 115 | 85 | 2 | 10 | 2 | 1 | 15 | |
    | pwn | 49 | 44 | | 1 | 1 | | | 3 |

  - "Older rule" on spw is 14 pins 1 to 5 m off, from before the running mean,
    and one camera split by the old rule.
  - "Deleted" is spw camera 861943072916181: its pin averaged 114 readings,
    62 photos are left. Added as a reason after the first run.
  - "Arrival order" on pwn needs a decision in phase 2. Three cameras each
    have one photo taken on 15 January 2026, 49 km from their site, that
    arrived in late October, most likely test photos from before the field.
    In arrival order the reading was held and dropped. In capture order it
    comes first and opens a deployment of its own, which the next photos then
    confirm as a move. The two-reading check guards a move, not the first
    deployment. See the open point for phase 2.
  - The replay script was removed in step 2a: it compared against the order
    the old resolver saw, which no longer exists. The results above stay.
- **2a**, planned and built on 19 November 2026, on branch
  `deployments-phase-2`.
  - Decided: carry over by pinning only what differs, a site in use cannot be
    deleted (merge it instead), a removed statement stays marked removed, the
    first reading of a camera is trusted as before.
  - `deployment_statements`, `deployments.start_at` and `end_at`
    (migration `20261119_deployment_statements`). `build_deployments` takes
    statements, `rebuild_camera` in `shared/shared/deployment_rebuild.py` is
    the only writer of deployments. See "Deployments, statements and the
    rebuild" in `DEVELOPERS.md`.
  - A statement with an end is exactly that period, after it the walk starts
    fresh. Without an end it fixes up to the camera's newest photo when it was
    made, and the GPS carries on after that. Agreed with Peter after stage 1.
  - Live photo: store and rebuild in one transaction. Bulk job: one rebuild
    at the end, also when it fails; an upload to a chosen site is a statement
    for its days. Daily reports no longer touch deployments.
  - Corrections: change site, set site, new site and "it did not move" write
    statements. Site merge repoints statements and rebuilds. Site delete is
    refused while deployments or statements use the site. Retire and image
    delete rebuild.
  - Gone: the old resolver, the bulk deployment helper, the merge SQL, the
    held reading in `cameras.config`, the four deployment scripts in
    `update-database.sh`, `cleanup_empty_deployments` and its midnight bug,
    `dev_simulate_feed.py`.
  - `scripts/carry_over_deployments.py` runs once from `update-database.sh`.
    A camera with a hand-set site is always pinned, even when its dates match
    the GPS, so the choice does not hang on a row alone.
  - Changed on purpose: New site removes the auto site it emptied, a site
    merge joins back to back deployments, an old SD card without a chosen
    site is read as history.
  - Not in CI: the rebuild's database code is tested in the local folder
    only. CI also does not run on branch pushes, only on `main` and pull
    requests. Decide in 2c whether the local folder stays or CI gets PostGIS.
  - For 2b: the "It did not move" dialog still says it cannot be undone.
    That stays true until the statements list with Remove exists.
  - The gate on dev, 19 November 2026, branch at `f6573985`. Every dataset
    restored and updated with the branch, `test-update.sh` passed on all
    five. The carry-over, one statement per old deployment by its days:

    | Server | Cameras | Automatic | Pinned | Changed |
    |---|---|---|---|---|
    | lab | 5 | 2 | 3 | 1 |
    | npuh | 40 | 35 | 5 | 0 |
    | drenthe | 31 | 24 | 7 | 0 |
    | pwn | 53 | 43 | 10 | 3 |
    | spw | 115 | 87 | 28 | 1 |

    Every change has a reason:
    - lab, one camera: a photo of 6 June had no deployment, cut loose by the
      old cleanup with the midnight bug. It has one again, so the camera
      starts a day earlier.
    - spw, one camera: 6 photos taken at the old place on the morning of a
      move now sit on the new deployment. Old deployments knew only days, so
      the day of a move belongs to the new one. That site's pin moved 61 m.
    - pwn, three cameras: the test photos of 15 January in Utrecht (see the
      notes of 1b) are now a deployment of one or two days there. Left on
      purpose, a statement fixes it per camera once 2b has the form.
    - pwn, one site: its pin moved 50 km to where the photos of its upload
      say the camera stood. Deployment pins come from the photos' GPS now,
      also for uploads to a chosen site.
    - Site pins elsewhere moved up to 15 m: deployment pins are now the mean
      of the photos on them.
  - Two flaws the gate found and fixed: a joined deployment kept the pin of
    the first part (lab, 138 m), and the carry-over's report was lost because
    restores hide the output, so it is also written to a file in the api
    container. Two special cases added to make numbers match were removed
    again, see "Explainable beats identical".
  - `api-speed` failed once on spw (8.04 s on `/api/statistics/performance`),
    the known slow page from `TODO.md`, unrelated. It passed the next runs.
  - Live photo on dev with spw data: 0.04 to 0.1 s per photo including the
    rebuild, on the busiest camera (1,664 photos). Near photos stay on the
    open deployment, two photos 2 km away make a move and a feed entry.
  - In the browser on dev with spw data, 19 November 2026, all as intended:
    - Change site in the camera panel: a statement, the deployment moves to
      the chosen site with its dates and photos.
    - "It did not move": the two deployments become one again with all
      1,669 photos, the emptied auto site is deleted, both statements stay
      with who made them, the newer one wins.
    - Deleting a site in use: refused with "Cameras have stood at this site.
      Merge it into another site instead."
    - Site merge: the deployment, its 7 photos and its statement move to the
      kept site, the merged site is gone.
    - Retire: the open deployment closes on the day of the last photo.
  - For 2b, UI text that is out of date since 2a: the site delete dialog
    still says deployments "keep their data but lose the site link", and
    "It did not move" still says it cannot be undone.
  - Dev stays on the branch for 2b and 2c.
- **2b**, planned and built on 19 November 2026.
  - Decided: the form works in whole days, the list is called "Fixed
    periods" in the app, alerts stay as they are (a rule for the whole
    project fires for a photo without a site and names the camera, a rule
    limited to sites skips it). And the one branch rule, see "Main or a
    branch": no stopgaps, so uploads are left for phase 4.
  - Photos without GPS, or with an invalid one, are accepted. `requires_gps`
    is gone from the camera profiles. An upload without a chosen site still
    skips a photo without GPS until phase 4 asks for the site.
  - Endpoints to list, set and remove fixed periods, admins only. The old
    `PATCH /deployments/{id}` is gone: Change site is the Set deployment form
    with the deployment's own days.
  - Camera panel: the tab is now Deployments, with Set deployment, a note
    when photos have no site yet, and the Fixed periods list with Remove.
    `SetDeploymentDialog` is one component, for phase 3 to mount again.
  - Cameras page: a column, a filter and an attention chip for photos
    without a site, admins only.
  - Alerts, integrations and the observations export read GPS from the
    columns, so an accepted (0, 0) is not sent on.
  - Texts fixed: "It did not move" says how to take it back, the site delete
    dialog says a site in use must be merged.
  - On dev with spw data, 19 November 2026, all as intended:
    - Two Willfine photos without GPS through the real upload folder:
      accepted, classified, no site, no rejection.
    - The Cameras page chip counted the camera, the filter listed it.
    - The camera panel note "2 photos have no site yet" opened the form
      prefilled with their first day. Saving placed both photos.
    - A later photo without GPS landed on that deployment by itself.
    - A second period from a later day moved the camera, and removing it
      gave everything back, the removed row kept with who and when.
    - Change site on a GPS camera opened the same form with its site and
      days.
  - The chip found real photos without a site on spw: setup photos without
    GPS, a day before two cameras' first deployment. They had no deployment
    before 2b either, nobody could see it.
  - Not tested end to end: a project-wide alert on a photo without a site,
    because dev holds spw's real users and alert rules. The code path did
    not change in 2b.
  - Each fixed period shows the days it was set with. Where a newer one
    overlaps it, the history above shows what is in force.
- **2c**, planned and built on 20 November 2026.
  - Decided: the current site is the deployment that started last, also when
    it has ended. Effort is photos only at both ends: a camera counts at a
    site from its first photo there to its last photo there, a closed fixed
    period as the person said, daily reports do not count. User docs are
    written once at the end of the branch. Tests that guard code that stays
    move into the repo.
  - Current site: `shared/shared/deployment_queries.py`, used by the camera
    list and detail, viewer scope, service, camera alerts, integrations,
    theft watch and the excessive images alert. Deployment lists sort by
    time.
  - Photos belong to their deployment through `images.deployment_id`
    everywhere: the map, the spatial export, independent events, the
    Camtrap DP export and the timeline. The Camtrap DP export writes exact
    deployment times.
  - Effort: `shared/shared/effort.py`, `deployments.last_photo_at`
    (migration `20261120_deployment_last_photo`). The map now clips effort
    to its date filter. The timeline counts photo days per deployment, no
    report days.
  - Tests: `tests/db_ingestion` and `tests/db_api` in the repo, run with
    `scripts/test-db.sh` and in the `db` job of CI. The tests of the GPS
    backfill and the carry-over stay in the local folder, deleted when the
    branch is merged.
  - On dev, 20 November 2026, spw and pwn restored fresh with the branch.
    `test-update.sh` passed on spw. On pwn only the log check failed: two
    errors while the restore loaded the old database, before its
    migrations, from a browser that was open, and one failed login. Every
    update with a new column has that minute.
  - Effort before and after, all sites per project:

    | Server, project | Deployments | Old trap-days | New | Change |
    |---|---|---|---|---|
    | spw 1 | 97 | 9,424 | 9,254 | -1.8 % |
    | spw 2 | 8 | 301 | 293 | -2.7 % |
    | spw 3 | 5 | 152 | 122 | -19.7 % |
    | spw 4 | 10 | 339 | 339 | 0 |
    | pwn 1 | 19 | 2,498 | 1,819 | -27.2 % |
    | pwn 2 | 38 | 2,774 | 2,525 | -9.0 % |

    The largest drops are cameras that went silent: four pwn cameras whose
    last photo was on 9 or 10 June counted every day since, about 160 days
    each, and now stop at their last photo.
  - Photos matched by date against the link: 17 photos on spw and pwn were
    on two deployments at once by date (a move day), 6 on another
    deployment than the link. With the link each photo counts once.
  - The map with a date filter (October) gives at most 31 days per site, and
    a site whose camera went silent in June 0 days.
  - The Camtrap DP export: every classified photo with a deployment is in
    media.csv (42,720 and 46,180), none points at an unknown deployment, and
    deployment times are exact with the right summer and winter offset.
    Starts at midnight are the carried-over periods.
  - The timeline: bars stop at the last photo, the Utrecht test photo of
    January is its own short row.

- **3a**, planned, built and tested on dev on 20 November 2026.
  - Decided: "needs review" is built in 3b, all of it. The reason for a cut
    is worked out on request, never stored. Details show in a card under the
    map, nothing is dimmed. Bars have one colour with the site name on them,
    a fixed period has an outline. The Insights timeline stays and shares
    its axis code. The page is for project admins only, which closes the
    open point about viewers. It opens on the whole history. A selection
    shows all GPS of the camera, the selected deployment strong. The page
    has the layout and the filter bar of the other pages.
  - Built: `Move` on `BuiltDeployment`, `load_history` and `build_history`
    in the rebuild, the list endpoint with photo days and photos without a
    site, the readings endpoint, `DeploymentsPage` with its timeline, map
    and card, `timeline-scale.tsx` and `SiteMarkersLayer.tsx` as shared
    parts, links from the camera and site panels, the sidebar item.
  - Tests: `tests/shared/test_deployment_build.py` (the move reason),
    `tests/db_api/test_deployments_page.py`.
  - On dev with pwn data, 20 November 2026 (branch at the commit after
    `7f274ba4`):
    - Every deployment of both projects gets a reason (project 1: 7 first,
      8 fixed, 4 moved; project 2: 36 first, 2 fixed). The list takes
      0.2 s, the slowest camera 0.45 s. The three moves of November read
      "2 photos in a row were 2.3 km from where it stood before".
    - The Insights timeline looks the same as before the shared module.
    - In the browser: filters, drag to zoom, rows per camera and per site
      (lanes where cameras overlap), a click on a bar (card, dots of both
      places, pin, ring, fit), the selection in the link, the link from
      the camera panel, tablet width, map tiles.
    - Two bugs found and fixed there: bars that started before a zoomed
      range ran over the row labels, and the map fitted to the pin before
      the GPS arrived, so the earlier place of a move was out of view.
  - Not tested in the browser: the phone width (Chrome does not go below
    820 px and the app refuses to be framed) and a viewer, who has no page
    (no viewer account on dev, by rule). Both are covered by the code: the
    route sits in `RequireProjectAdmin`, the phone layout switches at
    768 px.

- **3b, where it ended** (24 November 2026, after six rounds and a
  walkthrough of S01 and S02 with Peter). The details of what exists are
  in `DEVELOPERS.md`, "Moves". In short:
  - **Moves**, a page under Admin tools next to Curation: a table of every
    move the app saw and every correction a person made. An overview to
    look things up in, not a to-do list; the app is automatic first.
  - A row click opens a check window like image verification with one
    question, did it really move: **It moved** (Enter) records that a
    person looked and fixes nothing; **It stayed at Pond** (W) writes a
    correction at once, with Undo on the spot.
  - Only **suspicious** moves (back at the same site within a week) get an
    amber pill and count for the badge.
  - A move to the wrong site is fixed elsewhere: merging sites (Sites page)
    or Edit (camera panel). Started cameras are named in the site
    panel; photos without a site are the Cameras page's.
  - Undo is exact: a move is keyed by camera and start, which come from
    the photos, and "It stayed" records the move it answered
    (`answers_move_at`, migration `20261124_statement_answers_move`).
  - Two rules of the rebuild changed on the way, both bugs found in the
    walkthrough, each with a test that fails without the fix: a correction
    never moves a site pin, and after Undo the GPS decides again (a stored
    site is only kept when the GPS chose it).
  - Rules that hold for the rest of the plan: before adding a screen, a
    button or a word, ask what the user must never have to do and what can
    go; a deterministic rule over a heuristic, also in the screens; finish
    the walkthrough before more polish.
  - Done 26 Nov: the comparison of step 2c rerun on restored production
    data with today's rebuild rules (branch at `409aa86b`), all five
    restores passed. The carry-over, against the gate of 19 Nov:

    | Server | Cameras | Automatic | Pinned | Changed | Pins moved, furthest |
    |---|---|---|---|---|---|
    | lab | 7 | 4 | 3 | 1 | 0.6 m |
    | npuh | 40 | 35 | 5 | 0 | 0.1 m |
    | drenthe | 31 | 24 | 7 | 0 | 0 m |
    | spw | 116 | 88 | 28 | 1 | 14.1 m |
    | pwn | 53 | 44 | 9 | 4 | 0.8 m |

    - Same as on 19 Nov: lab's photo of 6 June, spw's 6 photos on the
      morning of a move, pwn's three cameras with test photos in Utrecht.
      lab and spw have new cameras since, all automatic.
    - Better: spw's site pin that moved 61 m now moves 14 m, because a
      correction no longer moves a pin.
    - New, pwn camera 10: one photo of 14 July, 588 m from where the camera
      then stood (a test photo before the field), sat in a deployment
      without a site. The carry-over cannot pin a deployment without a
      site, so the GPS places it: a new site "Site at ..." with one
      deployment and one photo. Harmless, a person merges it or leaves
      it. Say it in the release notes for pwn ("one new unnamed site may
      appear"); no special case.
    - Close site pairs: within 50 m lab 0, npuh 4, drenthe 0, spw 0, pwn
      12; 50 to 250 m lab 1, npuh 0, drenthe 9, spw 0, pwn 0. None
      involves an unnamed site, all named by people, so no sign of pins
      drifting toward a missed move (the S04 case) in real data.
  - Fixed 26 Nov, a page whose address names a project the user cannot
    open (deleted, no access) showed another project's data: the app fell
    back to the last selected project. It now asks for the project list
    once more and then says the project does not exist or there is no
    access (`409aa86b`).
  - Done 26 Nov, speed on dev with production data, three runs each
    (`verify-server.sh` now also times the deployments list, the
    corrections list and To do, and writes every time to
    /tmp/verify-server-times.txt): deployments list at most 0.16 s,
    corrections 0.13 s, To do 0.52 s (pwn). The Edit preview on the
    largest camera (20,522 photos) 1.6 s. The statistics performance page
    on spw stays over the 8 s budget (8.2 to 9.4 s), as before this
    branch (9.7 s on production with v0.21.1, see TODO.md); budget kept.
  - Done 26 Nov, the user docs (`939feef6`, `71e6b2ce`, `db5cef29`): the
    sites page rewritten for the new model with six screenshots of the
    scenario project, GPS no longer required on the camera pages, the
    update guide on downtime. In the browser on dev: Merge (a stray site
    into Meadow) and Set site before a camera's first photo work as the
    page says.
  - For the release notes: an update has about a minute of downtime and a
    failed migration leaves the app down; pwn may show one new unnamed
    site (above); the spw statistics page fails the speed check, known.
  - Code review of the whole branch, 26 Nov (`/code-review`, one pass, ten
    findings). Fixed:
    - The update started the app before the carry-over, so a photo taken
      in at that moment rebuilt its camera from the GPS alone and its old
      hand corrections were lost. The app now stays stopped until the
      carry-over and the tag script are done; both run with
      `docker compose run`, and the report goes to
      `logs/carry-over-deployments.txt`.
    - The carry-over committed per camera and set its mark at the end, so
      a run that broke off wrote double statements on the rerun. One
      transaction now.
    - Editing a deployment set to start after the newest photo did not
      replace its open correction (`_statements_of`).
    - A shortened deployment joined back when a stated deployment at the
      same site sat right before it (`join_same_site`).
    - A short trip of exactly 7 days across a clock change was suspicious
      on the server and not in the browser (`daysBetween`).
    - Changing only the site of a deployment that ended in a move cut it
      at midnight and left the photos of that morning as a deployment of
      their own. A day left as it was now keeps the deployment's own time.
    - A deployment set to start in the future counted as the camera's
      current site today. Decided with Peter: no day after today can be
      set (today in the server timezone, `server_today` in
      routers/admin.py), instead of teaching every reader of the current
      site about planned deployments. Known limit: a deployment whose
      photos are dated in the future by a wrong camera clock cannot be
      edited until that day has come.
    - An SD card of a recognised camera lost every photo without GPS: the
      upload hides the site field then, and the worker skipped them
      ("until phase 4", step 2b). So a camera without GPS could not import
      a card at all. The skip is gone: such a photo is stored as a live
      one is and follows the camera's deployments, or waits for Set site.
      Asking for a site on that screen stays for phase 4.
      The same for a location that cannot be right (0, 0, which some
      cameras write without a fix): no longer skipped, stored without a
      reading, as live ingestion always did.
    Measured, no change: one rebuild reads the camera's whole history,
    0.32 s on the largest camera on dev (20,522 photos).
  - Audit against programming principles, 27 Nov (three independent
    reviews: server, front end, scripts and tests). Verdict: the core is
    sound, the debris sat around it. Done:
    - The suspicious rule had three copies (SQL, browser, a test copy
      that rounded differently). Now one SQL condition, `SHORT_TRIP_SQL`;
      the list returns `short_trip` and the browser reads it.
    - The rules of an edit moved from the router to
      `utils/deployment_edits.py`; the time helpers to
      `utils/server_time.py`; `period_of_days` to shared.
    - Removed, nothing read them: `answers_move_at` and its unreleased
      migration, `merged`, `site_created`, the bulk form of checked.
    - The browser refreshes through one `invalidateDeployments`, words
      deployments through `components/deployments/format.ts`, and calls a
      correction `Correction`. The deployment window is split into the
      answers hook, an evidence card and the layout.
    - The carry-over tests are in the repo (`tests/db_ingestion`).
    - Comments that named dropped screens or told history are reworded.
    Left as is: To do's read that writes, this plan file (goes after the
    release), the carry-over's copy of two rebuild functions.
    Fixed the same day, decided with Peter: effort counts to a last day
    only when a person typed it (`deployments.last_day_set`, migration
    `20261127_deployment_last_day_set`). Changing only the site, "It
    stayed", uploads and carried-over history count to the last photo.
  - Fixed 27 Nov, the "Please select a project" glitch. Not a stale copy
    of the app: five pages showed that line whenever no project was
    selected, also while the project list was still loading. Normally a
    tenth of a second, about a second right after a deploy (server log of
    dev: the list arrived 1.1 s after the app started), and for ever when
    the request failed, since nothing selected a project after that.
    `AppLayout` now shows a project page only once its project is
    selected, and says loading, or that the list failed with Try again.
  - Still open before the release: the phone check on a real phone
    (layout checked in Chrome's phone emulation, 27 Nov).
  - Fixed 26 Nov, was blocking: the update's migrations could deadlock
    with the running app. `20261121_deployment_checked` drops `feed_events`,
    which needs exclusive locks on the tables it refers to, and a worker
    reading those tables at that moment took them in the other order. Seen
    in 2 of 10 restores on dev (drenthe, pwn). `update-database.sh` now
    stops every service except postgres, redis and minio while it
    migrates, and starts them after (`018983c6`); that start replaces the
    three restarts it did after the migration. Tested in six restores
    under load, which passed but did not reproduce the old deadlock
    either, so the proof is that nothing else is connected while the
    migration runs. An update now has about a minute of downtime.
  - History, one line each (details in git):
    - 20 Nov: a Deployments page with a timeline (3a), then a review page
      with To check and History tabs.
    - 20 Nov: simplified after an audit ("it feels like an administration
      website"): one Camera updates page, Right and Wrong, no timeline.
    - 20 Nov: the check one at a time like image verification; then no
      page, a chip on the Cameras page.
    - 21 Nov, walkthrough S01: one "Wrong site?" (now Edit) per deployment in the
      camera panel; Corrections hidden while empty; slide-out tabs on one
      row; date fields on iPhone.
    - 21 Nov, walkthrough S02: the check in the image verification frame;
      a menu, then the page back as a table with filters and bulk actions
      (finding one decision among hundreds needs a table); only moves and
      corrections; named Moves; columns split, one line per row, distance.
    - 21 Nov: two rebuild bugs fixed (pins, Undo), see above.
    - 22 Nov: quieter, automatic first: one question, under Admin tools,
      fewer columns, the decision as a caption under the buttons.
    - 24 Nov: the window guessed which move an undone correction belonged
      to and could pick the wrong one; replaced by the exact keys above.
    - 24 Nov: maps made readable on satellite, all of them, not only the
      moves map: a white ring on every marker (one shared part instead of
      four copies), magenta for what you look at, a bright alert red, and
      the colour ramps of AddaxAI desktop with Heat as default
      (`FRONTEND_CONVENTIONS.md`, "Maps are different").
    - 24 Nov, walkthrough S03: the check window closes after the last row;
      every move asks the same question (the way back of a short trip had
      its own); the table stays newest first so rows do not jump.
    - 24 Nov: all nudges in one place, To do in the top bar (DEVELOPERS.md,
      "To do"); the Moves badge went with the rest.
  - Step 3c (moving a pin, a merge that can be reversed) stays dropped
    until someone asks for it.

- **Walkthrough with Peter**, started 20 November 2026, all twelve done
  on 26 November 2026. Feedback was fixed as it came, not saved up.
  - Dev: "Deployment scenarios" is project 8 since 26 November (project 5
    was deleted and all twelve loaded fresh), every scenario fixed the way
    a user would: S02, S09 and S12 checked, S03 It stayed, S04 split at 14
    Sep with Stream east after, S06 at Meadow from 1 Oct, S11 Fen from 1
    Oct. The scenario script gives on-time photos their own day as arrival
    time, so S08 reads inactive.
  - 26 Nov, after the walkthrough: the Moves page became the Deployments
    page, one row per deployment; a move is the Moved from column. Only a
    suspicious deployment asks a question (Right, Wrong); every other one
    is fixed with Edit. No bulk actions, no Checked status, the bulk undo
    route went (DEVELOPERS.md, "Deployments page").
  - Not yet seen on screen after the map colour change: the site picker
    (Add site) and the merge picker (Sites, Merge); they use the shared
    marker part, so they should be fine. "Moves layout test" is project 6, 20
    rows with long names, made by a throwaway script, not in the repo. The
    next scenario: `docker compose exec -T ingestion python
    /app/scripts/dev_deployment_scenarios.py --only S03`. To start over,
    delete the project (images first, then cameras, sites, project) and
    run `--only S01`.
  - Per scenario, a card for Peter: what really happened, where to look,
    what he should see, what to do. Then "next" or feedback.
  - The scenarios, what really happened, and the answer on today's
    screens: S01 stays at Pond (nothing). S02 Pond to Ridge on 1 Sep (It
    moved). S03 a false move by a GPS burst on 10 Sep (suspicious; It
    stayed, on the trip out). S04 moved 180 m on 15 Sep, unseen (camera
    panel, Edit, Stream east from 15 Sep). S05 one stray fix 3 km
    off (nothing). S06 no GPS, at Meadow from 1 Oct (Cameras page, photos
    without a site, Set site). S07 GPS gaps in October (nothing). S08
    silent since 20 Sep (nothing, shows inactive). S09 Old mill, Beech
    wood in September, Old mill (It moved twice). S10 next to S01 at Pond,
    its own spot (site panel, Deployments tab, Edit on its card, + New site). S11 moved on 1 Oct,
    first photo on 8 Oct (camera panel, Edit, first day 1 Oct). S12
    moved on 1 Sep, August photos from an old card arrive last (It moved).
  - Test photos show blurred until detection processes them.
  - Found at S10 (25 Nov): a deployment was drawn four ways. Now one card
    (DeploymentCards) in the camera and site panels, the site panel has one
    Deployments tab, and Edit deployment shows Now and After saving as
    cards from a server preview (the save, rolled back).
  - Found at S06 (25 Nov): views that need a place left photos without a
    site out silently. Now each says so in its card's info line (`useNoSiteText`),
    Exports ask at download, Images has a "No site" filter, and the trend
    per 100 trap-nights counts only placed photos. See DEVELOPERS.md,
    "Photos without a site".

## How to work on this plan

These rules hold for every phase and every session that builds from this plan.
They come before any detail further down. When a detail in this plan conflicts
with them, the rules win and the detail is discussed with Peter.

- **KISS, DRY, YAGNI.** Prefer the simple, robust solution. Build nothing
  before it is needed. A minimal set that caters for all is good design.
- **A simple model beats a perfect one.** The goal is rules a user can predict
  and a maintainer can read. No pile of heuristics to fit every scenario. When
  a case does not fit, say so and leave it out. Do not add a rule for it.
- **Explainable beats identical.** Prefer one simple rule that explains its
  results over small heuristic rules that make every number match. A few dates
  or photos that shift are fine when the rule explains them. Do not add a
  special case only to make a test or a before and after comparison pass.
  Peter, 19 November 2026, after two such rules crept into the carry-over.
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
- **End every message to Peter with a plain English summary.** A few short
  sentences at the bottom, no jargon, also after a report, a question or a
  deploy. This is the global rule in `~/.claude/CLAUDE.md` and in
  `CONVENTIONS.md`, repeated here so no session on this plan skips it.

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
- Dev stays on `deployments-phase-2` until the branch is merged, see "Main or
  a branch".
- After the push, watch CI (`gh run watch`) before calling the step green.

## Main or a branch

Decided by Peter on 19 November 2026: **the whole feature is built on one
branch, `deployments-phase-2`, from step 2a to step 4, and released in one
go.** The name says phase 2 because that is where it started.

- Work on `main` goes on next to it. Merge `main` into the branch often, so
  the two do not drift apart.
- Dev stays on the branch while the feature is built.
- Steps 1a and 1b are on `main`. They change nothing users see and can be
  released any time before the branch.
- Step 5, the better move check, comes after the release. It needs the
  statements people write in real use as its answer key.
- Before the release the gate of step 2a is run again on the finished
  branch, against every production dataset.
- The local test folder stays until the branch is merged.

What follows for every decision: **no stopgaps.** Nothing is built only to
cover the time until a later step, because no user ever sees that time. When
a later step on this branch does a thing properly, the earlier step leaves it
alone. Do not ask Peter what should happen "until then".

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

1. **Raw readings.** The GPS of every photo, in real columns. Written once,
   never changed. Daily reports store their GPS too, but they are not
   readings: not every camera type sends reports, so only photos make
   deployments.
2. **Statements by people.** One row per decision: camera, site, from, until,
   who, when. Rows are never edited. A newer statement wins over an older one
   where they overlap. Removing a statement shows what is underneath. This
   table is also the history.
3. **Deployments.** The result, computed from layers 1 and 2 per camera. The
   rest of the app keeps reading the `deployments` table and
   `images.deployment_id` as it does today.

### How one camera's deployments are built

One function in `shared/`, without database access, takes the camera's readings
in capture order and its statements, and returns the deployments. Since step 1b
it exists without statements: `build_deployments` in
`shared/shared/deployment_build.py`.

- It walks the readings with today's rule: 250 m from the deployment's own pin,
  two readings to confirm a move, the move dated back to the first far reading.
- It walks them in the order it is given. Phase 2 gives capture order. The
  replay of step 1b also gives arrival order, which reproduces what live
  ingestion stored.
- Each deployment has an exact start and end time, and the end of one is the
  start of the next. The dates follow from the times with today's rule: the
  day of a move belongs to the new deployment, so every day counts once for
  trap-days. The time columns come in step 2a.
- A move is measured against the camera's own earlier readings, never against
  the pin of the site. The site is a label on the deployment. So a person can
  assign a period to a site 400 m away without the next photo causing a move.
- Inside a statement's period there is one deployment at the stated site, and
  cuts from GPS are ignored there.
- After a period with an end, the walk starts fresh from the next reading.
  A statement without an end fixes the past up to the camera's newest photo
  when it was made, and after that the walk carries on from it. A camera
  without GPS has nothing that contradicts the statement, so it runs until
  the next one. (Refined in step 2a.)
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

### Uploaded photos without GPS

Photos from an SD card often carry no GPS. They need no special handling.

- Their GPS columns stay empty. The site's pin is never copied into them: that
  would put made-up data in the raw layer, pull deployment pins towards the
  site pin, and spoil the answer key of phase 5.
- Their place comes from the person who uploads. Choosing a site in the upload
  is a statement: this camera stood at this site from the first photo to the
  last. The photos then follow the deployment that covers their capture time.
  This is how Wildlife Insights, Agouti, TRAPPER and Camelot work for every
  upload.
- An upload never ends in "no site yet". That state is for live cameras. In
  an upload the person is at the form, so the form asks:

| Upload | What happens |
|---|---|
| No GPS in the photos | A site is required, the upload cannot start without one |
| GPS in the photos, no site chosen | GPS decides, as today |
| GPS in the photos and a site chosen | The chosen site wins, the GPS is still stored as readings |

- The period runs from the first photo to the last by default and can be
  changed in the form. A camera that stood quiet before its first photo gets
  no effort for that time unless someone widens the period. Asking for setup
  and pickup dates on every upload is what users complain about elsewhere, so
  the dates stay optional.
- Each upload is its own period. Today a second upload to the same site widens
  the camera's existing deployment there, however old, so it can run straight
  through a time the camera stood somewhere else
  (`get_or_create_bulk_deployment`, read from the code, not tested).
  Statements end that.

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
  an upload to a chosen site, or a bug. A deployment set by an upload has no
  readings, so the replay can never rebuild it. spw project 4 alone has
  11,811 such photos.
- Timestamps. Deployments have dates today. The build cuts on capture time and
  returns start and end times, with the dates derived by today's rule, so
  trap-days do not change. Settled in step 1b. The columns are added in step
  2a, when the rebuild fills them, not before.

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
  the deployment as it is. Every deployment made by an upload to a chosen site
  falls under this and becomes a statement with its camera, site and dates.
  Statistics before and after the update must be identical on every
  production dataset.
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

Steps 2a, 2b and 2c each end with a deploy of the branch to dev and an
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

Steps 3a, 3b and 3c each end with a deploy to dev and an end
to end test in the browser, see "Deploy to dev".

### Phase 4: bulk upload

- The review step asks for a camera (an existing one, a new one, or unknown)
  and a site. That becomes a statement for the date range of the photos. The
  site is required when the photos have no GPS, see "Uploaded photos without
  GPS" under the model.
- A recognised camera with GPS only adds readings. The rebuild runs once at the
  end of the job, so an old SD card can no longer disturb the current
  deployment.
- The made-up camera `bulk-cam-<site>` stays only for "unknown camera".
- An "Upload images" button on a site, as in the Écrins fork.
- Check with Théo Lechémia (issue #81) before building. He offered pull
  requests for the same three changes.

Ends with a deploy to dev and an end to end test with a real SD card upload,
see "Deploy to dev".

### Last step: user docs

Written once, with `/docs-partner`, when the screens are final. Pages and
sentences that are out of date, found in the code read of step 2c:

- `docs/sites-and-deployments.md`: GPS on every photo, "nothing to do by
  hand", "placements", "It did not move" as the one action that cannot be
  undone, a site can be deleted, the Placements tab.
- `docs/camera-requirements.md`: GPS listed as required, photos without GPS
  rejected.
- `docs/upload-sd-card.md`: the reason a photo is skipped without location
  (phase 4 changes this again).
- `docs/setup-guide.md`: a site is made from the camera GPS, "placement".
- `docs/cameras/willfine-4-0t-cg.md`, `docs/cameras/swift-enduro-4-0pcg-r.md`:
  GPS required, a photo without it is rejected.
- `docs/operations.md`: missing GPS as a rejection reason.
- `docs/architecture.md`: deployments made from GPS only.
- New: cameras without GPS, Set deployment, Fixed periods, photos without a
  site, how effort is counted.

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

**Measured on 26 November 2026, no change.** `scripts/analyse_move_rule.py`
(read only) ran on dev against every production dataset (lab, npuh, drenthe,
spw, pwn): 197 cameras with GPS, about 219,000 readings. It builds from the
GPS alone, without the corrections people made.

- GPS noise: 95% of readings lie within 8 to 41 m of the middle of their
  deployment, depending on the server; single readings reach 470 m (spw).
- The noise also comes as drift: for 1 to 3 days the fixes sit 100 to 230 m
  off together, then return. Seen 16 times on lab, drenthe and spw. Requiring
  more far readings in a row does not stop it, because it lasts many
  readings.
- 250 m is the lowest reliable distance. All servers together (moves, of
  which short trips out and back): 250 m 22 (2), 200 m 33 (7), 150 m 39 (9),
  100 m 64 (19), 50 m with 3 readings 248 (97). Lower distances add drift,
  not real moves: no lasting shift of 100 to 250 m exists inside any
  deployment, and the eleven of 30 to 60 m have too few days after them to
  tell from noise.
- Lowering only the move distance would change little anyway: a new
  deployment takes the nearest site within 250 m, so a 120 m move joins the
  old site again.
- Suspicious stays one rule. Of the 22 moves, the only two that look false
  (out and back after 1 and 4.9 days, 4 and 2 photos) are short trips, which
  it already marks. Other signs added nothing: confirmed by one burst (4, all
  real, so candidate 1 above is not needed), 5 photos or fewer (1, real),
  over 20 km (4, cameras tested at an office), 250 to 400 m (5, the two
  short trips and three that stayed). Seven days fits: false moves and drift
  return after 1 to 3.4 days, one after 7.4.
- Not scored against human answers: the update drops the old feed that held
  "did not move", so the verdicts rest on the shape of each move.
- Side findings: 6 pwn cameras have their first one to three photos at a
  test place 2 to 49 km away (the open point on a lone first reading); 12
  pairs of pwn sites lie within 50 m of each other, all named and placed by
  people, so deliberate, not drift. The other servers are not checked for
  close pairs.
- Revisit only when a new camera type or project shows other GPS: rerun the
  script after a restore, it prints counts and camera ids only.

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
  until the branch is merged, then they are deleted. No CI job, no new packages.
- The tests assert on the resulting rows, not on the functions, so they keep
  working when phase 2 replaces the code.
- GPS readings are two plain number columns, not a PostGIS point. Nothing
  queries readings by area, and the build function reads them in Python.
- The backfill runs in the migration, not as a script.
- Uploaded photos without GPS keep empty GPS columns, and the uploader's
  chosen site is their statement. No made-up readings, no "no site yet" for
  uploads.
- INSTAR waits until a project uses it.

Decided on 19 November 2026, in the planning of step 1b:

- Deployments get exact start and end times, the end of one being the start
  of the next. The dates are derived with today's rule. The columns come in
  step 2a.
- Daily reports do not make deployments. Only photos do. Not every camera
  type sends reports, and more types are coming.
- The replay labels each difference with a reason and counts them. Only what
  stays unexplained is looked at by hand.
- The replay builds in both orders: arrival order to prove the function, and
  capture order to show what phase 2 changes.

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

- Phase 2: what happens to deployments that a daily report opened before any
  photo arrived. Reports no longer make deployments, so the rebuild starts
  them at the first photo. Pin the old start with a statement, or accept the
  later start.
- Phase 2: a lone first reading far from the rest. In capture order it opens
  a deployment of its own, which can also count months of effort at the wrong
  place (pwn, three cameras, see the notes of 1b). Hold the first reading
  like any far one, or leave it to statements and phase 5.
- Phase 3, settled in 3a: viewers do not see the Deployments page. The
  Insights timeline stays and shares its axis code with the page.

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
