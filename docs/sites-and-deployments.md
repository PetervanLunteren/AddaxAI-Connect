# Sites and cameras

AddaxAI Connect organises your images by place. A camera is the physical device, identified by its device id. A site is a place where a camera stands, with a name you choose. Every photo carries the GPS the camera recorded. The app uses it to build sites, to place cameras on them, and to notice when a camera moves. You do not manage any of this by hand. The app decides, reports what it did in the camera updates panel, and gives you a few buttons to correct a wrong guess.

Behind the scenes the app also keeps a record of every continuous placement of a camera at a site. These records drive the effort statistics (trap-days) and the Camtrap DP export. They are fully automatic and there is nothing to do with them.

## How sites are made

One distance is the cutoff, set to 250 metres. GPS readings within it are the same place. Readings beyond it mean the camera moved.

The cutoff is 250 metres because GPS is noisy. The noise was measured on 7257 photos from 25 cameras that never moved. Almost every reading lands within a few metres of the true spot. But GPS sometimes drifts much further on its own. The worst single photo was 215 metres off, with the camera standing still. A cutoff of 250 metres stays clear of that, so normal noise is not read as a move.

![GPS noise of stationary cameras](https://github.com/user-attachments/assets/e43bbafe-2191-46a1-b624-269a50439ee6)

*Distance of each photo's GPS from the camera's true spot, for 25 cameras that never moved. Almost all readings fall within a few metres. The worst was 215 metres, and the 250 metre cutoff stays past all of it.*

When a camera sends its first photo, the app looks for a site within 250 metres. If one exists, the camera is placed on it. If not, a new site is made and named after its coordinates, for example "Site at 53.2460, 5.2620". That name is a placeholder. You give it a real name in the camera updates panel.

When a later photo arrives from more than 250 metres away, the camera has probably moved. One odd reading is not enough. A move must be confirmed by a second reading near the new spot, otherwise the reading is treated as noise and nothing happens. After a confirmed move the camera is placed on the nearest site at the new spot, or a new site is made there.

A camera's position is not taken from a single photo. The app keeps averaging the GPS of all photos from the same placement, so the position gets more precise the longer the camera stands there.

## The camera updates panel

Open the Cameras page and click Updates. The button shows how many entries are new to you, and the Cameras item in the menu shows the same count from any page.

<!-- SCREENSHOT-1: cameras page header with the Updates button and its count badge -->

Every automatic decision becomes one entry. Entries show as one-line sentences, so the list reads like a short report. The sentence tells you if something is wanted from you. A placeholder name in the title means the site waits for a real name. A real name means there is nothing to do.

<!-- SCREENSHOT-2: the panel with collapsed one-line entries under a day heading -->

Click an entry to see more: the camera id, a few photos from that spot, where the camera was placed and why, and the action buttons. Each button explains itself with one line.

<!-- SCREENSHOT-3: one expanded entry with photos, context, and action buttons -->

Nothing in this panel needs an answer. The app already acted, and ignoring every entry is fine. When you take an action, the entry closes and records who did what and when. The buttons then go away.

<!-- SCREENSHOT-4: a closed entry showing who did what and when -->

Entries you have seen before fold into "Already seen" at the bottom, grouped by time range. New entries always sit on top.

<!-- SCREENSHOT-5: the Already seen section opened, with time range groups -->

## The actions

Which buttons an entry shows depends on the situation. Only project admins can use them; viewers see the entries without buttons.

- **Show location** opens the camera's spot in Google Maps. It changes nothing.
- **Name this site** gives a site with a placeholder name a real one. It only shows while the name is still a placeholder. Later renames happen on the Sites page.
- **Different site** moves the camera to another existing site nearby. It only shows when there is one within 250 metres.
- **New site** splits the camera off to its own new site at its exact spot. It only shows when the camera was placed on a site that already existed.
- **It did not move** undoes a move that was GPS noise. The camera and its images go back to the previous site, as if the move never happened.

## Common situations

### A new camera starts sending

An entry appears: "A camera started sending images from Site at 53.2460, 5.2620." Give the site a real name with the name button, done. If the camera was placed on an existing named site, the entry needs nothing.

### A camera moves to a new spot

An entry appears with the old site, the new site, and the distance. Check that it makes sense, name the new site if it is new, done. Use Show location if you want to see the spot on a map first.

### A move that was GPS noise

A single bad reading never makes an entry, the app filters it silently. When bad GPS produces two readings and a false move gets through, the entry shows a move you know did not happen. Click "It did not move". The camera and its images go back, and the wrongly made site is removed by itself.

### Several cameras at one place

Cameras within 250 metres of each other share one site by default. That is often right, for example when a new camera replaces a broken one at the same spot. When you want them apart, for example two cameras on one wildlife bridge, use "New site" on each camera's entry and give each its own name, like "bridge north" and "bridge south". This is a one-time setup. After that, each camera keeps its own site, and the statistics count them apart.

### Moving many cameras at once

Field days work without extra steps. Move twenty cameras, and twenty entries appear, one per camera. Cameras that arrive at a new spot get new sites to name. Cameras that return to a known site snap onto it by name, even when the devices got shuffled and a different camera ends up at each spot. A rotation project, where cameras move between fixed stations every few weeks, only costs you one naming pass on the first day. Every rotation after that needs no work at all.

### Fixing something later

The feed is for corrections at the moment they happen. For everything later, use the normal pages. Rename, merge, or delete a site on the Sites page. Move a placement to another site from the camera's detail panel, under Placements. Merging is for when GPS noise split one real place into two sites: merge the stray site into the real one, and its placements and images move along.
