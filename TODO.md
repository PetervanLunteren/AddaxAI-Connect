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

- [ ] Display the detection confidence score for images classified as "empty", so that users can see how close each image was to the detection threshold. A clearer understanding of this value would allow us to fine-tune the optimal threshold much more precisely.

- [ ] Fix the confidence score filter (both classification and detection) so that the slider operates continuously rather than jumping between fixed steps. As it stands, it is impossible to select a precise range such as 75–100%, which limits our ability to filter images meaningfully.

- [ ] Add a filter by data validator, allowing users to retrieve all images validated by a specific person. This would make it easy for a more experienced colleague to review the work of interns or junior validators, and for species specialists to re-check identifications made by their peers.  This could be an important quality control step in collaborative workflows.

- [ ] Add a time-of-day filter so users can select images that fall within a defined hourly range. This would be useful for behavioural analysis.

- [ ] Allow users and/or projects to define custom keyboard shortcuts for encoding observations. For example, assigning "w" key to Wild boar and using arrow keys to adjust the individual count. Even a few seconds saved per image translates into significant time savings when working with validation.


- [ ] Add customisable flags that users can assign to images to mark specific events of interest, such as "Notable observation", "Identification issue", "Infraction", or "Predation event". This would make it much easier to retrieve and review specific cases at a later stage, without having to rely on free-text notes or external tracking systems.

ALERTS

- [ ] Allow users to configure alerts for specific camera conditions: full SD card, battery below a defined threshold, or no signal received for a set number of days. While this information is already accessible via the interface, receiving proactive notifications would greatly improve field maintenance management and reactivity. The ability to set these alerts on a per-camera basis would be an additional advantage, as it aligns with the territorial management approach (more explanation below).

USERS

- [ ] Introduce a user role with access restricted to a defined subset of cameras, going beyond the current binary admin/user system. We work closely with forest agents who are each responsible for distinct territories within the camera network. Some of them are sensitive about other agents having visibility into their zones, and a territorially scoped access level would address this directly.

CAMERAS

- [ ] Add structured fields to log maintenance events.  Such as the date of the last SD card retrieval and the last battery change, along with a dropdown to record which user performed the maintenance (similar to the existing SIM card expiration date field). We currently track this information in a shared Drive file, which is functional but not ideal. Having it directly within the platform in a structured format would standardise maintenance tracking and reduce the risk of oversights.


MAP (INSIGHTS MENU)

- [ ] Set "points" as the default map display mode instead of hexbins, as this better matches our typical use of the map view.

- [ ] Allow the selection of multiple species simultaneously on the map, merging their RAI (Relative Abundance Index) values to display combined abundance. A concrete use case: we often want to visualise the distribution of large game as a whole (red deer + wild boar + roe deer), which is currently not possible.

- [ ] Introduce additional map visualisation options beyond abundance/RAI.  For example, species richness when a subset of multiple species are selected. This would help identify locations with the highest biodiversity within the network, which is directly relevant to habitat assessment and conservation planning.


BLURRING 

- [ ] Make the blurring of people and vehicles independently configurable, so that the choice for one does not affect the other. Different situations call for different privacy handling depending on the category.  

- [ ] Make blurring reversible, with this capability restricted to administrators or protected by a specific access code. A concrete example: if a person is suspected of camera theft or an forestry infraction, it may be necessary to unblur their image for identification purposes. This feature would need to be tightly access-controlled.

- [ ] Allow blurring settings to be configured on a per-site basis. On public paths, blurring is important for privacy compliance, whereas on private land, unblurred images can be a valuable tool for rangers dealing with trespassing or enforcement cases.

MAJOR IMPROVEMENTS

- [ ] Explore the possibility of a theft-detection alert system that sends a notification (e.g., via Telegram) when camera tampering is suspected.  For example, when the framing shifts suddenly or an incoming image differs significantly from the previous one. Camera theft is a recurring problem for us, and we work closely enough with forest rangers that a rapid response would be feasible. We acknowledge this is a complex feature and are not proposing it as a near-term priority, but we wanted to put the idea forward.

- [ ] Add support for secondary classification models, as discussed with Simon Chamaillé and Gaspard Dussert. The concept: after DeepFaune detects a given species (e.g., red deer), a secondary model further classifies the individual into a management-relevant category (adult male, adult female, fawn, etc.). Age-class data is central to hunting quotas and wildlife management plans.  We currently encode this manually, and automating it would significantly increase both efficiency and dataset reliability.

- [ ] Add a configuration menu for automated, scheduled analytical reports sent by email at regular intervals. For example, a monthly summary of raccoon detections and abundance estimates per camera across the network. This would allow managers to stay informed without having to log in and generate reports manually each time.

## Possible future features
- [ ] Make a script that tests updates on prod data on a dev server. Basically, I want a scipt (or edit restore.sh) that takes these args: original_code_commit hash (to see from where we need to update test it), the data to restore from backup disk (to ghet prod data to test it on, so you'll need to do more or less the same as restore.sh), which means youl need the source domain, the date is always the latetst, and --force always (this is for testing updates, so always on dev dummy data, perhaps with a confirmation prompt?). You see what I need? I just want a way to test updates more automaticaly. What do you think? What is best here?  
- [ ] Update the documentation regarding updates, restoring, and testing. Basically we need these pages (then we cover it all, right) 1) restore prod server to a backup state, 2) test update on dev server with prod data, 3) update prod server with prod data, 4) restore prod server from prod backup. Am i missing something? Perhaps deployment is one of them too. That is also a sever management thing. What do you think? Are there more server management things I as a server manager must do frequently? These pages should be written if they are not there already. So basically my first task is, do you agree with me above? And what do we have in terms of docs already (and are they up to date), and do they need updating? Investigate. Audit. I want the regular tasks like testing, updating, restoring, etc to be automated with scripts to make my like easier. If we have the scripts ready, lets make documentation pages about each, with the neccisary steps. (Or update the exisitng ones - some of them still talk about Digital Ocean snapshots, but nowadays we have our own backups in S3 buckets). 
- [ ] Make per-host group_vars so we can store secrets per host and run it cleanly like ansible-playbook --limit pwn . perhaps als work with the prod and dev things. Explain how ansible yamls are typically used, and how power user work with it when manageing multiple servers. Now its becoming a hassle since i need to change the vaklues every time i do server management. I got his advice, is this good advice? Is this the standard? " per-host group_vars (lab.yml, spw.yml, pwn.yml) with each server's real secrets, encrypted with ansible-vault (never plaintext in the repo — convention #4). Then a server is fully reproducible from code + Wasabi data, and snapshots become optional."
- [ ] multi language
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI WebUI. This improves the overcounting.... 

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

