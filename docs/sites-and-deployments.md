# Sites and cameras

AddaxAI Connect sorts your photos by place. A camera is the device, known by its device id. A site is a place where a camera stands, with a name you choose. A deployment is one camera at one site for one period. The app makes sites and deployments by itself from the GPS in the photos, and it notices when a camera moves. You only step in when it got something wrong, or when a camera has no GPS. This page is for project admins, who can correct deployments. Viewers see the same deployments but can't change them.

![The Deployments page](https://github.com/user-attachments/assets/0a4910cf-2f0c-44e1-938a-81ecd6c8bb37)

*The Deployments page. One deployment was corrected by a person, one is suspicious.*

## How the app places a camera

When a camera sends its first photo, it's placed on the nearest site within 250 metres. If there is none, the app makes a new site and names it after its coordinates, for example "Site at 53.2460, 5.2620". That name is a placeholder, and the site shows Unnamed until you rename it on the Sites page. Photos within 250 metres of where the camera stands belong to the same deployment. When photos come from further away, the camera moved, and a new deployment starts on the nearest site at the new spot or on a new site. Each photo is always linked to the ID of the camera that took it, so cameras never get mixed up, also when they stand close together. You can always act on a camera as a whole.

## How the app handles GPS noise

GPS is noisy, more so under trees. On five servers with about 219,000 photos, most readings were within 10 to 40 metres of where the camera stood, but sometimes the GPS drifts 100 to 230 metres off for a day or two and then comes back. The cutoff of 250 metres is the smallest distance that stays above that drift, and smaller distances found almost no real moves, only more false ones. One photo from further away doesn't move a camera, because a move needs a second photo near the same new spot. The position of a deployment is the average GPS of its photos, so one bad reading hardly shifts it, and it gets more precise the longer the camera stands there. And when a camera seems to go somewhere and comes back within a week, which is the usual shape of a GPS error, the app marks that deployment Suspicious for you to check, see [suspicious moves](#suspicious-moves).

## Where you see deployments

Open a camera on the Cameras page and go to its Deployments tab to see every place it stood, oldest first. Open a site on the Sites page and go to its Deployments tab to see the cameras there now, and under "Earlier here" the ones that stood there before. The Deployments page under Admin tools lists every deployment of the project in one table, with filters for camera, site, status and date, and under More whether it moved. A deployment always shows as the same card: its site, camera, period and number of photos, each a link to what it names. A card a person set also says who set it and when.

![Deployment cards in the camera panel](https://github.com/user-attachments/assets/ede95215-eeed-45cb-b795-87559f3e0f2f)

*The Deployments tab of a camera, after a split. Each card says who set it, with Undo.*

On the Deployments page, click a row to open the deployment with a map. After a move it shows the last photo at the old site next to the first photo at the new one, which usually tells you straight away whether the camera really moved.

![The window of a move](https://github.com/user-attachments/assets/fb6510c8-83c3-4e1a-b474-d09dea1207f4)

*A camera that moved 6.2 km, with the last photo at the old site next to the first at the new one.*

## Correcting a deployment

Click Edit on a card. The form holds the site, the first day and the last day. Next to it, Now shows the deployment as it is, and After saving shows what saving will make of it. Days you leave out go back to the app, which places them from the GPS again. Undo on a card takes a correction back, and the app then places those days from the GPS again too.

![Edit deployment with a split](https://github.com/user-attachments/assets/a4fea7b2-658c-4515-b744-a31a6a12d001)

*Setting a last day splits the deployment. After saving shows the two parts before you save.*

## Suspicious moves

Bad GPS can still make a move that didn't happen, when the drift lasts long enough. The app marks such a deployment Suspicious, and Needs attention in the top bar counts it. Nobody has to answer, and a move nobody answers stays as the app made it. To check one, click the line in Needs attention, open the deployment and look at the map and the two photos. Click "Right, it went there" to clear the warning, or "Wrong, it stayed at X" to put the photos back at X. Both can be undone.

![A suspicious deployment](https://github.com/user-attachments/assets/1ef60692-32e4-4bcf-806a-d7b84b7ca66e)

*A trip of two photos that came back within a week. Right or Wrong answers it.*

## Common situations

### Preparing a project before the field work

When you know the camera IDs and the planned sites before the cameras go out, you can set the project up in advance. Add the cameras with Import from CSV under Add camera on the Cameras page, and the sites with Import from CSV under Add site on the Sites page. A camera with GPS is then placed on the nearest planned site within 250 metres by itself, from its first photo. A camera without GPS needs its site set once: open it, go to its Deployments tab, click Set site, and choose the site and the day it goes into the field.

### A camera moves to a new spot

There is nothing to do. The camera gets a new deployment on the nearest site within 250 metres of the new spot. If there is none, the app makes a new site with a placeholder name, like "Site at 53.2460, 5.2620", which you can rename on the Sites page.

### A camera moved less than 250 metres

The app doesn't see this as a move. Click Edit on the card and set the last day the camera stood at the old spot. That splits the deployment in two. Then click Edit on the new deployment and choose the right site.

### The app chose the wrong site

When two sites lie close together, the app can put a camera on the wrong one. Click Edit on the card and choose the right site.

### Recording the real field dates

The app only knows the photos, so a deployment runs from its first photo to its last, and the trap-nights are counted over those days. When you put a camera up days before its first photo, or took it down days after its last, click Edit and set the real first and last day. The trap-nights then follow your days.

### Several cameras at one place

Cameras within 250 metres of each other share one site. That's often right, for example when a new camera replaces a broken one, or when two cameras on one tree point in different directions. When you want them counted apart, for example two cameras on both sides of a wildlife bridge, click Edit on a camera's card, click New site next to the site list and give it its own name. You do this once. After that the camera keeps its own site, and a camera that later replaces it is placed on the nearest of the two sites, as long as its GPS is accurate enough to tell them apart.

### Field days and rotations

Move twenty cameras and each one gets a new deployment. A camera that arrives at a known site is placed on it, even when the cameras got shuffled. A rotation project, where cameras move between fixed stations, only needs one naming pass on the first day.

### A camera without GPS

The app can't place photos without GPS, so they have no site, and Needs attention shows the camera. Open the camera, go to its Deployments tab, click Set site, and choose the site and the first day. On the Images page, choose "No site" in the Sites filter to see them. Without GPS the app also can't see when such a camera moves, so every move needs you. Click Edit on its card and set the last day at the old spot. The photos after that day then have no site, and Set site gives them the new one.

![A camera without GPS](https://github.com/user-attachments/assets/bdab844b-8b13-4d49-a37e-25258f665b33)

*A camera without GPS. Set site gives its photos a site.*

### A camera stops adding GPS

A camera can stop adding GPS to its photos, for example after a firmware error. Its photos then stay at the site where it last had GPS, which is right as long as it doesn't move. When it does move, treat it as [a camera without GPS](#a-camera-without-gps).

### Two sites that are really one place

When one place exists as two sites, for example because GPS noise made a second one or a site was added twice, open the stray site on the Sites page, click Merge and pick the real one. Every camera that stood there moves along with its photos, and the stray site is removed. To move only one camera, use Edit on its card instead.
