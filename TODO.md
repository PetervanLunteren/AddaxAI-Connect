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



## TODO
- [x] Add site concept
- [ ] Always store all raw images on wasabi if keys are given at deployment. That means two separate MinIO DB right? One for the thumbs, etc we want on the server always, and one for the raw images we can store on wasabi (if keys are set up during deployment). Cameras ingest and are sent to the twop separate minIOs? And bulk upload also? How would that look? Is this a good idea? Or would you advise agaionst it? I want to do this beacuse the current set up of tagging images hot/cold with a watchdog is kind of complex. I just want to store all raw images cold. Makes sense? Or would you advise a different technique? Like an ILM rule of 0 days? What would the consequences be? Give me a few options with the expected behaciour, pros and cons, etc. 
- [ ] if detected its a dev server (there is already a check in place that proposes to reomve all the users), we should probabaly remove all the notifications too. Now I'm getting emails that the dev server is not getting any images in the past 48 hours.... 
- [ ] We should probabaly document whats going on. Perhaps add a page to the documentation? What happens exactly, how are deployments created, how are sites created, what is the threshold, how does it work, how can we add / edit / move / merge sites, and how does it affect the DB. 
- [ ] check the default species list for a new project in AddaxAI. WHich species are selected now? SHould we auto sleect all and then let the user change that himself? Or add this to the add project modal as a required input? What do you think?  
- [ ] We need to make sure it is noted somewhere in the docs where we host the Data (Wasabi). Not sure how to do that, since everybody can choose themselves, but only we use wasabi. Perhaps add a paragraph on the https://petervanlunteren.github.io/AddaxAI-Connect/architecture/ page aboput data storage, how it wporks, hoe everybody can choose their own S3 host, but that it is testtes with wasabi. ??Some thing like that? How secure is it? 







## Possible future features
- [ ] multi language
- [ ] can we make it feel native on iphone and android without having it like a normal app? You can continue an previous claude session with > claude --resume c24bfc22-4e66-4bdd-abc6-d41f92b5c0c7



- the merge site modal map, lets zoom in to the point of interest. The one that the user wants to merge it with is always near anyways, so no sense to zoom to the entire project area. Makes sense? 
- there are a bunch of unassigned deployments with 0 images. Why are they still there? Didnt we decide to hide them from UI?  or should we remove them automatically? 
- can we make this " Leaflet | Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community" less invasive? Perhaps by hiding it under a (i)inside the map or something like that? How do other do it? Its taking up considerable space of the map nopw.... But i also dont want to offend the rules and I want to give proper attribution. 
- What do you thnk? Is moving a site really something users will do? I thin it might be confusing. You'd need to know the exact workings of the app. Because moving a site does only move the pin on the cosmetic map right? Perhaps just delete this feature... ? What do you think? A site is a site, and its location is fixed. Or do you think it has real value? 
  - In every map view, the current marker is red, which means bad. Should we make it light teal? Chekc the frontend conventions for the colour code. 
  - the merge caption is "Move every deployment from "Kleppelbaach (2)" into another site, then delete "Kleppelbaach (2)". This cannot be undone." but after mergin "Kleppelbaach" with "Kleppelbaach (2)", i ended up with "Kleppelbaach (2)".
  - What does "Move every deployment from "Kleppelbaach (2)" into another site" actually mean from a user perspective? We need to think like a end user, not like a developer. 
  - 



