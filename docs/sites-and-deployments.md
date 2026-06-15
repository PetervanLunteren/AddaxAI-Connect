# Sites and deployments

This page explains how AddaxAI Connect organises cameras, places, and images, and how you manage them. Most of it happens automatically from the GPS in your images. You only step in when you want to rename, merge, or tidy something.

## The three concepts

There are three separate things, and it helps to keep them apart.

- Camera is the physical device. It is identified by its `device_id`. A camera has no name and no fixed location, because it can be moved around over time.
- Site is a physical place where cameras stand. A site has a name, a location, and optional habitat, notes, and tags.
- Deployment is one camera at one site for a continuous time range. It is the link between the two. Every image belongs to one deployment, and through it to one camera and one site.

So the same camera can produce several deployments over time (each time it moves), and one site can hold several deployments (several cameras, or the same camera returning later).

## How GPS is used

Every photo carries the GPS the camera recorded, and the app builds sites and deployments from it. One distance is the cutoff, set at a default value of 100 metres. Readings within it are the same place; readings beyond it mean the camera moved. The number sits between normal GPS jitter (a few metres) and a real move (much larger). The hard part is that GPS is noisy, so it sometimes drifts past the cutoff on its own and one place can look like two.

## How deployments are created

Deployments are built automatically from the GPS stored in your images. You do not create them by hand.

- The first image from a camera opens its first deployment.
- Every later image is checked against the camera's active deployment. If the new GPS is within the threshold, it is the same place and the same deployment. If it is further away, the camera has moved, so the active deployment is closed and a new one opens.
- A single bad GPS fix does not move a camera. A relocation has to be confirmed by two readings near the new spot before a new deployment opens. One lone outlier is attached to the current deployment instead.

A deployment with an empty end date is the one that is active now.

## How sites are created

Sites are created automatically too, by grouping deployments that sit close together.

- When a deployment is created, its location is compared to the existing sites in the project. If one is within the threshold, that site is reused. If none is close enough, a new site is created.
- A site's location is the centre point of its deployments. It is recalculated whenever its deployments change, so the pin always sits in the middle of the cameras that belong to it.

## Managing sites in the web interface

Most site handling is automatic, but you can adjust things on the Sites page.

- Edit a site's name, habitat type, notes, and tags. Tags describe the place and are used to filter images, so put place labels here, not on the camera.
- Merge a site into another one. This moves every deployment from the open site into the site you pick, then deletes the open site. Use it to fix a place that got split into two sites due to GPS noise. Merging cannot be undone, and the site you pick is the one that survives, so check the direction before you confirm.
- Delete a site.

## When a site appears that should not

GPS noise can split one place into two sites. You can spot it when two sites sit close together, belong to the same camera, and one holds far fewer images. The photos in both look the same because it is the same camera at the same spot. Merge the stray one into the real one to fix it.
