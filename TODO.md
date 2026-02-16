# TODO list

### Priority 1


### Priority 2
- [ ] DEPLOYMENT DEFINITION - understand the definition of a deployment better. what defines it? Is that also what CamtrapDP defines as a deployment? 
- [ ] DAILY REPORT DEPENDENCE - make sure to understand how the mapping, deployment creation, etc. works. I'm curious because the current setup had two points of GPS truth (from the image and form the camera daily report). The current camera type (Willfine) does send this via daily report, but we want to make the system generic to cmaera types, so we should not rely on the daily reports, as I exepct that many cameras dont have this feature. The whole system (mapping, deployment creation, etc) should work just as well without these daily reports. Investigate. 
- [ ] SPECIESNET ADDITION - Make the whole system be able to use SpeciesNet as well as DeepFaune. (this will probably take a day or so, so make sure to write an elaborate prompt for this). 
- [ ] CAMID + IMEI - Make an ANIML sort of camera registration field, where you can choose "Camera type" and input "IMEI number". Thats all. That means that we need to properly make the camera types at the ingestion service. That we we can keep adding them as we go. The other cols, like box, serial number, etc, etc, are just metadata. The code should not depend on it. IMEI + camera type. 
- [ ] REJECT PAGE IMPROVEMENT - Can we expand the rejected page for server admins to also see the contents of the uploads folder directly?
- [ ] IPHONE APP - Make it so that the webapp looks like a native app on iphone. 
- [ ] ARTIFACT STORAGE - Add a project artifacts upload and download function. Good for storing settings files, etc. 

### Priority 3
- [ ] EXLUCDE IMGS PAGE - Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] DROPDOWN SETTING - Limit the notifcation species options to only the ones selected to be poresent in the project.
- [ ] FULL SCREEN MAP VIEW - Add option to see maps in full screen. 

**SPW server**
- [ ] NEW server spw.addaxai.com project namne: ANLIER NORD
