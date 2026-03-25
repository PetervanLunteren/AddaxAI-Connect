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

1. Go to the home page and click **Add project**
2. Enter a project name and optionally a description and image
3. Click **Create project**

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 15 52 21" src="https://github.com/user-attachments/assets/6edb85da-ef27-49b2-b599-2ee67b2c581a" />

A project groups your cameras, images, and users together. You can create multiple projects for different study areas or camera networks. When opening the project, you can see the options and a data-hungry dashboard.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 15 52 36" src="https://github.com/user-attachments/assets/def050e8-17f0-493a-8ecd-2e15fd9341de" />


## Add cameras

1. Open your project and go to the **Cameras** tab
2. Click **Add camera**
3. Enter the camera's device ID (the unique identifier your camera uses, usually found in the camera settings or EXIF data)
4. Optionally add a friendly name and notes

[add screenshot of add camera dialog]

You can also import multiple cameras at once using a CSV file.

## Configure camera traps

Before connecting your cameras, check the [camera requirements](camera-requirements.md) to make sure your camera type is supported.

Point your cameras at the server using FTPS.

| Setting | Value |
|---------|-------|
| Host | your server's IP address |
| Port | `21` (control), `990` (FTPS), `40000-50000` (passive) |
| Username | `camera` |
| Password | the `ftps_password` you set during deployment |
| Protocol | FTPS (explicit TLS) |

Once connected, images will be picked up and processed automatically. Results show up in the web interface within a few minutes.

## Invite users

You can invite other people to your projects. There are three roles:

- **Server admin** has full access to all projects and system settings
- **Project admin** can manage a specific project (cameras, users, settings)
- **Project viewer** has read-only access to a specific project

To invite someone to a project:

1. Open the project and go to the **Users** tab
2. Enter their email address and select a role
3. They'll receive an invitation email with a registration link

Users can have different roles across different projects. For example, someone can be an admin of one project and a viewer of another.

## Set up notifications (optional)

### Email reports

Email notifications (daily/weekly/monthly reports, battery alerts) work out of the box using the SMTP settings from deployment. Users can configure their notification preferences in the project settings.

### Telegram alerts

For real-time alerts via Telegram:

1. Go to **Server settings**
2. Enter your Telegram bot token and username
3. Users can then link their Telegram account from their profile

[add screenshot of Telegram settings]
