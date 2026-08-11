# TODO list

## TODO

BUGS

- [x] Fix the bug where previously encoded sex and age-class data is erased when editing an existing observation. This causes data loss and forces the user to re-enter information that had already been validated.

- [x] The Telegram messages have stopped sending an attached image. This is coming from the SPW server. Please investigate how this could be possible and also propose a fix. And of course add a test so this can't drift and happen again. 

IMPROVEMENTS

DASHBOARD

- [x] Split the dashboard into two distinct panels: one providing a general overview (species detection occurrences, validation progress, etc.) and one more specific panel where the user can select a species and a date range to explore activity patterns, sex ratios, age classes, and so on. Currently, filters have to be re-entered every time.  Separating these two views would make data exploration much more fluid.

- [x] Add group size statistics for one or several selected species, including average, minimum, maximum, and a histogram of group sizes. This would be a particularly valuable feature for behavioural research.  

- [x] How can we make the dashboard more visually appealing? Could we do for instance a photo of an animal saying  last detection? or on the explorer when you select one species you'll get the highest detection of that species cropped so you can see what kind of animal it is? I don't know, just spicing up the dashboard to make it more visually appealing. Please do web queries on how other platforms do it. advise me on how to make the graphs more visually appealing, More modern, Add cards or stuff like that. I want you to take your time. I'm not in a rush. What are best practices. Check other major platforms and websites and references that talk about this. I want the best UX UI. It must feel modern, professional and reliable. First, let's do a thorough investigation and then show me some previews of what you have found and what you suggest. Take your time, I have all the time in the world and all the tokens. Do web queries read best practices, do whatever it takes. 

- [x] Group size inside page: remove: "The detector misses animals standing behind each other, so verified counts usually come out higher."

- [x] A common scenario: A project starts and about 50 cameras all send there first image ever. All the file names will be something like img001.jpg. If they all are rejected because of bad GPS, only one is saved because the file names override in the rejected folder, Correct? So why don't we save the rejected files in the folder under a timestamped name or something like that so that it doesn't overwrite? Then we save all of them and we can inspect all of them and we can count how many came in etc etc etc. Now we miss information. 

IMAGES

- [x] Display the detection confidence score for images classified as "empty", so that users can see how close each image was to the detection threshold. A clearer understanding of this value would allow us to fine-tune the optimal threshold much more precisely. (Shown in the image detail view. A distribution view for real threshold tuning is a possible follow-up, see the conversation of 6 Aug 2026.)

- [x] The best photographs in the dashboard, And the last detection in the dashboard, They take quite some internet to load. How can we make this faster? Can we use the thumbnails? (Blur-up added 6 Aug 2026, the thumbnail shows immediately and the full image replaces it. If data usage itself becomes the problem, a ~1000px display rendition is the discussed next step.)

- [x] Fix the confidence score filter (both classification and detection) so that the slider operates continuously rather than jumping between fixed steps. As it stands, it is impossible to select a precise range such as 75–100%, which limits our ability to filter images meaningfully. (Sliders now step in 1% increments and the floor is rounded up to a whole percent, so exact ranges like 75-100% are always selectable. 7 Aug 2026.)

- [x] Add a filter by data validator, allowing users to retrieve all images validated by a specific person. This would make it easy for a more experienced colleague to review the work of interns or junior validators, and for species specialists to re-check identifications made by their peers. This could be an important quality control step in collaborative workflows. (A "Validated by" multi-select in the More popover, options come from a new endpoint listing the users who verified at least one image. 7 Aug 2026.)

- [x] make the filters in the images page in this order: Labels, date range, site, site tags. Leave the More Filters button as is. (Done 7 Aug 2026.)

- [x] Add a time-of-day filter so users can select images that fall within a defined hourly range. This would be useful for behavioural analysis. (Two hour dropdowns in the More popover. A start later than the end wraps past midnight, so night windows like 21:00 to 05:00 work. 7 Aug 2026.)

ALERTS

- [x] Replace the single species/site real-time alert settings with per-user detection alert rules, same architecture as the camera condition alerts. Each rule names its labels and can be narrowed by site, time of day (wraps midnight), minimum group size (per-species count), a cooldown per species and site (on by default for new rules, prefilled with the project independence interval), and a rarity lookback (species absent for N days, project-wide). Email offered next to Telegram. Existing settings migrate into one seeded telegram-only rule per user with identical behaviour; the old rule engine was deleted as dead code. (9 Aug 2026.)

USERS






MAP (INSIGHTS MENU)

- [x] Set "points" as the default map display mode instead of hexbins, as this better matches our typical use of the map view. (Done 7 Aug 2026, hexbins and clusters stay available in the Display popover.)

- [x] Allow the selection of multiple species simultaneously on the map, merging their RAI (Relative Abundance Index) values to display combined abundance. A concrete use case: we often want to visualise the distribution of large game as a whole (red deer + wild boar + roe deer), which is currently not possible. (Species filter on the map is now a multi-select and the counts sum per site. With an independence interval, events stay grouped per species, so the combined RAI equals the sum of the per-species RAIs. 7 Aug 2026.)

- [x] Introduce additional map visualisation options beyond abundance/RAI.  For example, species richness when a subset of multiple species are selected. This would help identify locations with the highest biodiversity within the network, which is directly relevant to habitat assessment and conservation planning. (A Metric select on the map switches between abundance, species richness, trap effort, and Shannon diversity. Richness respects the species selection, counts wildlife only, and is shown as observed values with trap-days next to it. 7 Aug 2026.)


BLURRING 

- [x] Make the blurring of people and vehicles independently configurable, so that the choice for one does not affect the other. Different situations call for different privacy handling depending on the category. (Two toggles in the project settings, backed by two columns. Existing projects keep their current behaviour through the migration. 7 Aug 2026.)

- [x] Make blurring reversible, with this capability restricted to administrators or protected by a specific access code. A concrete example: if a person is suspected of camera theft or an forestry infraction, it may be necessary to unblur their image for identification purposes. This feature would need to be tightly access-controlled. (Admin-only toggle in the image detail modal. The server enforces the permission with a hard 403 for others, every unblurred view is logged with the viewer identity, the response is never cached, and the toggle resets to blurred on every image. 7 Aug 2026.)

- [ ] NOT DONE - Allow blurring settings to be configured on a per-site basis. On public paths, blurring is important for privacy compliance, whereas on private land, unblurred images can be a valuable tool for rangers dealing with trespassing or enforcement cases.

MAJOR IMPROVEMENTS

- [ ] Explore the possibility of a theft-detection alert system that sends a notification (e.g., via Telegram) when camera tampering is suspected.  For example, when the framing shifts suddenly or an incoming image differs significantly from the previous one. Camera theft is a recurring problem for us, and we work closely enough with forest rangers that a rapid response would be feasible. We acknowledge this is a complex feature and are not proposing it as a near-term priority, but we wanted to put the idea forward.

- [ ] NOT DOING - Add support for secondary classification models, as discussed with Simon Chamaillé and Gaspard Dussert. The concept: after DeepFaune detects a given species (e.g., red deer), a secondary model further classifies the individual into a management-relevant category (adult male, adult female, fawn, etc.). Age-class data is central to hunting quotas and wildlife management plans.  We currently encode this manually, and automating it would significantly increase both efficiency and dataset reliability.

- [x] Add a configuration menu for automated, scheduled analytical reports sent by email at regular intervals. For example, a monthly summary of raccoon detections and abundance estimates per camera across the network. This would allow managers to stay informed without having to log in and generate reports manually each time. (Built 11 Aug 2026 as species reports, a third per-user rule type next to the camera and detection alert rules. A rule names its species and a rhythm, weekly, monthly, or quarterly, and the creator gets one email per period with the total, the change since the previous period, presence across active sites, and a per-site table with counts, trap-days clipped to the period, and detections per 100 trap-days. Counting follows the map, independent events when the project has an independence interval. Sites without effort are excluded so a missing camera is never read as an absent species, and a methods footnote warns when effort changed more than 25%. Site-restricted viewers are blocked, the report is project-wide. Not yet deployed to dev.)



##### Larger tasks

- [x] Allow users and/or projects to define custom keyboard shortcuts for encoding observations. For example, assigning "w" key to Wild boar and using arrow keys to adjust the individual count. Even a few seconds saved per image translates into significant time savings when working with validation. (Digits type the count directly, multi-digit like AddaxAI. Q, W, and E are species slots each user assigns in the shortcuts popover, stored per user per project in the browser. Arrow keys for counts already existed. 7 Aug 2026.)

- [x] Add customisable flags that users can assign to images to mark specific events of interest, such as "Notable observation", "Identification issue", "Infraction", or "Predation event". This would make it much easier to retrieve and review specific cases at a later stage, without having to rely on free-text notes or external tracking systems. (Image tags, same pattern as site and camera tags. Edited in the detail modal with autocomplete, filterable on the images page, included in the observations export. 7 Aug 2026.)

- [x] Allow users to configure alerts for specific camera conditions: full SD card, battery below a defined threshold, or no signal received for a set number of days. While this information is already accessible via the interface, receiving proactive notifications would greatly improve field maintenance management and reactivity. The ability to set these alerts on a per-camera basis would be an additional advantage, as it aligns with the territorial management approach (more explanation below). (Camera condition alert rules, private per user, per-camera scoping, email and/or Telegram, evaluated daily, fire once per incident and re-arm on recovery. Replaces the broken battery digest. 7 Aug 2026.)

- [x] improve the detections email. 

- [x] Add delivery-worker liveness to the infrastructure health checks. The problem, discovered 7 Aug 2026 during the camera alerts bug hunt: the notifications-email container on the dev server had been down since 13 July without anyone noticing. Every notification email (reports, alerts, reminders) queued into Redis and sat there for weeks; nothing surfaced the outage because the queue accepts messages whether or not a consumer is alive, and the daily infra alert only checks disk usage and backup freshness. The same blind spot exists for the notifications-telegram worker, and the infra alert itself is sent by email, so a dead email worker also silences the very alert that should report it. (Built 10 Aug 2026. The three notification workers stamp a Redis heartbeat every consume-loop tick, the loop got a finite 60 s BRPOP timeout so idle workers still tick. An hourly check at :15 alerts once per incident, re-arming on recovery, when a heartbeat is older than 15 minutes or a delivery queue is deeper than 200; alerts go to all server admins on both email and Telegram at once, whichever worker is alive delivers. The health page shows real heartbeat rows including the previously missing email worker. Prod checked by hand first, spw and lab both clean. Fire drill on dev passed, stop worker, alert fires once, held emails arrive after restart, state re-arms.)

- [x] Introduce a user role with access restricted to a defined subset of cameras, going beyond the current binary admin/user system. We work closely with forest agents who are each responsible for distinct territories within the camera network. Some of them are sensitive about other agents having visibility into their zones, and a territorially scoped access level would address this directly. (Built 10 Aug 2026 as an optional site allow-list on the project-viewer membership, no new role. Scoped by sites rather than cameras since cameras move between sites. Hard hide, out-of-scope sites do not exist for the viewer anywhere including exports and image bytes; data without a resolved site is hidden, fail closed. Alert rules are clamped at write and evaluation time; project-wide report emails are blocked for scoped viewers. Set per user in the project users page via a site multi-select on the viewer role, also at invite time. Four pre-existing access-control holes found during the audit were fixed first, including an image detail endpoint with no access check at all.)

CAMERAS

- [x] Add structured fields to log maintenance events.  Such as the date of the last SD card retrieval and the last battery change, along with a dropdown to record which user performed the maintenance (similar to the existing SIM card expiration date field). We currently track this information in a shared Drive file, which is functional but not ideal. Having it directly within the platform in a structured format would standardise maintenance tracking and reduce the risk of oversights. (Built 10 Aug 2026 as a per-camera maintenance log instead of overwritable last-dates, so history and who-did-it survive. One row per visit with date, actions from a fixed list, performer, note. Logged on a new Maintenance tab in the camera sheet, admin only, with a bulk action for trips that service many cameras. The derived last maintenance date shows in the list column, overview card, and camera export. The dead last_maintenance_at column from the initial schema was dropped.)

- [x] Would it be a nice idea to have a tiny little heat map on the Explore dashboard? So you get an overview of the species and map would be a good spatial exploration there. Of course it shouldn't replace the inside map, Just a tiny heat map. What do you think? What should be smaller or where should it be placed? (Built 11 Aug 2026 as a Detection map card in the left column of the Explore tab. Each site is a soft colored blob, darker means more detections per 100 trap-days, using the same endpoint and color scale as the full insights map. The card is inert, no zoom or pan or popups, and the whole card is one link that opens the full map with the current species, date and site filters applied.)

- [ ] The deployment timeline, perhaps we can have the deployments with their horizontal bars in a scrollable area so that the concurrent cameras graph in the bottom shows without having to scroll all the way down. This makes sense if you have a project with hundreds of cameras. Or maybe the same result but much easier:  move the concurrent chart to the top of the SVG. What do you think?

- [ ] When clicking on the mini map in the dashboard explorer, it opens the insights map. Should we do the same on the Mini activity pattern? So it opens the activity overlap in the insights? 

- [ ] Dashboard overview: rm: "Click a bar to open its images."

- [ ] Dashboard overview: Species detected: Is this the top eight? Or is this all? 

## Possible future features
- [ ] Make a script that tests updates on prod data on a dev server. Basically, I want a scipt (or edit restore.sh) that takes these args: original_code_commit hash (to see from where we need to update test it), the data to restore from backup disk (to ghet prod data to test it on, so you'll need to do more or less the same as restore.sh), which means youl need the source domain, the date is always the latetst, and --force always (this is for testing updates, so always on dev dummy data, perhaps with a confirmation prompt?). You see what I need? I just want a way to test updates more automaticaly. What do you think? What is best here?  
- [ ] Update the documentation regarding updates, restoring, and testing. Basically we need these pages (then we cover it all, right) 1) restore prod server to a backup state, 2) test update on dev server with prod data, 3) update prod server with prod data, 4) restore prod server from prod backup. Am i missing something? Perhaps deployment is one of them too. That is also a sever management thing. What do you think? Are there more server management things I as a server manager must do frequently? These pages should be written if they are not there already. So basically my first task is, do you agree with me above? And what do we have in terms of docs already (and are they up to date), and do they need updating? Investigate. Audit. I want the regular tasks like testing, updating, restoring, etc to be automated with scripts to make my like easier. If we have the scripts ready, lets make documentation pages about each, with the neccisary steps. (Or update the exisitng ones - some of them still talk about Digital Ocean snapshots, but nowadays we have our own backups in S3 buckets). 
- [ ] Make per-host group_vars so we can store secrets per host and run it cleanly like ansible-playbook --limit pwn . perhaps als work with the prod and dev things. Explain how ansible yamls are typically used, and how power user work with it when manageing multiple servers. Now its becoming a hassle since i need to change the vaklues every time i do server management. I got his advice, is this good advice? Is this the standard? " per-host group_vars (lab.yml, spw.yml, pwn.yml) with each server's real secrets, encrypted with ansible-vault (never plaintext in the repo — convention #4). Then a server is fully reproducible from code + Wasabi data, and snapshots become optional."
- [ ] multi language
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI WebUI. This improves the overcounting.... 
- [ ] Gundi integration
- [ ] Sensing clues integration


# Add INSTAR camera profile
INSTAR — implemented as a path-based profile.

- Custom-path format: `INSTAR/lat<LAT>_lon<LON>` (e.g. `INSTAR/lat52.02368_lon12.98290`).
- Camera registered in Camera Management with `device_id = lat52.02368_lon12.98290`.
- Path-based profile parses lat/lon from the path segment and datetime from the filename.
- `record/*.mp4` clips are logged and deleted (no video support).
- `Test-Snapshot.jpeg` is rejected as `missing_datetime`.
- See `docs/camera-requirements.md` for the full setup guide.

Open follow-ups:
- Confirm what the `A_` filename prefix means once more INSTAR firmwares are seen. If it turns out to be a per-unit channel ID, the device_id scheme needs to grow another segment.
- INSTAR sends no daily health reports, so the camera health page will stay empty for these cameras. Worth a UI hint someday.

