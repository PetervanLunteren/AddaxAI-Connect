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

Make a group for the camera trap alerts in Cluey or on the [Groups page in Central ↗](https://central.sensingclues.org/groups){:target="_blank"}, or pick an existing group. Every member of that group sees the observations, so choose the audience with that in mind.

![The Groups page in Sensing Clues Central, with a group listed.](https://github.com/user-attachments/assets/ad865f86-c4ca-4d6b-ae65-e6a221d1e203){ .screenshot }

### 2. Make an account for AddaxAI Connect

*On the Sensing Clues side, one time.*

Make a Sensing Clues account for AddaxAI Connect to post with, and invite it into the group on the [Group members page in Central ↗](https://central.sensingclues.org/members){:target="_blank"}, the same way you invite a colleague. Use a separate account, not your own login, so your password stays out of it and Cluey shows clearly who posted. The account name has to be unique across all of Sensing Clues, so build it from your organisation and project, for example `wwf-nl-serengeti-addaxai-connect`.

![The Group members page in Central, showing the account as a member.](https://github.com/user-attachments/assets/d2bd926a-61d3-4f3f-87b9-c7113a950b4a){ .screenshot }

### 3. Connect the project

*By a project admin.*

1. In AddaxAI Connect, open `Integrations > Sensing Clues` and click `Connect`. Log in with the username and password of the account from step 2. The Sensing Clues address is set once on the server, so you do not enter it here.

<!-- screenshot: the connect window, step 1, log in -->

2. Pick your group. After you log in, the groups that account can post into appear in a dropdown. Choose the one for these alerts and click `Save`. If the list is empty, the account is not a member of any group yet; invite it on the [Group members page in Central ↗](https://central.sensingclues.org/members){:target="_blank"} and log in again.

<!-- screenshot: the connect window, step 2, choose the group -->

3. If the username or password is wrong, a message tells you it could not sign in and you stay on the login step, so you can correct it and try again.

4. Click `Send test observation`. It posts a real observation titled "Test from AddaxAI Connect" at the centre of your project area or your first site. Check that it appears in the group, so you have seen one arrive before the first real alert.

![The Sensing Clues page in AddaxAI Connect, connected, with the rule lists below.](https://github.com/user-attachments/assets/fb46c2e6-83bb-4750-8fe2-73de5b210954){ .screenshot }

To change the group later, click `Change connection` and log in again. The password is never shown, so you enter it again even when you only change the group.

### 4. Choose what to send

*In AddaxAI Connect, by a project admin.*

A connected account on its own sends nothing. Every observation comes from a rule, so the last step is to add at least one. Until a rule is active, the page says so under the connection.

The same page has three rule lists.

- Detection rules: which labels, at which sites, at what time of day, minimum group size, cooldown, and an "absent for days" filter for rare visitors. The cooldown starts at the project's independence interval.
- Camera rules: battery below, SD card above, silent for more than, rejected files per day. Once per incident.
- Theft watch rules: a person unusually close to a camera, or a camera silent longer than its own rhythm.

These rules belong to the project, not to you. Any project admin can change them, and they send to the whole group. Your personal email and Telegram rules on the Notifications page are separate.

## What an observation contains

![A detection open in Central, showing the fields and the photo under Documents.](https://github.com/user-attachments/assets/938ba2ac-853e-4c56-9b52-99adbb5b34c4){ .screenshot }

| Field | Animal detection | Person or vehicle | Camera alert |
|---|---|---|---|
| Kind | Animal sighting | Human activity | Point of interest, alert |
| Headline | "Red fox at Site 4" | "Person at Site 4" or "Vehicle at Site 4" | The alert text, for example "CAM-012 with battery below 20%: 12%" |
| Time | Capture time of the image, in the server timezone | Same | Time of the check |
| Location | The image's GPS, or the site | Same | The camera's current site |
| Details | species, scientific name, count, confidence, classifier, camera, site, link to the image | activity "Person in camera", transport "On Foot" or "Vehicle ns", count, camera, site, link to the image | the trigger name (battery_low, sd_full, camera_silent, rejections, theft_watch_person, theft_watch_silence), camera, site, link to the cameras page |
| Attachment | The annotated image, about 800 px, with boxes and the project's privacy blur | Same | None |

## When something does not arrive

- **Logging in says it could not sign in:** the username or the password is wrong. Check them by signing in at [Central ↗](https://central.sensingclues.org/){:target="_blank"}, and mind that a pasted password can carry a space.
- **The group list stays empty:** the account is not a member of any group. Invite it into one on the [Group members page in Central ↗](https://central.sensingclues.org/members){:target="_blank"}, the same way you invite a colleague, then open the connect window again.
- **Observations stop after a while:** the connection shows the last error. A camera without a site or GPS cannot be placed on a map, so its alerts are skipped and logged. A changed password on the Sensing Clues side also stops delivery until you connect again.
- **Nothing sends at all:** check that an account is connected and that at least one rule is active; the page shows a note when either is missing. Disconnect forgets the account and the group; the rules stay and resume when an account is connected again.
