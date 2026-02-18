# TODO list

### Priority 1
- [ ] what happens if we add a camera profile that doesnt send daily reports? Or daily reports with less information? Or not daily reports, but weekly reports, or hourly reports? Or variable duration reports? What breaks downstream? What features will not be used? That will ofcourse affect the information the user can find, but does it do it gracefully? 
- [ ] If friendly name not supplied, make unique combination of adjective and animal. That is a nice wink to the app. What do you propose? 
- [ ] build a proper test infrascturture where we can keep adding tests. Add some basic ones to fill the test suite. 
- [ ] add filter and sort options to the cameras table. How difficult would that be? 
- [ ] add a search bar above the cameras table that also searches the metadata key values pairs. 

### Priority 2
- [ ] SPECIESNET ADDITION - Make the whole system be able to use SpeciesNet as well as DeepFaune. (this will probably take a day or so, so make sure to write an elaborate prompt for this). 
- [ ] CAMID + IMEI - Make an ANIML sort of camera registration field, where you can choose "Camera type" and input "IMEI number". Thats all. That means that we need to properly make the camera types at the ingestion service. That we we can keep adding them as we go. The other cols, like box, serial number, etc, etc, are just metadata. The code should not depend on it. IMEI + camera type. 

### Priority 3
- [ ] EXLUCDE IMGS PAGE - Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] CLEAN REPO - Find all the MD files in the repo and check if they are old and redundant, or usefull to keep. Make a list, show me what they contain in one sentence, recommend to keep or remove, and ask me what to do with them for each file separately. 

**SPW server**
- [ ] NEW server spw.addaxai.com project namne: ANLIER NORD
