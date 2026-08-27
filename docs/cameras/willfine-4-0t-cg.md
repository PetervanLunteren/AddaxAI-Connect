# Willfine 4.0T CG

A 4G camera trap that uploads photos over FTPS and sends a daily health report. This is the camera most AddaxAI Connect servers run on. For the hardware itself, see the [Smart Parks wiki](https://wiki.smartparks.org/addaxaiconnect/cameras/willfinet40cg).

<p style="text-align: center">
<img alt="A Willfine 4.0T CG in a locked metal security case, mounted on a tree" src="https://github.com/user-attachments/assets/60784b6e-b20d-4d0e-a8eb-a0cd86a27787" />
</p>

## Where to buy

Three routes, depending on how many cameras you need.

- **[Smart Parks](https://www.smartparks.org)** build AddaxAI Connect together with Addax Data Science, so they know the system from the inside. They sell in bulk only, at about 130 euro per camera. This is the cheapest way, and usually the easiest.
- **[Leitz Hungaria](https://www.leitz-hungaria.hu/en/Willfine-60-4-0-CG-4G-Trail-Camera)** sell single units for about 192 euro. They ship across central Europe, and worldwide by post for an extra fee. Often the easiest route for a handful of cameras as a pilot study.
- **[Willfine](https://www.willfine.com/products/willfine-4-0-t-cg-trail-camera/)** is the manufacturer. They sell mostly to bulk and OEM buyers and work with minimum order quantities, so check with them first what applies before you plan around it.

Check that the camera works on the mobile networks in your country. These should work almost everywhere, but not in North America, where the networks use different frequencies. Ask the seller before you order.

A camera that did not come through Smart Parks runs the stock Willfine firmware. It needs the Smart Parks firmware flashed on it once before you use it, see [firmware update](#firmware-update) below.

Only the Smart Parks route is tested. The cameras running on AddaxAI Connect servers today all came that way. The others sell the same camera and should work the same, but nobody has put one of those on a server yet, so there is no guarantee that cameras bought elsewhere will work. If they turn out to be a bit different, it might take some development and testing to get them going, so [open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) and we will work it out.

## Specifications

| | |
|---|---|
| Picture size | 5, 8, 12, 24 or 32 MP |
| Video resolution | FHD 1080p |
| Multi-shot | 1 to 5 photos |
| Camera plus video | yes |
| Time lapse and timer | yes |
| Lens field of view | 60° or 100° |
| Lens F number | F2.0 or F2.4 |
| IR range | 20 m (65 ft) |
| IR LEDs | 59 |
| PIR distance | 20 m (65 ft) |
| PIR sensitivity | L1 to L9 |
| Memory | SD card up to 128 GB |
| SD card cycle | on or off |
| Power | DC 12 V 2 A adapter, or 12 AA batteries |
| Waterproof class | IP66 |
| GPS | yes |
| Wireless module | LTE Cat 1, European or American version |
| Certification | CE, FCC, RoHS |

## Setup

Register the camera in `Camera Management` with its serial number as the `Camera ID`, then point it at your server with the standard [FTPS settings](../camera-requirements.md#ftps-settings).

The camera writes that serial number into the EXIF data of every photo, and the same number onto the `IMEI` line of its daily report. Both have to match the `Camera ID` you registered.

## What it sends

- Photos as JPEG, with GPS and the timestamp in the EXIF data. Both are required. A photo missing either one is rejected. It shows up as a rejected file on that camera in the Cameras page, and on the `File management` page, which server admins can reach from the hamburger menu.
- A daily report with signal strength, temperature, battery percentage, SD card usage, GPS, images taken and images sent. These fill the camera health page.

## Firmware update

These cameras run a Smart Parks firmware build. Cameras ordered through Smart Parks arrive with it already on them. A camera bought anywhere else runs the stock Willfine firmware and needs this one flashed first.

The firmware comes as a ZIP that the camera reads straight from its SD card. Flashing it takes about three minutes.

1. Download [DC-02-Camera_OTA.zip](https://github.com/PetervanLunteren/AddaxAI-Connect/releases/download/v0.7.1/DC-02-Camera_OTA.zip), 14 MB, built on 7 November 2025.
2. Note the version the camera has now. Press `MENU`, go to `Other` > `About`, and hold the right button for 10 seconds. The hidden version number appears. Write it down, you need it at the end.
3. Format an SD card as FAT32. It has to be 32 GB or smaller, a bigger card does not work.
4. Copy the ZIP into the root of the card. Do not unpack it, the camera reads the ZIP itself.
5. Put the card in the camera, put the camera on DC power or fresh AA batteries, and switch it to `Setup` mode. The camera rewrites its own firmware during the update, so one that loses power halfway is dead.
6. Press `MENU`, go to `Other` > `Firmware Update` > `Software`, and press `OK`.
7. Wait. The camera restarts on its own, shows `Please wait..` with the progress, and restarts again into `Setup` mode when it is finished.
8. Check the version again the same way as in step 2. If it changed, the update worked.

If the camera never reaches the update screen, either the file or the card is the problem. Try another SD card first, that is the more common one.

## Known issues

This camera has a longer re-trigger delay than cameras without a cellular connection. For most wildlife monitoring that is no problem, but it can matter in some research setups. Test the camera in a real field situation before you scale up to many of them. It is the trade-off for a connected camera that uses very little power and keeps running through long deployments.

If you run into something else, [open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues).
