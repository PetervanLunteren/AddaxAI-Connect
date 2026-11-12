# Privacy and data

!!! note
    This page describes AddaxAI Connect v0.19.0 (November 2026). It is not legal advice and makes no claim of compliance with any law. The organisation that runs a project decides whether its use is lawful.

On a server hosted by Addax Data Science and Smart Parks? See [hosted service](hosted-service.md) for where your data is and who runs the server.

## What data does it store?

The photos from your cameras, with the time and place they were taken, and what the AI and your users found in them. Next to that, the status reports of your cameras, the user accounts, the notifications that were sent, and the server logs.

## What personal data is in it?

About two groups of people.

People who pass a camera:

- Their image in the photo, which can show a face.
- The number plate of a vehicle, when it is readable.
- The time and the place of the photo.

You choose what happens to these photos. See [photos of people and vehicles](#what-happens-to-photos-of-people-and-vehicles).

People who use the app:

- Their email address and role. The app asks for no names.
- Their password, stored as a hash. Nobody can read the password itself.
- What they did in the app, for example which photos they verified.
- Notes and tags they write. These are free text, so they hold whatever a user types.
- The notifications sent to them, and their Telegram chat ID if they linked Telegram.
- Their IP address and email address in the server logs.

An invitation stores the email address of the invited person, also when they never sign up.

## Where is the data stored?

On the server that runs the app. Two optional features copy data to a storage bucket that the server admin chooses: cold storage for older photos, and a nightly backup.

## What happens to photos of people and vehicles?

You choose per project, under Privacy in the project settings. There is a separate choice for People and for Vehicles.

- Blur hides them in the app, in exports, in notifications and in integrations. This is the default. The stored original is not blurred. A project admin can view the original, and each view is logged with the user and the photo.
- Delete replaces the photo with a grey placeholder a few minutes after it arrives. The record stays: the time, the camera, the location and what was detected. This cannot be undone.
- Keep shows them as they are.

Blur and Delete only act on what the AI detects. A person it misses is not blurred or deleted. Delete only applies to new photos. Older photos you delete in Curation.

## How long is data kept?

Until you delete it. Photos are never deleted automatically. Files that a camera sends but the app cannot use are deleted after 30 days. When you delete a photo, its copy in the backup is gone within 90 days, and a deleted database record within 180 days. Server logs are limited by size or kept for 14 to 90 days, depending on the log.

## Who can see the photos?

Only people with an account, and only for the projects they are invited to. A project viewer can only look, and can be limited to some sites. A project admin also manages the project and its users. A server admin sees all projects. There are no public links to photos. Each account has its own login. How logins are protected is on the [security](security.md) page.

## Does data go to other parties?

Out of the box, no photos leave the server. Notifications are off for every user until they switch them on, and no integration is connected. Two kinds of email are always sent: account emails, like invitations and password resets, and alerts to the server admins about the server itself, like a failed backup or a full disk. These contain no photos.

You can switch on notifications by email and Telegram, and connect EarthRanger or Sensing Clues. Email notifications contain text and links, never photos. Telegram notifications contain a photo, its time and a map link. EarthRanger and Sensing Clues receive each detection with its time, location and photo. The app has no analytics or tracking.

## How do I delete data?

Delete photos in Curation, with or without their records. A camera and all its data you delete on the Cameras page. A whole project only the server admin can delete.

## How do I get my data out?

Use the Exports page. It downloads your observations, cameras and photos.
