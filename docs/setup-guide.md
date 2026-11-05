# Setup guide

Your server is running. This guide covers everything from first login to processing your first images.

## Register your admin account

A registration link was sent to your `admin_email` during deployment. Click it to create your account and set your password. The link expires after 7 days and can only be used once. Check your spam folder if you don't see it.

If you are running multiple AddaxAI servers, the link may open a cached version of the wrong server. If that happens, clear your browser cache and click the link again.

![Screenshot 2026-03-23 at 14 40 11](https://github.com/user-attachments/assets/31408f95-ccd2-4bb4-a6c7-470a2696ca0d)

## Configure server settings

When you first log in, a warning asks for the camera timezone. Click it and set the timezone your cameras use.

![Server settings](https://github.com/user-attachments/assets/bad47f3b-c651-40ec-a2e1-04c65325f7da)

## Create a project

Once those are set, you can create your first project.

1. Go to the home page and click `Add project`
2. Enter a project name and optionally a description and image
3. Pick the species model, the AI model that names the animals. The list is grouped by region, so pick the one made for yours. The model cannot be changed later, so for another model you create a new project. If the server cannot take the model next to the ones already in use, a warning says why and what the server admin can do
4. Select the country where the cameras of this project are. It is optional, except for SpeciesNet, which needs it to skip species that do not live there
5. If you picked SpeciesNet, add the species labels CSV. See [SpeciesNet setup](speciesnet-setup.md) for how to make one
6. Click `Create project`

![Create project dialog](https://github.com/user-attachments/assets/10d7c266-28a3-481e-800e-3d492f078c43){ .screenshot-narrow }

A project groups your cameras, images, and users together. You can create multiple projects for different study areas or camera networks. When opening the project, you can see the options and a data-hungry dashboard.

![Project dashboard](https://github.com/user-attachments/assets/003657a1-1b89-4aa1-9059-b6aadc49a634)


## Add and connect cameras

Before adding cameras, check the [camera requirements](camera-requirements.md) to make sure your camera type is supported.

1. Open your project and go to the `Cameras` tab
2. Click `Add camera`, then `Add a single camera`
3. Fill in the fields:
   - **Camera ID** (required): must exactly match the camera ID embedded in the images and reports, otherwise they won't be linked. See [camera requirements](camera-requirements.md) for details on how this ID is extracted.
   - **Remarks** (optional): notes about the camera placement, angle, or anything else you want to remember.
   - **SIM expiry date** (optional): used by the monthly SIM expiry alert.
   - **Custom fields** (optional): click `Add field` to add any extra metadata you want to track, like "Heading: South" or "Tree: Oak".

A camera is just hardware, so it has no name. The place a camera stands is a site, and sites carry the names you work with day to day. A site is created automatically from the camera GPS, and you can rename it on the `Sites` tab. See [sites and cameras](sites-and-deployments.md).

To add several cameras at once, pick `Import from CSV` instead.

![Add camera dialog](https://github.com/user-attachments/assets/ebc6c78e-4fd7-4506-9889-4580387e81d5)

Then configure your cameras to upload via FTPS. See [camera requirements](camera-requirements.md#ftps-settings) for the connection settings and troubleshooting tips.

Once connected, images will be picked up and processed automatically. Results show up in the web interface after a few seconds. If not, check the [troubleshooting section](camera-requirements.md#troubleshooting) in the camera requirements doc.

### Taking a camera out of a project

Select the camera on the `Cameras` tab and choose `Delete`. The dialog gives two options.

- **Retire, keep the data.** The camera stays in the project as a retired camera. Its photos, labels, placements, health and service history stay, its current placement is closed at its last photo, and its open service tasks are removed. The Camera ID is free again, so you can register the same device in another project, or in this one, and it starts there with a clean history. This is the option for a camera that moves to another project, is stolen, or breaks.
- **Delete the camera and all its data.** Everything the camera recorded disappears, including the stored photo files. This cannot be undone.

A retired camera that still uploads is treated as an unknown camera until it is registered again.

### Moving a camera to another project

A camera belongs to one project at a time, and its Camera ID cannot be registered twice while it is in service. To move a device:

1. In the old project, select the camera on the `Cameras` tab, choose `Delete`, and pick `Retire, keep the data`. The old project keeps every photo and all history of that camera, shown under a retired camera.
2. In the new project, add the camera with the same Camera ID, by hand or by CSV. It starts there with a clean history. Nothing changes on the camera itself; its next upload lands in the new project.

Photos do not move with the camera. The old project keeps what the camera recorded there, the new project collects what it records from now on.

If you add a Camera ID that is still in service elsewhere, the app refuses with `Camera ID ... is already in use in project ...` and names the project when you are a member of it. Retire it there first.

## Invite users

You can invite other people to your projects. There are two project roles:

- **Project admin** can manage a specific project (cameras, users, settings)
- **Project viewer** has read-only access to a specific project and can set their own notifications

To invite someone (project admins and server admins only):

1. Open the project, go to `Admin tools` in the sidebar, then `Users`
2. Enter their email address and select a role
3. They'll receive an invitation email with a registration link

![Project users page](https://github.com/user-attachments/assets/dd32c904-b86b-467b-aed4-fffeb5a5c2e0)

Users can have different roles across different projects. For example, someone can be an admin of one project and a viewer of another.

To add a server admin (full access to all projects and system settings), go to `Server admins` in the hamburger menu on the projects page.

## Set up notifications

Users can configure their notification preferences in the project settings.

![Notification settings](https://github.com/user-attachments/assets/b25b5dd1-ce01-4402-a668-d61b0de5f127)

### Email reports

Email notifications (daily/weekly/monthly reports, battery alerts, system health, etc.) work out of the box using the SMTP settings from deployment.

### Telegram alerts

There are two steps to get Telegram working:

**Server admin: set up the bot**

Go to `Server settings`, click `Configure bot`, and follow the instructions in the modal.

![Screenshot 2026-03-25 at 16 57 31](https://github.com/user-attachments/assets/6f3f8495-de7a-4376-a534-780209759dfe)

**Each user: link their account**

Go to the `Notifications` page in any project, click the Telegram link button, and follow the instructions in the modal.

![Screenshot 2026-03-25 at 17 00 57](https://github.com/user-attachments/assets/923531a8-c819-42d1-baa3-31b9d392449e)

Once linked, add a rule under `Manage detection rules` and tick `Telegram`. A rule can be limited to certain sites.

The link is per project, so link once in every project you want alerts from. Several projects can use the same Telegram chat; every alert names its project, and the bot says which project each link is for.

**Messages stopped after a new phone?** If you deleted the bot chat on your old phone, or Telegram now runs under a new number, the server can no longer reach you. Go to the `Notifications` page, click `Link again` next to the Telegram row, and follow the modal once more. `Unlink` stops Telegram messages without linking a new account.

## You're all set

Once images start flowing in, your dashboards, maps, and galleries will fill up. Happy monitoring!

If you have any questions, let me know: peter@addaxdatascience.com
