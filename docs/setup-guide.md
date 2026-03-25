# Setup guide

Your server is running. This guide covers everything from first login to processing your first images.

## Register your admin account

A registration link was sent to your `admin_email` during deployment. Click it to create your account and set your password. The link expires after 7 days and can only be used once. Check your spam folder if you don't see it.

<img width="1624" height="966" alt="Screenshot 2026-03-23 at 14 40 11" src="https://github.com/user-attachments/assets/31408f95-ccd2-4bb4-a6c7-470a2696ca0d" />

## Configure server settings

When you first log in, you'll see some warnings about missing settings. That's expected. Click on any setting name in the warning to go straight to the right page.

<img width="1624" height="966" alt="Screenshot 2026-03-23 at 14 41 04" src="https://github.com/user-attachments/assets/79d289f2-8c0c-4b6e-8b79-dc751462eb2d" />

The required settings depend on which classification model you chose:

- **Camera timezone** is required for all classification models. Select the timezone your cameras are set to.
- **SpeciesNet** requires additional setup (country, taxonomy mapping). See [speciesnet-setup.md](speciesnet-setup.md) for the full walkthrough.

## Create a project

Once those are set, you can create your first project.

1. Go to the home page and click `Add project`
2. Enter a project name and optionally a description and image
3. Click `Create project`

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 15 52 21" src="https://github.com/user-attachments/assets/6edb85da-ef27-49b2-b599-2ee67b2c581a" />

A project groups your cameras, images, and users together. You can create multiple projects for different study areas or camera networks. When opening the project, you can see the options and a data-hungry dashboard.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 15 52 36" src="https://github.com/user-attachments/assets/def050e8-17f0-493a-8ecd-2e15fd9341de" />


## Add and connect cameras

Before adding cameras, check the [camera requirements](camera-requirements.md) to make sure your camera type is supported.

1. Open your project and go to the `Cameras` tab
2. Click `Add camera`
3. Fill in the fields:
   - **Camera ID** (required): must exactly match the camera ID embedded in the images and reports, otherwise they won't be linked. See [camera requirements](camera-requirements.md) for details on how this ID is extracted.
   - **Friendly name** (optional): a human-readable name like "North Ridge" or "Waterhole cam". If left empty, the camera ID is used as the display name.
   - **Remarks** (optional): notes about the camera placement, angle, or anything else you want to remember.
   - **Custom fields** (optional): click `Add field` to add any extra metadata you want to track.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 16 46 52" src="https://github.com/user-attachments/assets/218a2ac4-8e68-4862-9797-306ef162deeb" />

You can also import multiple cameras at once using a CSV file.

Then configure your cameras to upload via FTPS:

| Setting | Value |
|---------|-------|
| Host | your server's IP address |
| Port | `21` (control), `990` (FTPS), `40000-50000` (passive) |
| Username | `camera` |
| Password | the `ftps_password` you set during deployment |
| Protocol | FTPS (explicit TLS) |

Once connected, images will be picked up and processed automatically. Results show up in the web interface after a few seconds. If not, check the [troubleshooting section](camera-requirements.md#troubleshooting) in the camera requirements doc.

## Invite users

You can invite other people to your projects. There are two project roles:

- **Project admin** can manage a specific project (cameras, users, settings)
- **Project viewer** has read-only access to a specific project and can set their own notifications

To invite someone:

1. Open the project and go to the `Users` tab
2. Enter their email address and select a role
3. They'll receive an invitation email with a registration link

Users can have different roles across different projects. For example, someone can be an admin of one project and a viewer of another.

To add a server admin (full access to all projects and system settings), go to `Server admins` in the hamburger menu on the projects page.

## Set up notifications (optional)

### Email reports

Email notifications (daily/weekly/monthly reports, battery alerts) work out of the box using the SMTP settings from deployment. Users can configure their notification preferences in the project settings.

### Telegram alerts

There are two steps to get Telegram working:

**Server admin: set up the bot**

Go to `Server settings`, click `Configure bot`, and follow the instructions in the modal.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 16 57 31" src="https://github.com/user-attachments/assets/6f3f8495-de7a-4376-a534-780209759dfe" />

**Each user: link their account**

Go to the `Notifications` page in any project, click the Telegram link button, and follow the instructions in the modal.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 17 00 57" src="https://github.com/user-attachments/assets/923531a8-c819-42d1-baa3-31b9d392449e" />

Once linked, users can select which species they want to receive instant Telegram notifications about in their project notification settings.
