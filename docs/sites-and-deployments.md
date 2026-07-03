# Sites and cameras

This page explains how AddaxAI Connect organises cameras, places, and images. Almost everything happens automatically from the GPS in your images. The app tracks where your cameras are and tells you when one moves. You only step in when a guess is wrong or when a new site needs a name.

## The two concepts

- Camera is the physical device. It is identified by its `device_id`. A camera has no name and no fixed location, because it can be moved around over time.
- Site is a physical place where a camera stands. A site has a name, a location, and optional habitat, notes, and tags.

Under the hood the app also keeps a deployment for every continuous placement of a camera at a site. Deployments drive the effort statistics (trap-days) and the Camtrap DP export, but they are managed fully automatically and there is nothing to do with them by hand.

## How GPS is used

Every photo carries the GPS the camera recorded, and the app builds sites from it. One distance is the cutoff, set to 250 metres. Readings within it are the same place. Readings beyond it mean the camera moved.

The cutoff is 250 metres because GPS is noisy. The noise was measured on 7257 photos from 25 cameras that never moved. Almost every reading lands within a few metres of the true spot. But GPS sometimes drifts much further on its own. The worst single photo was 215 metres off, with the camera standing still. A cutoff of 250 metres stays clear of that, so normal noise is not read as a move.

![GPS noise of stationary cameras](https://github.com/user-attachments/assets/e43bbafe-2191-46a1-b624-269a50439ee6)

*Distance of each photo's GPS from the camera's true spot, for 25 cameras that never moved. Almost all readings fall within a few metres. The worst was 215 metres, and the 250 metre cutoff stays past all of it.*

A camera's position is not taken from a single photo. The first reading after a camera connects to the network is often the worst one, so the app keeps averaging the GPS of all photos from the same placement. The pin gets more precise the longer the camera stands there.

## What happens automatically

When a camera sends its first image, the app looks for a site within 250 metres. If one exists, the camera is placed on it. If none is close enough, a new site is made and named after its coordinates. When a later photo arrives from more than 250 metres away, the camera has probably moved. One odd reading is not enough, a move must be confirmed by two readings near the new spot, otherwise the reading is treated as noise. After a confirmed move the camera is placed on the nearest site at the new spot, or a new site is made there.

## The camera updates panel

Every automatic decision is reported in the camera updates panel, opened from the sidebar. A badge shows how many entries are new. Each entry says what happened, for example that a camera started sending images, or that a camera moved to another site, together with a few photos as visual confirmation.

Nothing in this panel needs an answer. The app already acted, and ignoring every entry is fine. When a guess is wrong or a new site needs a better name, a project admin can use the buttons on the entry.

- Rename site gives the auto-named site a real name, for example "Duinpoort north".
- Different site moves the camera to another existing site within 250 metres. This only appears when there is one.
- New site gives the camera its own site at its current location. Use this when two cameras stand close together but should be separate places, for example both ends of a wildlife bridge.
- It did not move undoes a move that was GPS noise. The camera goes back to its previous site, together with its images.

Two cameras that stand within 250 metres of each other share one site by default. That is often right, for example when a new camera replaces a broken one at the same station. When they should be separate places, one click on New site splits them, and the choice sticks.

## Managing sites

Sites are made by the app, not by hand. On the Sites page you can edit a site's name, habitat type, notes, and tags. Tags describe the place and are used to filter images, so put place labels here, not on the camera. You can also delete a site, or merge one site into another. A merge moves every placement from the open site into the site you pick, then deletes the open site. A merge cannot be undone, and the site you pick is the one that survives, so check the direction before you confirm.

## When a site appears that should not

GPS noise can split one place into two sites. The camera updates panel usually catches this at the moment it happens, and the It did not move button fixes it in one click. If it is noticed later, you can spot it when two sites sit close together and one holds far fewer images. Merge the stray one into the real one on the Sites page. For old placements there is also a change site action in the camera's detail panel, under Placements.
