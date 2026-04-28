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
- [ ] 

## TODO Priority 2
- [ ] 
- [ ] add instruction on how to make it an app-feel in iphone
- [ ] can we do something similar for android phones? Where we can have it feel like an app without having it in the app store? (like we did for apple iphones)?
- [ ] make sure the slideouts (e.g., the camera information slideout) closes when you click outside of the slideout. Now you need to click the cross. 
- [ ] Why is "Empty" a class in the "set overrides" for the cls conf thresh in the project settings? Mistake?

## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?
- [ ] multi language
- [ ] 

