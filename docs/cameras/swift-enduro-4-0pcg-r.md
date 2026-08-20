# Swift Enduro 4.0PCG-R

A 4G camera trap that uploads photos over FTPS and sends a daily health report. For the hardware itself, see the [product page](https://outdoorcameras.com.au/shop/swift-enduro-4g/).

## Where to buy

Four Australian shops sell it, at around 490 AUD.

- [Outdoor Cameras Australia](https://outdoorcameras.com.au/shop/swift-enduro-4g/), Toowoomba
- [After Dark Surveillance](https://afterdarksurveillance.com/product/swift-enduro-4g/), Adelaide
- [Western Trapping Supplies](https://www.trapping.com.au/enduro-4g.html)
- [Raneye Systems](https://raneye.com.au/swift-enduro-4g/)

Make sure you get the Swift Enduro 4G. The same shops also sell a plain Swift Enduro without 4G, and that one cannot upload anything, so it does not work here.

## Setup

Register the camera in `Camera Management` with its IMEI as the `Camera ID`, then point it at your server with the standard [FTPS settings](../camera-requirements.md#ftps-settings).

This camera writes no serial number into the EXIF data. It puts the IMEI in the filename instead, as a 15 digit number, and that is what the system reads. Both filename styles work, with or without the camera name in front.

```
WBC398-868020035314870-10032026090126-4-SYPR0067.JPG
868020035314870-30032026102652-4-SYPR0260.JPG
```

The same IMEI is on the `IMEI` line of the daily report, so one registered `Camera ID` covers both.

## What it sends

- Photos as JPEG, with GPS and the timestamp in the EXIF data. Both are required. A photo missing either one is rejected and shows up on the `File management` page, which server admins can reach from the hamburger menu.
- A daily report with signal strength, temperature, battery percentage, SD card usage, GPS, images taken and images sent. These fill the camera health page.

The report carries an extra `CamID` field that the Willfine reports do not have. It is often empty, and nothing depends on it. The camera is always matched on the IMEI.

## Known issues

None reported so far. If you run into something, [open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues).
