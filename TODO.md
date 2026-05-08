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




# TODO: revert TEMP verbose logging once cold-tier + backup verification is done.
#       - services/minio-tier-watchdog/watchdog.py: re-enable the boto3/botocore/urllib3 silencer
#         (the commented-out `for noisy in (...): logging.getLogger(noisy).setLevel(logging.WARNING)` block).
#       - scripts/backup.sh: re-add `> /dev/null` to every mc call in the bucket setup block
#         and to the two `mc mirror` loops (marked with `# TEMP:`).
#       Grep `# TEMP:` across the repo to find all of them.

# TODO: revert TEMP success-email branch in services/notifications/infra_alert.py.
#       Once cold-tier + backup have run clean for a week, drop the two TEMP blocks
#       marked `# TEMP: also email admin_email on status=ok`. After removal the
#       infra_alert job only emails server admins on failure, which is the
#       permanent behavior. Grep `# TEMP:` to find.



# prio 1
- [x] Customizable cameras-table columns
- [x] Add export to CSV from the cameras page
- [x] Bulk-edit cameras. 
- [x] Scheduled project reminders.
- [x] Invalidate other sessions on password change.
- [x] Add logos.
- [ ] See email from Quentin with TODOs
- [ ] PLace the current project name and the back link above the sidebar menu options, below the logo. In between. Can we make it more modern feel? Perhaps first preview a few on the dev server and then I can select one. 




> Naïve occupancy metric
We frequently use the naïve occupancy metric (i.e., the proportion of sites where a species is detected out of the total number of sampled sites). Could a visualization on the dashboard represent this? eg: bar plot comparing species?
- [ ] Have a look at how AddaxAI-WbUI does its insight pages. That way we have a little bit more room for analysis page wide. The dasboard is for quick views, the insights are for deeper analysis. WOuld you think something like this would work for AddaxAI Connect too? If so, how? WHich ones would make sense to move to a separate insights page? My thoughts are:
- Move the Naive occupancy to a separate page under insights. More room for an elaborate analysis. 
- move map to insights,
- move performace to insights, and make it two pages (just like AddaxAI WebUI - skip the redundant one)
- Make the same activity overlap as WebUI and remove the Species activity comparison from the dasboard () redundant then.
- Should we make a deployment timeline just like at AddaxAI-WebUI?

For all, use the same format, filters, "ABout this view" section etc. It must feel the same in AddaxAI Connect as in AddaxAI WebUI.

What do you think? Are there any difficulties? Anything worth flagging? Your honest opinion. 















Detection categories summaries are always zero…

image.png

Detection map visualization
On the detection map, points with no detections are difficult to distinguish from those with detections due to low contrast. Could the visualization be improved—for example, by displaying no-detection sites as transparent or hollow circles?

image.png
Activity pattern comparison graph
This graph is very useful, but differences in the number of detections between species make it difficult to read. Would it be possible to compare relative frequencies instead of absolute counts? Additionally, the color contrast could be improved for better readability.

image.png
Confusion matrix navigation
Clicking on a cell in the confusion matrix is very helpful for reviewing images and understanding misclassifications. However, the link currently leads to all images of the species rather than only those corresponding to the selected cell (e.g., false negatives). Could this be corrected so that it filters images based on the specific AI vs. human classification outcome?

image.png
Notifications
Currently, notifications can be configured by species. Could we also select specific cameras for which alerts should be triggered?

Would it be possible to enable email notifications?

image.png
Data labeling and classification
In some cases, species cannot be identified. Could an “Undetermined” or “Unknown” category be added for labeling?

image.png
In cases where the system correctly identifies a general category (e.g., “bird”), could we allow a secondary manual classification to refine the species (e.g., “Black Stork”), even if it is not recognized by the AI model?
These manual refinements would not need to affect performance metrics but should be reflected in the dashboard and available as filters when browsing images.
A similar example is the “Mustelids” category, which could be split into multiple clearly identifiable species.

image.png

Image management
Could a zoom function be added when viewing images?

Would it be possible to manually delete images without affecting the associated statistics and performance metrics?
In other words, the metadata would remain, but the image file would be removed. This would help free up significant storage space on the server. In practice, images are rarely revisited after initial review, and we could download them in bulk to local storage before deletion.
This would be especially useful for removing empty images that take up unnecessary space.

Could a filter be added to browse images based on detection or classification confidence?
This would make it easier to identify borderline cases. For example: Select raccoon images with classification confidence > 80%.

Could a “Select all” option be implemented for filtered image sets, with batch actions such as:

Deleting selected images (e.g., empty images)

Downloading all selected images at once

image.png

General questions
During the last meeting, I asked about the possibility of manually uploading images, to open the use of Addax with non-connected camera traps. However, I understand that this was not aligned with Addax’s current development priorities. As it would be a real game changer, do you think this significant improvement could be technically implemented in the future ?

Would it be possible to obtain the phone numbers associated with the SIM cards in order to test the remote control of the devices?







## TODO Priority 2
- [ ] 


## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?
- [ ] multi language
- [ ] can we make it feel native on iphone and android without having it like a normal app? You can continue an previous claude session with > claude --resume c24bfc22-4e66-4bdd-abc6-d41f92b5c0c7

