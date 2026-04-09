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

* [Willfine 4.0T CG](https://wiki.smartparks.org/addaxaiconnect/cameras/willfinet40cg)
* [Swift Enduro 4.0PCG-R](https://outdoorcameras.com.au/shop/swift-enduro-4g/)
* INSTAR (path-based profile, see below)

If your camera isn't listed, it needs a new profile. See below.

## FTPS settings

Configure your camera to upload via FTPS with these settings:

| Setting | Value |
|---------|-------|
| Host | `your_vm_ipv4` from `ansible/inventory.yml` |
| Port | `21` |
| Username | `camera` |
| Password | `ftps_password` from `ansible/group_vars/dev.yml` |

??? tip "Firewall or networking issues?"

    Ansible opens all required ports on the server automatically: `21` (control channel), `990` (implicit FTPS), and `40000-50000` (passive mode data transfers). If your camera still connects but fails to upload, check whether an external firewall (cloud provider security group, corporate network, etc.) is blocking any of these ports.

## Camera profiles

A camera profile tells the system how to extract metadata from a specific camera model. It defines how to identify the camera type, how to extract the camera ID, and which fields are required. Profiles are defined in `services/ingestion/camera_profiles.py`.

When an image arrives, the system checks each profile until the EXIF make and model match. The matched profile then extracts the camera ID, validates required fields, and processes the image. If no profile matches, the image is rejected.

Creating a new profile usually takes a bit of time for development and testing. It involves:

1. Collecting a few sample images and daily reports from the camera
2. Inspecting the EXIF data and file naming patterns
3. Writing the extraction logic
4. Testing with the upload tool on the `File management` page to verify images are accepted and routed correctly
5. Uploading real images via your cameras over FTPS to confirm the full pipeline works end to end

If you need a new camera profile, [open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) with some sample files and we'll work it out.

## INSTAR setup

INSTAR cameras don't write any metadata into their image files (no EXIF), so the camera identifier and GPS location are taken from the upload directory path instead. The admin tells the camera which path to upload into, and the ingestion service parses the path to figure out which camera the image belongs to and where it was taken.

**Step 1: pick the lat/lon string for this camera.** Use the format `lat<LATITUDE>_lon<LONGITUDE>` with a decimal point and a single underscore between the two halves. Use a `-` for southern or western hemispheres. Examples:

| Coordinates | Lat/lon string |
|---|---|
| 52.02368 N, 12.98290 E | `lat52.02368_lon12.98290` |
| 33.85679 S, 151.20929 E | `lat-33.85679_lon151.20929` |
| 33.85679 S, 70.65876 W | `lat-33.85679_lon-70.65876` |

**Step 2: register the camera in Camera Management.** Use the lat/lon string as the camera's `device_id` (the same field where you'd put an IMEI for other cameras). The match is case-insensitive but the rest of the string must be exact. Assign the camera to a project as usual.

**Step 3: configure the INSTAR web UI.** Set the FTPS upload settings to the universal credentials in the [FTPS settings](#ftps-settings) section above. In the camera's "custom-path" field, enter:

```
INSTAR/<lat-lon-string>
```

For example: `INSTAR/lat52.02368_lon12.98290`. INSTAR drops every uploaded file straight into that directory:

```
INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.jpeg
INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.mp4
```

**What gets processed.** Only JPEG stills with a timestamped filename are sent into the ML pipeline. INSTAR also uploads MP4 video clips into the same directory, and may produce `Test-Snapshot.jpeg` files when you press the "Test" button in the web UI. These are handled as follows:

| File | Behaviour |
|---|---|
| `A_YYYY-MM-DD_HH-MM-SS.jpeg` | Processed as a normal image. Datetime is parsed from the filename, GPS from the path. |
| `A_YYYY-MM-DD_HH-MM-SS.mp4` | Logged and deleted. Video is not processed. |
| `Test-Snapshot.jpeg` | Rejected as `missing_datetime`. Visible in `File management`. |

INSTAR cameras do not send daily health reports, so the battery, signal, SD usage, and "last seen" health fields stay empty. This is expected, not a misconfiguration.

## Troubleshooting

Images uploading but not showing up? Here are the most common causes:

- **No matching camera profile**: the system rejects images it can't identify. Go to `File management` (hamburger menu on the projects page, server admins only) to see rejected files and the reason they were rejected.
- **Missing required metadata**: if the camera profile requires GPS or date/time and the image doesn't have it, it gets rejected.
- **Wrong file format**: only JPEG images are accepted (max 10 MB).
- **Daily reports not parsed**: reports must be under 1 MB and match the expected format for the camera profile.

![Screenshot 2026-03-25 at 16 29 08](https://github.com/user-attachments/assets/3a6b8ed0-2e39-4547-afcd-a325b6ecb8e7)

For more detail, check the ingestion logs:

```bash
docker compose logs ingestion --tail 50
```
