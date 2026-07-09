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
- [ ] The cameras page is pretty sophiticated since that was the main management page before we introduced the site concept. It allows the user to do bulk tags, notes, etc. SHould we do the same for site? SO bulk: add tag, rrmove tag, set notes. Use shared helpers here. No snese to make this again. So same way of selecting,  bulk options,  modals, confirmations, etc. As much as possible shared code. SIngle source of truth. 
- [ ] Lets also add the "display" option to the sites table to select which columns to see in the table. Use shared helpers here. No snese to make this again. As much as possible shared code. SIngle source of truth. ANything else we want to copy form the cameras page to the sites page? 
- [ ] We should probabaly look at the total columns of both cameras and sites, and determine which cols are shown by default. ALso, is the display selection saved to local storage for later preferences? 
- [ ] Do the things Quentin mentioned in an email. 
- [ ] Make the about page not only show the tag, but also the commit hash for a fiull picture of which code it is running.


## Possible future features
- [ ] Make a script that tests updates on prod data on a dev server. Basically, I want a scipt (or edit restore.sh) that takes these args: original_code_commit hash (to see from where we need to update test it), the data to restore from backup disk (to ghet prod data to test it on, so you'll need to do more or less the same as restore.sh), which means youl need the source domain, the date is always the latetst, and --force always (this is for testing updates, so always on dev dummy data, perhaps with a confirmation prompt?). You see what I need? I just want a way to test updates more automaticaly. What do you think? What is best here?  
- [ ] Update the documentation regarding updates, restoring, and testing. Basically we need these pages (then we cover it all, right) 1) restore prod server to a backup state, 2) test update on dev server with prod data, 3) update prod server with prod data, 4) restore prod server from prod backup. Am i missing something? Perhaps deployment is one of them too. That is also a sever management thing. What do you think? Are there more server management things I as a server manager must do frequently? These pages should be written if they are not there already. So basically my first task is, do you agree with me above? And what do we have in terms of docs already (and are they up to date), and do they need updating? Investigate. Audit. I want the regular tasks like testing, updating, restoring, etc to be automated with scripts to make my like easier. If we have the scripts ready, lets make documentation pages about each, with the neccisary steps. (Or update the exisitng ones - some of them still talk about Digital Ocean snapshots, but nowadays we have our own backups in S3 buckets). 
- [ ] Make per-host group_vars so we can store secrets per host and run it cleanly like ansible-playbook --limit pwn . perhaps als work with the prod and dev things. Explain how ansible yamls are typically used, and how power user work with it when manageing multiple servers. Now its becoming a hassle since i need to change the vaklues every time i do server management. 
- [ ] multi language
- [ ] Make it event aware. 
- [ ] Make it use label verification, and count confirmation just like AddaxAI WebUI. This improves the overcounting.... 



