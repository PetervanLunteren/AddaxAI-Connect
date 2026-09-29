# EarthRanger

Send detections and camera alerts to an EarthRanger site as events on the ranger map. Each alert becomes one event with the annotated photo and a link back to the full record. It is a notification channel, like email and Telegram: an event is sent once and never changed. Connect is the record, EarthRanger is the alert feed.

## Before you start

This page connects AddaxAI Connect to an EarthRanger site you already run. EarthRanger is a separate platform; if your organisation does not use it yet, start at [earthranger.com ↗](https://www.earthranger.com/){:target="_blank"} first, this integration only sends to an existing site.

You need:

- An EarthRanger site, and admin access to it.
- A Gundi account. Gundi is EarthRanger's integration service, free for conservation use ([projectgundi.org ↗](https://projectgundi.org/){:target="_blank"}).
- Project admin access in AddaxAI Connect.

## How it works

1. A live image finishes classification.
2. The rules you set in AddaxAI Connect decide whether it goes through.
3. One event is posted to Gundi with the annotated image.
4. Gundi forwards it to EarthRanger, usually within a minute.

Camera alerts work the same way: a low battery, a full SD card, silence, rejected files, or a theft watch trigger posts one event at the camera's site.

Never sent: bulk uploads (an SD card carried in is history, not an alert), images that match no rule, and updates. Correct a species in Connect later and the EarthRanger event keeps the original label.

## Set up

### 1. Gundi and EarthRanger

Follow the [AddaxAI guide on EarthRanger support ↗](https://support.earthranger.com/camera-trap/addaxai){:target="_blank"}. It walks through creating the Gundi route with your EarthRanger site as the destination, adding the two event types to your site, and giving the Gundi user permission on their event category.

What AddaxAI Connect defines, and what that guide points back to, are the two event types.

- **Detections.**

    ```text title="Display name"
    AddaxAI Connect detection
    ```

    ```text title="Value"
    addaxai_connect_detection
    ```

    ```json title="Schema"
    {
      "schema": {
        "$schema": "http://json-schema.org/draft-04/schema#",
        "title": "AddaxAI Connect detection",
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

- **Camera alerts.**

    ```text title="Display name"
    AddaxAI Connect camera alert
    ```

    ```text title="Value"
    addaxai_connect_camera_alert
    ```

    ```json title="Schema"
    {
      "schema": {
        "$schema": "http://json-schema.org/draft-04/schema#",
        "title": "AddaxAI Connect camera alert",
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

The event type's default priority sets the colour of the dot on the map. People and vehicles arrive with `addaxai_connect_category` set to `person` or `vehicle`.

### 2. Connect the project

1. Log in at [gundiservice.org ↗](https://gundiservice.org/){:target="_blank"} and open your AddaxAI route. In the flow map, click the data provider, the AddaxAI box on the left, and copy its API key.

    ![The API key section of a Gundi connection](https://github.com/user-attachments/assets/ab19688b-fcdf-47ca-8097-376c558f1233)

2. In AddaxAI Connect, open `Integrations > EarthRanger`, click `Connect`, paste the key, and save.

    ![The EarthRanger integration page in AddaxAI Connect, connected](https://github.com/user-attachments/assets/22ea2e7b-c7b5-45b1-adee-a57a8107394a)

3. Click `Send test event`. It posts a real event titled "Test from AddaxAI Connect". Check that it appears in EarthRanger, then resolve it there.

### 3. Choose what to send

A saved key on its own sends nothing. Every event comes from a rule, so the last step is to add at least one detection, camera, or theft watch rule. The page explains each one, and says so under the connection until a rule is active.

These rules belong to the project, not to you. Any project admin can change them, and they send to the ranger team. Your personal email and Telegram rules on the Notifications page are separate.

## What an event contains

![An AddaxAI Connect detection event open in EarthRanger](https://github.com/user-attachments/assets/340ff8b8-5ef9-4ae3-8ea9-8b89156ced2d)

| Field | Detection | Camera alert |
|---|---|---|
| Title | "Red fox at Site 4" | "Camera alert at Site 4" |
| Time | Capture time of the image, in the server timezone | Time of the check |
| Location | The image's GPS, or the site | The camera's current site |
| Details | species, scientific name, category, count, confidence, camera, site, link to the image | alert, summary, camera, site, link to the cameras page |
| Attachment | The annotated image, 1280 px, with boxes and the project's privacy blur | None |

## When something does not arrive

- **Gundi rejects the key (403, or 400 with "anonymous is not a valid UUID"):** the key is wrong, revoked, or is the EarthRanger token from the destination instead of the data provider's API key. Copy it again from the route's data provider.
- **The test passes but nothing shows in EarthRanger:** open the route in Gundi and check its logs. The usual causes are a missing event type on the site (EarthRanger returns 400), or the Gundi user without permission on the event category (EarthRanger returns 403).
- **Events stop after a while:** the connection shows the last error. A camera without a site or GPS cannot be placed on a map, so its alerts are skipped and logged.
- **Nothing sends at all:** check that a key is saved and that at least one rule is active; the page shows a note when either is missing. Disconnect forgets the key; the rules stay and resume when a key is saved again.
