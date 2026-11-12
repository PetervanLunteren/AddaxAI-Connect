# Hosted service

!!! note
    This page describes AddaxAI Connect v0.19.0 (November 2026). It is not legal advice and makes no claim of compliance with any law. The organisation that runs a project decides whether its use is lawful.

This page is for collaborators whose server is hosted by Addax Data Science and Smart Parks. How the software handles data is on the [privacy](privacy.md) and [security](security.md) pages.

## Who runs the service?

Smart Parks makes the agreement with you and supplies the cameras. Addax Data Science builds the software and runs the servers. Every collaborator gets its own server, so no data is shared between collaborators.

## Where is the data?

We choose the data centre together with you. If possible it is in your own country, otherwise in a country close by. See the locations of [DigitalOcean](https://docs.digitalocean.com/platform/regional-availability/) and [Wasabi](https://docs.wasabi.com/docs/where-is-my-data-stored-and-how-are-wasabis-storage-regions-secured).

Today every collaborator's server runs at DigitalOcean in Amsterdam, the Netherlands, with the database and the photos. Cold storage and backups are at Wasabi, also in Amsterdam. Emails from the app, like invitations and notifications, are sent with Gmail, over an encrypted connection and without photos. DigitalOcean, Wasabi and Google are companies from the United States. DigitalOcean holds a [SOC 2 Type II](https://www.digitalocean.com/trust/certification-reports) certification, and Wasabi an [ISO 27001](https://wasabi.com/compliance) certification. Wasabi encrypts all stored data by default (AES-256).

## Who can access the server?

Only Peter van Lunteren (Addax Data Science) and Tim van Dam (Smart Parks) can log in to the server itself (SSH). In the app they are server admins. Everyone else uses the app with the role they were invited for.

## Who owns the data?

You do. Addax Data Science and Smart Parks only use your data to run the service for you, and for nothing else. Your photos are not used to train AI models. The app does not train models at all. It uses existing models that were trained before, and they stay the same whatever photos come in. If you want a model trained on your own photos for your project, that is a separate job outside the app, and it only happens when you ask for it.

## How is the server set up?

Every server is set up the same way. Backups run every night, and older photos move to cold storage. Cameras must log in over an encrypted connection. People and vehicles are blurred by default, and you can choose to delete them on arrival instead. See [privacy](privacy.md#what-happens-to-photos-of-people-and-vehicles).

## Who keeps it up to date?

Addax Data Science. The operating system installs its security updates every day by itself. Known security problems in the software the app builds on are reported automatically. Fixes for those, and for bugs, come as new versions of the app. Security fixes get priority. Every update is first tested on a copy of the data of each server, and then installed one server at a time.

## What happens when the project ends?

On request you first get an export of your data. Then the server, the backups and the cold storage are deleted. The term for this is in your agreement.

## What is the service level?

The service is best effort. Problems are fixed as soon as possible, but there is no contract with guaranteed uptime, guaranteed response times or support around the clock. Best effort does not mean less care: every server is set up and kept up to date as this page describes. If your organisation needs such guarantees, you can run the software yourself or work with a specialised provider.

## For your processor agreement

| Item | Value |
|---|---|
| Data subjects | People who pass a camera, including drivers through number plates, and the users of the app |
| Personal data | Photos, time and place of photos, email addresses, activity in the app, server logs. See [privacy](privacy.md#what-personal-data-is-in-it) |
| Purpose | Running the camera trap platform for the collaborator |
| Sub-processors | DigitalOcean (server), Wasabi (cold storage and backups), Google (outgoing email) |
| Location | Chosen per project, if possible in the collaborator's own country. See [where is the data?](#where-is-the-data) |
| Retention | Until the collaborator deletes it. Backup copies up to 90 days after deletion, database records up to 180 days |
| End of the agreement | Export on request, then deletion of server, backups and cold storage |

## Who do I contact?

For questions, email [peter@addaxdatascience.com](mailto:peter@addaxdatascience.com). For plans and prices, see [plan.addaxai.com](https://plan.addaxai.com).
