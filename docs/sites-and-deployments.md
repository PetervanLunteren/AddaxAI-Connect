# Sites and cameras

AddaxAI Connect organises your images by place. A camera is the physical device, identified by its device id. A site is a place where a camera stands, with a name you choose. Every photo carries the GPS the camera recorded. The app uses it to build sites, to place cameras on them, and to notice when a camera moves. You do not manage any of this by hand. The app decides, reports what it did in the camera updates panel, and gives you a few buttons to correct a wrong guess.

Behind the scenes the app also keeps a record of every continuous placement of a camera at a site. These records are fully automatic and there is nothing to do with them.

## How sites are made

One distance is the cutoff, set to 250 metres. GPS readings within it are the same place. Readings beyond it mean the camera moved. Each photo is compared with the position of its own camera, so two cameras close together never get mixed up.

The cutoff is 250 metres because GPS is noisy. The noise was measured on 7257 photos from 25 cameras that never moved. Almost every reading lands within a few metres of the true spot. But GPS sometimes drifts much further on its own. The worst single photo was 215 metres off, with the camera standing still. A cutoff of 250 metres stays clear of that, so normal noise is not read as a move.

![GPS noise of stationary cameras](https://github.com/user-attachments/assets/e43bbafe-2191-46a1-b624-269a50439ee6)

*Distance of each photo's GPS from the camera's true spot, for 25 cameras that never moved. Almost all readings fall within a few metres. The worst was 215 metres, and the 250 metre cutoff stays past all of it.*

When a camera sends its first photo, the app looks for a site within 250 metres. If one exists, the camera is placed on it. If not, a new site is made and named after its coordinates, for example "Site at 53.2460, 5.2620". That name is a placeholder. You give it a real name manually in the app.

When a later photo arrives from more than 250 metres away, the camera has probably moved. One odd reading is not enough. A move must be confirmed by a second reading near the new spot, otherwise the reading is treated as noise and nothing happens. After a confirmed move the camera is placed on the nearest site at the new spot, or a new site is made there.

A camera's position is not taken from a single photo. The app keeps averaging the GPS of all photos from the same placement, so the position gets more precise the longer the camera stands there.

## The camera updates panel

Open the Cameras page and click Updates. The button shows how many entries are new to you, and the Cameras item in the menu shows the same count from any page.

![The Updates button on the Cameras page](https://github.com/user-attachments/assets/3b0e1674-4ff6-45af-b78d-fbc827524696)

*The Updates button on the Cameras page. The count shows how many entries are new to you.*

Every automatic decision becomes one entry. Entries show as one-line sentences, so the list reads like a short report. The sentence tells you if something is wanted from you. A placeholder name in the title means the site waits for a real name. A real name means there is nothing to do.

![The camera updates panel with one-line entries](https://github.com/user-attachments/assets/1931eb59-b7ab-4b6e-8a40-cd5a9cf3327f)

*Each entry is one sentence. Two sites here still carry placeholder names, so they wait for a real one.*

Click an entry to see more: the camera id, a few photos from that spot, where the camera was placed and why, and the action buttons. Each button explains itself with one line.

![An expanded entry with photos and actions](https://github.com/user-attachments/assets/4afb46b4-5890-4f0e-9c42-5cf7eb482cf8)

*An expanded entry. This camera was placed on an existing site 30 metres away, so it can also be split off to its own site.*

Nothing in this panel needs an answer. The app already acted, and ignoring every entry is fine. When you take an action, the entry closes and records who did what and when. The buttons then go away.

![A closed entry with the resolution line](https://github.com/user-attachments/assets/0b50bf64-973a-4151-b7e2-137cecb3acd3)

*A closed entry. It keeps what happened and records who corrected it and when.*

Entries you have seen before fold into "Already seen" at the bottom, grouped by time range. New entries always sit on top.

![The already seen section with time ranges](https://github.com/user-attachments/assets/5e4e4b2b-c02b-432b-b579-010348367849)

*The already seen section, grouped by time range. These six sites were named earlier, so their entries read calm.*

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

![An expanded entry for a camera move](https://github.com/user-attachments/assets/72a6526d-d8f7-4a79-84d3-aa8be3c1e6df)

*A camera moved 399 metres. The new site waits for a name, and the move can be undone if it was not real.*

### A move that was GPS noise

A single bad reading never makes an entry, the app filters it silently. When bad GPS produces two readings and a false move gets through, the entry shows a move you know did not happen. Click "It did not move". The camera and its images go back, and the wrongly made site is removed by itself.

![The confirmation before undoing a move](https://github.com/user-attachments/assets/eee9302c-15f0-474b-85a7-6efd8731b151)

*The confirmation before a move is undone.*

### Several cameras at one place

Cameras within 250 metres of each other share one site by default. That is often right, for example when a new camera replaces a broken one at the same spot. When you want them apart, for example two cameras on one wildlife bridge, use "New site" on each camera's entry and give each its own name, like "bridge north" and "bridge south". This is a one-time setup. After that, each camera keeps its own site, and the statistics count them apart.

### Moving many cameras at once

Field days work without extra steps. Move twenty cameras, and twenty entries appear, one per camera. Cameras that arrive at a new spot get new sites to name. Cameras that return to a known site snap onto it by name, even when the devices got shuffled and a different camera ends up at each spot. A rotation project, where cameras move between fixed stations every few weeks, only costs you one naming pass on the first day. Every rotation after that needs no work at all.

### Fixing something later

The feed is for corrections at the moment they happen. For everything later, use the normal pages. Rename, merge, or delete a site on the Sites page. Move a placement to another site from the camera's detail panel, under Placements. Merging is for when GPS noise split one real place into two sites: merge the stray site into the real one, and its placements and images move along.
