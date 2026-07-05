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
- [ ] We recently introduced the site concept and made cameras just hardware without a name. Previously the cameras were nbamed after the sites, so that was how users used to work with. Now they are supposed to work with sites, not hardware, which makes sense in day to day work. However, there might still be some camera sepcfic selections and jargon lingering about. CCan wyo do a full audit and see if there is still the old workflow where cameras were used as sites and that are supposed to be sites now that the concept is live? AN example is the settiong "Camera groups" which should be "Independence groups" or something like that. IIn ythe selectbox it is currently the way that the user needs to select form a list of IMEIs, which does not make sense. It should be a list of site names. The camera IMEIs dont matter here. You see what I mean? Please do a full audit and see what you can find in this regard. What did we miss when we introduced the site concept? 

## Possible future features
- [ ] multi language
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI WebUI. This improves the overcounting.... 



