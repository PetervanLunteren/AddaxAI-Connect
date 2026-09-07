# Sensing Clues

Send detections and camera alerts to a Sensing Clues group as observations in the Cluey app. Each alert becomes one observation with the annotated photo and a link back to the full record. It is a notification channel, like email and Telegram: an observation is sent once and never changed. Connect is the record, Cluey is the alert feed.

## Before you start

This page connects AddaxAI Connect to a Sensing Clues group you already have. Sensing Clues is a separate platform; if your organisation does not use it yet, start at [sensingclues.org ↗](https://www.sensingclues.org/){:target="_blank"} first, this integration only sends to an existing group.

You need:

- A Sensing Clues account and a group. Cluey is the field app, [Central ↗](https://central.sensingclues.org/){:target="_blank"} is the web app where groups and members are managed.
- Project admin access in AddaxAI Connect.
- A server where the server admin has enabled Sensing Clues. The integration page says so when that is not the case, see the [deployment guide](../deployment.md).

AddaxAI Connect posts with its own Sensing Clues user, `addax_service`. You never enter a password; you invite that user into your group.

## How it works

1. A live image finishes classification.
2. The rules you set in AddaxAI Connect decide whether it goes through.
3. One observation is posted into your group, with the annotated photo.
4. It shows in Cluey and Central for every member of the group, usually within a minute.

Camera alerts work the same way: a low battery, a full SD card, silence, rejected files, or a theft watch trigger posts one observation at the camera's site.

Never sent: bulk uploads (an SD card carried in is history, not an alert), images that match no rule, and updates. Correct a species in Connect later and the observation in Cluey keeps the original label.

## Set up

Steps 1 and 2 are done once on the Sensing Clues side. Steps 3 and 4 are done by a project admin.

### 1. Make a group

*On the Sensing Clues side, one time.*

Make a group for the camera trap alerts in Cluey or in Central, or pick an existing group. Every member of that group sees the observations, so choose the audience with that in mind.

<!-- screenshot: the group in Central -->

### 2. Invite addax_service

*On the Sensing Clues side, one time.*

Invite the user `addax_service` into the group, the same way you invite a colleague. This is the account AddaxAI Connect posts with. Without it, every post is refused.

<!-- screenshot: the invite dialog with addax_service -->

### 3. Connect the project

*By a project admin.*

1. Find the group id. Open the group in Central; the id is the number shown with the group's details (Sensing Clues calls it the PID). Cluey shows the same number in the group's information.

<!-- screenshot: the group details in Central with the id -->

2. In AddaxAI Connect, open `Integrations > Sensing Clues`, click `Connect`, enter the group id, and save.

<!-- screenshot: the Sensing Clues integration page in AddaxAI Connect, connected -->

3. Click `Send test observation`. It posts a real observation titled "Test from AddaxAI Connect" at the centre of your project area or your first site, and shows the result. Check that it appears in the group.

### 4. Choose what to send

*In AddaxAI Connect, by a project admin.*

A saved group id on its own sends nothing. Every observation comes from a rule, so the last step is to add at least one. Until a rule is active, the page says so under the connection.

The same page has three rule lists.

- Detection rules: which labels, at which sites, at what time of day, minimum group size, cooldown, and an "absent for days" filter for rare visitors. The cooldown starts at the project's independence interval.
- Camera rules: battery below, SD card above, silent for more than, rejected files per day. Once per incident.
- Theft watch rules: a person unusually close to a camera, or a camera silent longer than its own rhythm.

These rules belong to the project, not to you. Any project admin can change them, and they send to the whole group. Your personal email and Telegram rules on the Notifications page are separate.

## What an observation contains

<!-- screenshot: a detection observation open in Cluey -->

| Field | Animal detection | Person or vehicle | Camera alert |
|---|---|---|---|
| Kind | Animal sighting | Human activity | Point of interest, alert |
| Headline | "Red fox at Site 4" | "Person at Site 4" or "Vehicle at Site 4" | The alert text, for example "CAM-012 with battery below 20%: 12%" |
| Time | Capture time of the image, in the server timezone | Same | Time of the check |
| Location | The image's GPS, or the site | Same | The camera's current site |
| Details | species, scientific name, count, confidence, classifier, camera, site, link to the image | activity "Person in camera", transport "On Foot" or "Vehicle ns", count, camera, site, link to the image | the trigger name (battery_low, sd_full, camera_silent, rejections, theft_watch_person, theft_watch_silence), camera, site, link to the cameras page |
| Attachment | The annotated image, about 800 px, with boxes and the project's privacy blur | Same | None |

## When something does not arrive

- **Saving or testing fails with a message that addax_service is not a member:** the group id is wrong, or `addax_service` was not invited into that group. Check both in Central.
- **The page says Sensing Clues is not enabled on this server:** the server admin has to add the service account, see the [deployment guide](../deployment.md). Until then the Connect button stays off.
- **Observations stop after a while:** the connection shows the last error. A camera without a site or GPS cannot be placed on a map, so its alerts are skipped and logged.
- **Nothing sends at all:** check that a group id is saved and that at least one rule is active; the page shows a note when either is missing. Disconnect forgets the group id; the rules stay and resume when one is saved again.
