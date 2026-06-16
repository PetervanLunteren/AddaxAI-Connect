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
- [x] Add site concept
- [ ] Always store all raw images on wasabi if keys are given at deployment. That means two separate MinIO DB right? One for the thumbs, etc we want on the server always, and one for the raw images we can store on wasabi (if keys are set up during deployment). Cameras ingest and are sent to the twop separate minIOs? And bulk upload also? How would that look? Is this a good idea? Or would you advise agaionst it? I want to do this beacuse the current set up of tagging images hot/cold with a watchdog is kind of complex. I just want to store all raw images cold. Makes sense? Or would you advise a different technique? Like an ILM rule of 0 days? What would the consequences be? Give me a few options with the expected behaciour, pros and cons, etc. 
- [ ] do the bulk upload no that we have fixed the site concept






## Possible future features
- [ ] multi language
- [ ] can we make it feel native on iphone and android without having it like a normal app? Make a PWA of this app. You can continue an previous claude session with > claude --resume c24bfc22-4e66-4bdd-abc6-d41f92b5c0c7
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI. This improves the overcounting.... 