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
- [x] Customizable cameras-table columns. 
- [x] Add export to CSV from the cameras page, where it exports the entire cameras table.
- [x] Bulk-edit cameras. Row checkboxes plus an inline action bar above the cameras table (admin only). Four actions: add tags, remove tags, set SIM expiry (incl. clear), set notes. Backend: four POST endpoints under /api/cameras/bulk-* mirroring the image_admin pattern, each guarded by can_admin_project on every project the selection touches.
- [ ] Add key board short cuts for "Add camera" button, so one can make it quick qworkflow to add multiple cameras. 
- [ ] Now that we have been working on new features and buttons on the cameras page, perhaps it would be good look have a look at the buttons and how we can make it less noisy. How would other mature apps solve this? Perhaps just by icons and hover texts? Or icons with dropdowns and several options? Which one would you merge together? Perhaps '+' would show 'add single camera (form)' and 'add bulk cameras (CSV)'? More things to merge? Or just as spearate icons. I dont know. Do some suggestions and give me your recommendations based on other platforms and your view on UX and UI.  
- [ ] add a test to see the notificaitons for sim expiry date. Set a few this month and a few next month. 
- [ ] Add an option for project admins at project level to schedule custom notifications. I'm thnking a date and a text field. Herte you can add a reminder for something like "The project is about to end, make sure to contact John Doe to talk about the next steps", or "The breeding season is about to finish! Dont for get to remove the caermas before its too late." Would that make sense? 
- [ ] Check the Synature graph for 'Life in the area' at https://synature.ai/product. Can we make something similar for ourt dashboard? 
- [ ] Add logos to all the pages and emails and whatever needed with the new logos. 
- [ ] See email from Quentin with TODOs
- [ ]

## TODO Priority 2
- [ ] Invalidate other sessions on password change. Today JWTs are stateless with 1-hour lifetime, so changing the password in browser A leaves browser B's token valid until it expires. OWASP expects revocation here. Plan: add a `password_changed_at` timestamp on `User`, write it in `services/api/auth/routes.py` change-password and in the fastapi-users password-reset hook, then subclass `JWTStrategy` to reject tokens whose `iat < user.password_changed_at`. Small change, also gives a foundation for a future "log out everywhere" button.


## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?
- [ ] multi language
- [ ] can we make it feel native on iphone and android without having it like a normal app? You can continue an previous claude session with > claude --resume c24bfc22-4e66-4bdd-abc6-d41f92b5c0c7

