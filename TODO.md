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
- [ ] Have a look at the dev server (ssh dev) and check the ones where occations where it thought the camera moved (the ones with "(X)" appended to their name). How far away were they? WOuld it make sense to increase the distance threshold for new site/new deployments? Perhaps make a report of all the images GPS (not stored in DB, so you'll have to extract them from EXIF), calculate the GPS noise. What would be a good threshold? The cameras in this project have not been moved, so it would be a good test to determine the threshold. Investiagte and propose a well educated answer. 

## Possible future features
- [ ] multi language
- [ ] can we make it feel native on iphone and android without having it like a normal app? Make a PWA of this app. You can continue an previous claude session with > claude --resume c24bfc22-4e66-4bdd-abc6-d41f92b5c0c7
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI. This improves the overcounting.... 