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
- [ ] species-specific confidence thresholds

Lets investigate the option to have species-specific confidence thresholds. These would be classification thresholds, so extra on the already implemented detection threshold. WOuld this be dififcult to add? I'm thinking a general slider that determines the thresh for all classes, and an option to open a modal that shows all classes with separate sliders for each. Perhaps with the main slider above and checkboxes to say "for this species I want to set a thresh apart from the main CLS thresh". What do you think? What would be you thoughts in terms of code complexity, UX, UI, users added benefit, etc. Also, what should happen with the detections that fall below the thresh? Remove from statistics and visualisations? Just like the detection.threshold already does? WOuld make sense. And also, which list should we show for the separate sliders? The same list as is shown when selecting a new label? That is already a curated list with all labels in the DB plus custom ones, etc. What are your thoughts? Lets make a plan! 


- [ ] When navigating through images, is it possible to filter and display only those classified as “empty” in order to review false negatives? Should we add Empty as a label and change the filter "Species" to "Labels" so you have full control? 
- [ ] For each picture, it would be useful to add “stage” (adult, subadult, juvenile) and “sex” (male, female) fields, with “Unknown” as the default value.
- [ ] WOuld it make sense to have a list of behaviours to choose from? This can be image level.
- [ ] Could options such as “empty” and “unknown” be added as tags for images?
- [ ] It would be helpful to have a “like” feature (or similar tag) to send selected photos to a dedicated “Gallery” tab. This would be useful for reporting and communication purposes, allowing us to easily select the best images without browsing the entire dataset.
- [ ] Could brightness and contrast adjustment tools be added for night images (similar to Agouti)?
- [ ] Could a reference photo be attached to each camera to help identify its location in the field? We can have an upload feature in the camera slideout. 
- [ ] Could a “Performance” tab be added, including a confusion matrix summarizing corrected annotations (false positives, false negatives, misclassifications)? How would this work?


## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?

