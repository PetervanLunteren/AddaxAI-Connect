# TODO list
- [ ] Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] Can we expand the rejected page for server admins to also see the contents of the uploads folder directly?
- [ ] blur people and vehicles disable only by server admin
- [ ] Limit the notifcation species options to only the ones selected to be poresent in the project.
- [ ] The filtering options in the IMages page do not take into account the detection threhsold. If there eg is a fox below the det thresh, and a dog above it, the image will still show up if you search for "fox". 
- [ ] Make it so that the webapp looks like a native app on iphone. 
- [ ] Add a project artifacts upload and download function. Good for storing settings files, etc. 
- [ ] how to reset youre password? Should we add an option in the hambuerger menu?
- [ ] Make an ANIML sort of camera registration field, where you can choose "Camera type" and input "IMEI number". Thats all. That means that we need to properly make the camera types at the ingestion service. That we we can keep adding them as we go. 
- [ ] It looks like the dashboard graph "Camera activity status - Based on last 7 days" doesnt show the same numbers of the "Status" column on the cameras page. Why?
- [ ] It seems that the detection threshold is not applied to the telegram notifications, but the visualisations (bbox + labels) on the telegram images are. Sometimes i get a message that a fox was observed, but nothing is visualised. I get the feeling that the fox in question has a detection confidence below the threshold, and is hence not visualised, but send nonetheless. Only send for detections above the detecion threshhold. investigate. 

**SPW points**
- [ ] export to camtrap DP
- [ ] Edit labels in ImageDetailModal. No need to adjust bounding boxes, just the counts per species. 
- [ ] NEW server spw.addaxai.com project namne: ANLIER NORD