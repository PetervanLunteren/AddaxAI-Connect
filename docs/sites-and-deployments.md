# Sites and deployments

This page explains how AddaxAI Connect organises cameras, places, and images, and how you manage them. Most of it happens automatically from the GPS in your images. You only step in when you want to rename, merge, or tidy something.

## The three concepts

There are three separate things, and it helps to keep them apart.

```
Camera  (the hardware)
  └─ Deployment  (this camera, at one place, for one time range)
       └─ Images
            ↑
         Site  (a physical place; groups deployments that share a location)
```

- **Camera** is the physical device. It is identified by its `device_id` (for most cameras the IMEI of the SIM). A camera has no name and no fixed location, because it can be moved around over time.
- **Site** is a physical place where cameras stand. A site has a name, a location, and optional habitat, notes, and tags.
- **Deployment** is one camera at one site for a continuous time range. It is the link between the two. Every image belongs to one deployment, and through it to one camera and one site.

So the same camera can produce several deployments over time (each time it moves), and one site can hold several deployments (several cameras, or the same camera returning later).

## How deployments are created

Deployments are built automatically from the GPS stored in your images. You do not create them by hand.

- The first image from a camera opens its first deployment.
- Every later image is checked against the camera's active deployment. If the new GPS is within the threshold, it is the same place and the same deployment. If it is further away, the camera has moved, so the active deployment is closed and a new one opens.
- A single bad GPS fix does not move a camera. A relocation has to be confirmed by two readings near the new spot before a new deployment opens. One lone outlier is attached to the current deployment instead.
- Daily health reports carry GPS but no photo. A report never splits a deployment or moves a camera, because a deployment is built from photos. A report can still open the very first deployment when none exists yet.

A deployment with an empty end date is the one that is active now.

## How sites are created

Sites are created automatically too, by grouping deployments that sit close together.

- When a deployment is created, its location is compared to the existing sites in the project. If one is within the threshold, that site is reused. If none is close enough, a new site is created.
- A site's location is the centre point of its deployments. It is recalculated whenever its deployments change, so the pin always sits in the middle of the cameras that belong to it.
- Site names are derived from the cameras. One camera at a site gives the site that camera's old name. Several cameras with a shared name (like "Duinpoort NW" and "Duinpoort NO") give the shared part as the site name ("Duinpoort") and the rest as a per camera position label ("NW", "NO"). When there is no shared name, the site falls back to its coordinates and is flagged so you can rename it.
- If a derived name already exists in the project, a counter is added, so you can end up with "Duinpoort" and "Duinpoort (2)".

A site also records whether its location was set automatically by GPS or confirmed by a person. This only drives a small badge and filter; it does not change anything in the pipeline.

## The threshold

One distance governs everything: **100 metres**.

- Two readings within 100 m of each other are the same site.
- A reading more than 100 m from a camera's current deployment means the camera has relocated.

There is no separate relocation distance, the same number does both. The value works because real per camera GPS jitter is under about 6 m, while a real move is much larger, so 100 m sits comfortably in between. It is not configurable per project yet.

## Managing sites in the web interface

Most site handling is automatic, but you can adjust things on the Sites page.

- **Create** a site by hand and place its pin on the map. Useful when you want a place to exist before a camera is deployed there.
- **Edit** a site's name, habitat type, notes, and tags. Tags describe the place and are used to filter images, so put place labels here, not on the camera.
- **Merge** a site into another one. This moves every deployment from the open site into the site you pick, then deletes the open site. Use it to fix a place that got split into two sites. Merging cannot be undone, and the site you pick is the one that survives, so check the direction before you confirm.
- **Delete** a site.

There is no "move a site" action, and that is on purpose. A site's location is the centre of its deployments, so it follows the cameras and there is nothing useful to drag by hand.

## When a site appears that should not

Sometimes a camera's GPS drifts more than 100 m away for a while and then comes back, even though the camera never physically moved. The system cannot tell sustained drift apart from a real short move, so it opens a new deployment and a second site for that period. You end up with two sites close together, for the same camera, and the extra one usually holds only a few images.

To recognise it: two sites near each other (just over 100 m apart), tied to the same camera, one with far fewer images. The images in both look the same because it is the same camera at the same spot.

To fix it: merge the stray site into the real one. The images and the deployment move across, and you are left with a single site again.

## What it touches in the database

- `sites` holds the place, its location, name, habitat, notes, and tags.
- `deployments` links a camera to a site for a time range, with an optional position label.
- `images.deployment_id` ties each image to its deployment, and through it to the camera and site.

When the server is updated, a few maintenance steps run automatically. They link images to deployments, build sites from the deployments, and clean up debris: empty deployments left by old bad GPS readings, and any site that those deletions leave with no deployments at all. A site you created by hand that has no deployments yet is left alone.
