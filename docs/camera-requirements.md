# Camera requirements

Not every camera trap works out of the box. The system needs to know how to read your camera's metadata, so each camera type needs a camera profile. This page explains what's required and how to get a new camera integrated.

## Requirements

**Required:**

- **Configurable FTPS settings**: the camera must be able to send images via FTPS (FTP over TLS) to a custom IP address or domain
- **High-resolution images**: lower resolution leads to less predictable AI performance
- **GPS location** in each image
- **Camera identifier**: some link to the camera ID (usually IMEI or another unique identifier) so the system knows which camera the image came from
- **Date and time** in each image

How this metadata is embedded (filename, EXIF, etc.) does not matter. A custom camera profile handles the extraction for each camera type.

**Nice to have:**

- **Recurrent status reports** with information like signal strength, battery percentage, SD card usage, camera location, number of images on SD, etc. These are shown on the camera health page. If the camera does not send this information, those fields simply won't be populated, but the system works fine without them.

## Supported cameras

Every camera has its own page with the setup steps, the firmware notes, and the quirks worth knowing before you take it into the field.

| Camera | How it is identified | Good to know |
|---|---|---|
| [Willfine 4.0T CG](cameras/willfine-4-0t-cg.md) | Serial number in the EXIF data | Sends daily health reports. The page has the firmware update guide. |
| [Swift Enduro 4.0PCG-R](cameras/swift-enduro-4-0pcg-r.md) | IMEI in the filename | Sends daily health reports. |
| [INSTAR](cameras/instar.md) | Upload directory path | Under development, not properly tested yet. Writes no EXIF, so you set the location through the upload path. Sends no health reports. |

If your camera isn't listed, it needs a new profile. See below.

## FTPS settings

Configure your camera to upload via FTPS with these settings:

| Setting | Value |
|---------|-------|
| Host | `your_vm_ipv4` from `ansible/inventory.yml` |
| Port | `21` |
| Username | `camera` |
| Password | `ftps_password` from `ansible/host_vars/<server>.yml` |

??? tip "Firewall or networking issues?"

    Ansible opens all required ports on the server automatically: `21` (control channel), `990` (implicit FTPS), and `40000-50000` (passive mode data transfers). If your camera still connects but fails to upload, check whether an external firewall (cloud provider security group, corporate network, etc.) is blocking any of these ports.

## Camera profiles

A camera profile tells the system how to extract metadata from a specific camera model. It defines how to identify the camera type, how to extract the camera ID, and which fields are required. Profiles are defined in `shared/shared/camera_profiles.py`.

There are two kinds of profile. Most cameras are recognised by the make and model in the EXIF data of their photos. Cameras that write no EXIF at all, like INSTAR, are recognised by the directory they upload into instead.

When an image arrives, the system first checks the upload path against the path profiles, then the EXIF make and model against the rest. The matched profile extracts the camera ID, validates the required fields, and processes the image. If no profile matches, the image is rejected.

Creating a new profile usually takes a bit of time for development and testing. It involves:

1. Collecting a few sample images and daily reports from the camera
2. Inspecting the EXIF data and file naming patterns
3. Writing the extraction logic
4. Testing with the upload tool on the `File management` page to verify images are accepted and routed correctly
5. Uploading real images via your cameras over FTPS to confirm the full pipeline works end to end

If you need a new camera profile, [open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) with some sample files and we'll work it out.

## Troubleshooting

Images uploading but not showing up? Here are the most common causes:

- **No matching camera profile**: the system rejects images it can't identify. Go to `File management` (hamburger menu on the projects page, server admins only) to see rejected files and the reason they were rejected.
- **Missing required metadata**: if the camera profile requires GPS or date/time and the image doesn't have it, it gets rejected. These files still carry the camera ID, so they show up on the Cameras page as a `Rejected files` count and in the `Rejected` tab of that camera, for every project member.
- **Wrong file format**: only JPEG images are accepted (max 10 MB).
- **Daily reports not parsed**: reports must be under 1 MB and match the expected format for the camera profile.

![Screenshot 2026-03-25 at 16 29 08](https://github.com/user-attachments/assets/3a6b8ed0-2e39-4547-afcd-a325b6ecb8e7)

For more detail, check the ingestion logs:

```bash
docker compose logs ingestion --tail 50
```
