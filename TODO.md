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



User feedback below. Please investigate the feasibility of this request/report/request. How much effort is it, how would you fix it, and is it worth it? 

Instructions:
* Codex will review your output once you are done, so make sure you exceed his expectations
* do not sugar coat, be honest and clear
* If something is unclear at any point, stop and ask before continuing.
* Prioritize simplicity and clarity over perfection. The code must be clean, easy to read, and understandable for collaborators. Avoid unnecessary complexity.
* I'm not in a rush. Please be precise and do the task thoroughly. 
* Please ask me any question for clarification. I would rather that you ask too many questions than assume certain details. 

---- FEEDBACK

General questions
During the last meeting, I asked about the possibility of manually uploading images, to open the use of Addax with non-connected camera traps. However, I understand that this was not aligned with Addax’s current development priorities. As it would be a real game changer, do you think this significant improvement could be technically implemented in the future ?


Lets make a plan to implement a BULK upload feature. 

First, let me respond to your issues.

  - Live-starvation. FIX: priority queue
  - Notification spam. FIX: Image.origin = 'bulk' flag, notification service skips it.
  - Re-upload duplication. FIX: content hash + (camera_id, captured_at) uniqueness.
  - Cold-tier mismatch. DOuble check which date it currently checks. We have a GB budget, not an age, but if above GB budget, it removes the oldest ones, so good to chekc which value it then checks. 
  - Browser fragility for large uploads. Yes, this is worth investigating. WOuld it make a difference if we only allow for ZIP uploads?
  - Two ops modes UX tax. Why does camera health, dashboards, notifications all need a "live vs bulk-only" branch? Why are the bulk images not just handled as normal (except for the notifications)? when uploadinga batch, we can have a form where the user can full in the cameraID, lat/lon, right? Then we have everything we need, or not?
  - Product surface duplication. True, but this one is online. So it is a difference. 

SHould we only allow batches form a single camera, from a single site? So basically, to keep it in camera trap jargon, a single deployment? That makes the process a lot easier, because we know that all data inside has the same camera and site. 

Would it make sense to only allow uploading ZIP? That retains the DateTimeOriginal metadata stamp, right? Or does a normal file by file upload also keep that? Is there any benefit to uploading by ZIP instead of 5000 separate JPGs? 

Lets make a plan! Instructions:
* Codex will review your output once you are done, so make sure you exceed his expectations
* do not sugar coat, be honest and clear
* Switch to plan mode, I want this task to be done with "plan mode on"
* Read all MD file in root to get a understanding of the project. 
* If something is unclear at any point, stop and ask before continuing.
* Prioritize simplicity and clarity over perfection. The code must be clean, easy to read, and understandable for collaborators. Avoid unnecessary complexity.
* I'm not in a rush. Please be precise and do the task thoroughly. 
* Please ask me any question for clarification. I would rather that you ask too many questions than assume certain details. 
* Ask me clarifying questions before beginning. Based on the conventions set out in CONVENTIONS.md and your knowledge, give your recommended solution to each questions you ask me. The minimum number of questions to ask me is 5







---- my thoughts

AddaxAI COnnect is designed for realtime notificaitons and data that comes dripping in, hence no GPU power needed, as images usually comin every few minutes. SO CPU is fine. Also, since we get them from the camera directly, we know the format exactly, and we know the datetime, GPS, cameraID, etc. Which makes this very easy to store in the DB. 

The user is now asking for a featre where he can bulk upload, so he can use AddaxAI Connect as a management platform. Nothing really stops us here (except adding a few more endpoints and frontend formas etc). Am I missing anything here? Would you recommend this, or keep it as it, and dont do bulk upload. How difficult would it be? Could we do something like analyse 10 images at a time, and then check if we got anything form the LIFE caermas? Otherwise we miss the LIFE aspect completely if the queue is half a day.... What do you think? WHat are the diificulties, and how to overcome them? 


General questions
During the last meeting, I asked about the possibility of manually uploading images, to open the use of Addax with non-connected camera traps. However, I understand that this was not aligned with Addax’s current development priorities. As it would be a real game changer, do you think this significant improvement could be technically implemented in the future ?

Would it be possible to obtain the phone numbers associated with the SIM cards in order to test the remote control of the devices?







## TODO Priority 2
- [ ] Add site concept
- [ ] Always store all raw images on wasabi if keys are given at deployment. That means two separate MinIO DB right? One for the thumbs, etc we want on the server always, and one for the raw images we can store on wasabi (if keys are set up during deployment). Cameras ingest and are sent to the twop separate minIOs? And bulk upload also? How would that look? Is this a good idea? Or would you advise agaionst it? I want to do this beacuse the current set up of tagging images hot/cold with a watchdog is kind of complex. I just want to store all raw images cold. Makes sense? Or would you advise a different technique? Like an ILM rule of 0 days? What would the consequences be? Give me a few options with the expected behaciour, pros and cons, etc. 


## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?
- [ ] multi language
- [ ] can we make it feel native on iphone and android without having it like a normal app? You can continue an previous claude session with > claude --resume c24bfc22-4e66-4bdd-abc6-d41f92b5c0c7

