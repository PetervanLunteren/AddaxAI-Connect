# Upload an SD card

Photos from an SD card go through the same analysis as the photos a camera sends over 4G. They never trigger species alerts, and they don't slow down the live cameras. Project admins find it under Admin tools, Bulk upload.

## Upload a folder

1. Click Bulk upload.
2. Drop the folder from the SD card in the window, or click to pick it. One folder holds the photos of one camera.
3. Check the numbers and the sample photos. A camera the app knows is found from its photos. For any other camera, pick the site where the photos were taken.
4. Click Upload and keep the tab open until the upload is done. You stay logged in while it runs.

Then the analysis runs on the server and you can close the tab. When the job is done, click "Review in curation" to check the results. An upload takes JPEG photos of up to 50 MB each, up to 20,000 at a time.

## Already in the project

A photo is already in the project when the same file is there, or when the camera already sent it over 4G as a smaller copy under another name. These photos are left out, so the 4G photo and its alerts stay as they are. You can upload a card again without making doubles, only the new photos go up.

## Why photos are skipped

Before the upload, the Review upload step warns about photos without a date or that can't be read, and those don't go up. After the analysis, the job says how many photos were skipped and why, and Log gives the list per photo. A photo without a location is not skipped. It gets the site the camera has on that day, and if the camera has none, it shows in Needs attention, see [a camera without GPS](sites-and-deployments.md#a-camera-without-gps). Skipped from an unknown camera means the photo comes from another camera model than the rest of the folder, so upload each camera on its own. Skipped as unreadable means the file is damaged. When the Review upload step says photos can't be opened, copy the folder to your computer and pick that copy. The browser can't read files that are only online in OneDrive, iCloud or Google Drive, or that are on a network drive.

## When an upload stops

When files don't arrive, for example because the connection drops, the upload pauses and the job says "Paused. Resume to send the rest of the folder." Click Resume and pick the same folder again, and only the missing files go up. A paused upload waits 7 days, then it is cancelled. Stop ends a job at any time, and photos that were already analysed stay in the project.
