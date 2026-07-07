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

## TODO
- [ ] Do the things Quentin mentioned in an email. 
- [ ] Make the about page not only show the tag, but also the commit hash for a fiull picture of which code it is running. 

## Possible future features
- [ ] Make a script that tests updates on prod data on a dev server. Basically, I want a scipt (or edit restore.sh) that takes these args: original_code_commit hash (to see from where we need to update test it), the data to restore from backup disk (to ghet prod data to test it on, so you'll need to do more or less the same as restore.sh), which means youl need the source domain, the date is always the latetst, and --force always (this is for testing updates, so always on dev dummy data, perhaps with a confirmation prompt?). You see what I need? I just want a way to test updates more automaticaly. What do you think? What is best here?  
- [ ] multi language
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI WebUI. This improves the overcounting.... 



