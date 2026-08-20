# INSTAR

!!! warning "Under development"

    This camera is not properly tested yet, so we do not advise using it for a real deployment at this moment. The page describes how the support works today, and it can still change.

A wired IP camera. It works, but it is set up differently from the 4G camera traps, because it writes no metadata into its image files at all. There is no EXIF, so the camera identifier and the GPS location are taken from the upload directory path instead. You tell the camera which path to upload into, and the ingestion service reads that path to work out which camera the image belongs to and where it was taken.

## Setup

### Step 1: pick the lat/lon string for this camera

Use the format `lat<LATITUDE>_lon<LONGITUDE>` with a decimal point and a single underscore between the two halves. Use a `-` for southern or western hemispheres. Examples:

| Coordinates | Lat/lon string |
|---|---|
| 52.02368 N, 12.98290 E | `lat52.02368_lon12.98290` |
| 33.85679 S, 151.20929 E | `lat-33.85679_lon151.20929` |
| 33.85679 S, 70.65876 W | `lat-33.85679_lon-70.65876` |

### Step 2: register the camera

Go to `Camera Management` and use the lat/lon string as the camera's `Camera ID`, the same field where you would put an IMEI for other cameras. The match is case-insensitive but the rest of the string must be exact. Assign the camera to a project as usual.

### Step 3: configure the INSTAR web UI

Set the FTPS upload settings to the universal credentials in the [FTPS settings](../camera-requirements.md#ftps-settings) section. In the camera's "custom-path" field, enter:

```
INSTAR/<lat-lon-string>
```

For example: `INSTAR/lat52.02368_lon12.98290`. INSTAR drops every uploaded file straight into that directory:

```
INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.jpeg
INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.mp4
```

## What gets processed

Only JPEG stills with a timestamped filename go into the ML pipeline. INSTAR also uploads MP4 video clips into the same directory, and may produce `Test-Snapshot.jpeg` files when you press the "Test" button in the web UI. These are handled as follows:

| File | Behaviour |
|---|---|
| `A_YYYY-MM-DD_HH-MM-SS.jpeg` | Processed as a normal image. Datetime is parsed from the filename, GPS from the path. |
| `A_YYYY-MM-DD_HH-MM-SS.mp4` | Logged and deleted. Video is not processed. |
| `Test-Snapshot.jpeg` | Rejected as `missing_datetime`. Server admins see it in `File management`. |

## Known issues

- **The camera does not move by itself.** The location comes from the upload path, so if you move the camera you have to change the custom-path in the web UI and register a new `Camera ID`. The other cameras handle a move on their own from their GPS.
- **No health reports.** INSTAR sends no daily report, so battery, signal, SD card usage and the last report time stay empty on the camera health page. This is expected, not a misconfiguration. The active and inactive status still works, because it also counts the photos the camera sends.
- **The `A_` prefix is not understood yet.** Every filename seen so far starts with `A_`. If a future firmware turns that into a per-channel identifier, the `Camera ID` scheme needs another segment. [Open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) if you see a different prefix.
