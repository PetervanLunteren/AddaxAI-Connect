# EarthRanger

Send detections and camera alerts to an EarthRanger site as events on the ranger map. Each alert becomes one event with the photo attached and a link back to the full record. It works as a notification channel, next to email and Telegram: an event is sent once and is not changed afterwards.

The connection runs through Gundi, the integration service of EarthRanger. You need a Gundi account and admin access to the EarthRanger site. Gundi is free for conservation use; request access at [projectgundi.org](https://projectgundi.org/).

## How it works

1. A live image finishes classification.
2. The project's EarthRanger rules decide if it matters: which species, at which sites, at what time of day, how many animals, and a cooldown so one visit gives one event and not forty.
3. One event is posted to Gundi with the annotated image (the same image the Telegram alerts use, with the project's privacy blur applied).
4. Gundi forwards it to the EarthRanger site. It usually shows up within a minute.

Camera alerts work the same way: a camera with a low battery, a full SD card, silence, rejected files, or a theft watch trigger posts one event at the camera's site.

What is never sent: images from bulk uploads (an SD card carried in is history, not an alert), images that do not match a rule, and updates. If a person later corrects the species in Connect, the event in EarthRanger keeps the original label. Connect is the record, EarthRanger is the alert feed.

## Set up

### 1. Create the connection in Gundi

1. Log in at [gundiservice.org](https://gundiservice.org/) and click Create Connection.
2. Choose the API provider (also reachable as Connect API under "Not finding what you're looking for?").
3. Pick your workspace and give the connection a name, for example "AddaxAI Connect - Reserve name".
4. Add EarthRanger as the destination. Enter the site name from your EarthRanger URL and either the built-in Gundi Service Account or a token made by your EarthRanger admin.
5. Open the data provider node on the flow map, go to Connect, and copy the API key.

### 2. Prepare the EarthRanger site

The site needs the two event types below. An EarthRanger admin creates them under Admin > Activity > Event Types with Add Event Type, and pastes the schema. Put them in the event category your camera trap reports live in (Monitoring is common) and make sure the user behind the Gundi connection has permission on that category. Without that permission Gundi accepts the event but EarthRanger refuses it.

Detections. Display name "AddaxAI detection", value `addaxai_connect_detection`. The type and its keys carry the `addaxai_connect_` prefix, EarthRanger's way to keep one namespace per source.

```json
{
  "schema": {
    "$schema": "http://json-schema.org/draft-04/schema#",
    "title": "AddaxAI detection",
    "type": "object",
    "properties": {
      "addaxai_connect_species": {"type": "string", "title": "Species"},
      "addaxai_connect_scientific_name": {"type": "string", "title": "Scientific name"},
      "addaxai_connect_category": {"type": "string", "title": "Category"},
      "addaxai_connect_count": {"type": "integer", "title": "Count"},
      "addaxai_connect_confidence": {"type": "number", "title": "Confidence (0-1)"},
      "addaxai_connect_camera_id": {"type": "string", "title": "Camera"},
      "addaxai_connect_site_name": {"type": "string", "title": "Site"},
      "addaxai_connect_link": {"type": "string", "title": "Link to AddaxAI"}
    }
  },
  "definition": [
    {"key": "addaxai_connect_species", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_scientific_name", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_category", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_count", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_confidence", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_camera_id", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_site_name", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_link"}
  ]
}
```

Camera alerts. Display name "AddaxAI camera alert", value `addaxai_connect_camera_alert`:

```json
{
  "schema": {
    "$schema": "http://json-schema.org/draft-04/schema#",
    "title": "AddaxAI camera alert",
    "type": "object",
    "properties": {
      "addaxai_connect_alert": {"type": "string", "title": "Alert"},
      "addaxai_connect_summary": {"type": "string", "title": "Summary"},
      "addaxai_connect_camera_id": {"type": "string", "title": "Camera"},
      "addaxai_connect_site_name": {"type": "string", "title": "Site"},
      "addaxai_connect_link": {"type": "string", "title": "Link to AddaxAI"}
    }
  },
  "definition": [
    {"key": "addaxai_connect_alert", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_camera_id", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_site_name", "htmlClass": "col-lg-6"},
    {"key": "addaxai_connect_summary"},
    {"key": "addaxai_connect_link"}
  ]
}
```

The default priority of the event type decides the colour of the dot on the map. People and vehicles come in with `addaxai_connect_category` set to `person` or `vehicle`, so a site that wants those in red can ask the Gundi team for a mapping rule on that field, or give them their own event type.

### 3. Connect the project

1. Open Integrations > EarthRanger in the project menu (project admins only).
2. Paste the API key and save it.
3. Press Send test event. This posts a real event titled "Test from AddaxAI Connect" at the centre of your project area or at your first site. Check that it appears in EarthRanger, then resolve it there.

### 4. Choose what to send

The same page has three rule lists.

- Detection rules: which labels, at which sites, at what time of day, minimum group size, cooldown, and a "absent for days" filter for rare visitors. The cooldown starts at the project's independence interval. Keep it on, or a herd at a waterhole floods the map.
- Camera rules: battery below, SD card above, silent for more than, rejected files per day. Once per incident.
- Theft watch rules: a person unusually close to a camera, or a camera silent for longer than its own rhythm. Beta, can raise false alarms.

These rules belong to the project. Any project admin can change them, and they send to the ranger team, not to the person who made them. Your personal email and Telegram rules on the Notifications page are separate.

## What an event contains

| Field | Detection | Camera alert |
|---|---|---|
| Title | "Red fox at Site 4" | "Camera alert at Site 4" |
| Time | Capture time of the image, in the server timezone | Time of the check |
| Location | The image's GPS, or the site | The camera's current site |
| Details | species, scientific name, category, count, confidence, camera, site, link to the image | alert, summary, camera, site, link to the cameras page |
| Attachment | The annotated image, 1280 px, with boxes and the project's privacy blur | None |

## When something does not arrive

- **"Gundi returned 403"** when saving or testing: the API key is wrong or was revoked. Copy it again from the connection's data provider node.
- **The test event is accepted but nothing shows in EarthRanger:** open the connection in the Gundi portal and check its activity log. The usual causes are a missing event type on the site, or the Gundi user without permission on the event category.
- **Events stop after a while:** the page shows the last error. A camera without a site or GPS cannot be placed on a map, so its alerts are skipped and logged.
- **A development server sends nothing:** on purpose. A server marked as development only posts for the projects listed in `DEV_NOTIFY_EARTHRANGER_PROJECTS`, because a restored database carries real API keys.
- **Disconnect** forgets the key. The rules stay and start working again when a key is saved.
