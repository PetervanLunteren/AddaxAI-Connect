# Sensing Clues

Send detections and camera alerts to a Sensing Clues group as observations in the Cluey app. Each alert becomes one observation with the annotated photo and a link back to the full record. It is a notification channel, like email and Telegram: an observation is sent once and never changed. Connect is the record, Cluey is the alert feed.

## Before you start

This page connects AddaxAI Connect to a Sensing Clues group you already have. Sensing Clues is a separate platform; if your organisation does not use it yet, start at [sensingclues.org ↗](https://www.sensingclues.org/){:target="_blank"} first, this integration only sends to an existing group.

You need:

- A Sensing Clues account and a group. Cluey is the field app, [Central ↗](https://central.sensingclues.org/){:target="_blank"} is the web app where groups and members are managed.
- Project admin access in AddaxAI Connect.

Use a separate Sensing Clues account for this, not your own login. AddaxAI Connect signs in as that account to post, so its password is kept on your server, and a separate account makes it clear in Cluey who posted what.

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

### 2. Make an account for AddaxAI Connect

*On the Sensing Clues side, one time.*

Make a Sensing Clues account for AddaxAI Connect to post with, and invite it into the group the same way you invite a colleague. Any account works, but a separate one keeps your own password out of it.

<!-- screenshot: the invite dialog with the account -->

### 3. Connect the project

*By a project admin.*

1. Find the group id. Open the group in Central; the id is the number shown with the group's details (Sensing Clues calls it the PID). Cluey shows the same number in the group's information.

<!-- screenshot: the group details in Central with the id -->

2. In AddaxAI Connect, open `Integrations > Sensing Clues` and click `Connect`. Fill in four things: the Sensing Clues address (already filled in, leave it unless Sensing Clues told you otherwise), the username and password of the account from step 2, and the group id.

Saving checks both halves with Sensing Clues first. If the password is wrong, or the account is not a member of that group, nothing is stored and the page says which of the two it is, naming the groups the account does belong to.

<!-- screenshot: the Sensing Clues integration page in AddaxAI Connect, connected -->

3. Click `Send test observation`. It posts a real observation titled "Test from AddaxAI Connect" at the centre of your project area or your first site, and shows the result. Check that it appears in the group.

To change anything later, click `Change connection`. The password is never shown, so you type it again even when you only change the group.

### 4. Choose what to send

*In AddaxAI Connect, by a project admin.*

A connected account on its own sends nothing. Every observation comes from a rule, so the last step is to add at least one. Until a rule is active, the page says so under the connection.

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

- **Saving says it could not sign in:** the address, the username or the password is wrong. Check them in Central, and mind that a pasted password can carry a space.
- **Saving says the account is not a member of the group:** the group id is wrong, or the account was not invited into that group. The message names the groups the account does belong to, which usually tells you which of the two it is.
- **Observations stop after a while:** the connection shows the last error. A camera without a site or GPS cannot be placed on a map, so its alerts are skipped and logged. A changed password on the Sensing Clues side also stops delivery until you connect again.
- **Nothing sends at all:** check that an account is connected and that at least one rule is active; the page shows a note when either is missing. Disconnect forgets the account and the group; the rules stay and resume when an account is connected again.
