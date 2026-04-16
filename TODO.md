# TODO list

# Add camera profile
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

# Verification tasks
- [ ] does the exsessive image notification work? 
- [ ] CHECK IF RESOLVED AFTER DELETING AN EMPTY IMAGE FROM CURATION (trigger check) - There is an inconsistency between the “Camera” and “Map” tabs: some deleted locations (test data) still appear on the map.

## TODO Priority 2
- [x] is it difficult to have the Activity pattern in the dashboard resemble a clock with hours around it? 
- [x] it seems like the exessive images alert doesnt work. For PWN (ssh pwn - only read! do not write or execute - real data), i have set an alarm for 25 images, but I can see that camera "Zeepoort NO" has sent more on apr 6 and 8 (41 and 46). Why didnt I get an alarm email? Check the DB, the logs, and figure out whats going on. Investigate and report back. 
- [x] Now it shows the bounding boxes on every image in the ImageDetailsModal by default. But the boxes are actually AI predictions, If a user adds an aninal via verification, it doesnt add a bounding box. Perhaps we can change the default to not show anything, but have a toggle to "Show AI predicitons" which makes it clearer that these are AI predictions, right? 
- [x] Can a 2-minute independence interval be configured to ensure consistency with our previous projects?
- [x] In the annotation tool, the dropdown only allows selection of species already observed in the project. Can this be expanded to allow corrections to species not yet observed?
- [x] Similarly, how can a new species be added to the list? Could predefined species lists (like in Agouti) be implemented?
- [x] In the settings, I am unable to link a Telegram account for alerts, and I also get an error when saving preferences. Could you please check this? Errors and also cant save notification settings. Should be fixed in the latest version already. No change needed. Already fixed. 
- [x] species-specific confidence thresholds
- [x] when downloading an image, something goes wrong with the bboxes, as the inner box is completely black, while the outer box should be dimmed for the spotlight effect. Investigate. 
- [x] When navigating through images, is it possible to filter and display only those classified as “empty” in order to review false negatives? Should we add Empty as a label and change the filter "Species" to "Labels" so you have full control? 
- [x] For each picture, it would be useful to add “stage” (adult, subadult, juvenile) and “sex” (male, female) fields, with “Unknown” as the default value.
- [x] can we add a border round the plus minus buttons in the verification modal? Now it does not seem like these belong together : [- 1 +]
- [x] WOuld it make sense to have a list of behaviours to choose from?
- [x] Could options such as “empty” and “unknown” be added as tags for images? Shipped as a "needs review" flag — empty already covered by verification.
- [x] “like” feature 
- [x] Could brightness and contrast adjustment tools be added for night images (similar to Agouti)?
- [x] Could a reference photo be attached to each camera to help identify its location in the field? We can have an upload feature in the camera slideout. 
- [x] Could a “Performance” tab be added, including a confusion matrix summarizing corrected annotations (false positives, false negatives, misclassifications)? Shipped as a Performance page with both an instance-level aggregate (per-species human vs AI counts) and an image-level top-1 confusion matrix. 
- [x] despite having the setting, Connect's activity pattern chart doesn't actually use the timezone — it extracts EXTRACT(hour FROM uploaded_at) from UTC directly, which is a known inconsistency in their code. So Connect's activity chart is arguably broken for non-UTC zones. Fix this. And then update the colours in the activity pattern (night, dusk, day) based on the timezone settings! 
- [x] can we set the default timezone for a new server to the browser settings of the server admin on first login? default filled by the browser on project creation
- [x] make caption or title of setting timezone more explicit. "Whatever the cameras were set to."
- [x] write the new tz logic and convenstions to the DEVELOPERS.md
- [x] SHould we make the dates in the UI table of cameras (last image, last report) more like this "3 Apr, 2026" instead of only digits (confusing hwihc is dd and mm). Makes sense?
- [x] Add the country or region to the TZ dropdown too and make sure the search also does that. So not only "Nairobi" but something like Kenya, Nairobi. What do you think? How would users search? By country, city, or continent? What is good UI UX?
- [x] The activity pattern in the dashboard has a card with times and detection counts that show up woth hover. Can we make this card alpha 0.85? Then we still see whats below it (vaguely). 


## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?
- [ ] multi language
- [ ] make phone friendly
- [ ] investigate the option to have a cold storage MinIO because we are heading towards the max storage on our Ubuntu servers (160GB). I was thinking of https://www.transip.nl/bestel/block-storage/configureren/prm/989de7170ee2b85b115e1bfcd4b2ab86a2e07131 TrasnIP block storage of 2TB HDD. I understand that this is a cold storage, so latency is bad. But my idea was the following: keep postgres DB on server itself, store all MinIO on the cold storage, and keep something like the most recent 20GB of thumbs on server and most recent 50GB images on server for fast access. Then a daily check would remove the overflow images from these minIO storages. If thumb or image cant be found on fast access, fetch it from cold storage. What do you think of this plan? any htings I'm forgetting? How does TrasnIP block storage work? Is there an API we can use? Do you see any difficulties? Do web queries and investagte. Make ti thourough.  Instructions:
* Switch to plan mode, I want this task to be done with "plan mode on"
* Read all MD file in root to get a understanding of the project. 
* If something is unclear at any point, stop and ask before continuing.
* Prioritize simplicity and clarity over perfection. The code must be clean, easy to read, and understandable for collaborators. Avoid unnecessary complexity.
* I'm not in a rush. Please be precise and do the task thoroughly. 
* Please ask me any question for clarification. I would rather that you ask too many questions than assume certain details. 
* Ask me clarifying questions before beginning. Based on the conventions set out in CONVENTIONS.md and your knowledge, give your recommended solution to each questions you ask me. The minimum number of questions to ask me is 10

