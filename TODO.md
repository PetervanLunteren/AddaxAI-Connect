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
- [ ] ADD PROJECT BUTTON - Lets move the Add project option from the hamburger menu to an actual button (teal color, like the other buttons). That is better UX. Make sure it is only visible for server admins. 







- [ ] TEST DATA SCRIPT - create a script that populates a fresh server with dummy data for showcaseing the platform. The script must populate the database with ecologically relevant data, and make sure it looks engaging in in maps, graphs, etc. We can go full overboard with 100 cams and 2 years of data.

A few points:
- grid the camera's span the entire national park Hoge Veluwe in a grid. 
- For the images grid, just make placeholder images (perhaps a gradient?) and treat them as real camera trap images. The bounding boxes will displayed on this. 
- Make the data ecologically relevant, so do some research on the biodiversity of Hoge Veluwe park (it has wolves now!), and fill the BD with some nice ecologically relevent mock data so we have nice activity patterns. 
- Make the heatmaps also nive to see, so place some animals more in the north, others more in the south, etc. It needs to be engaging to look at, but also seem like real ecological data. 
- The script should be not one-off. I will need if more often to populte demo servers, so make sure to store it in the repo and use comments if we need to adjust it later. 

Instructions:
* If something is unclear at any point, stop and ask before continuing.
* Prioritize simplicity and clarity over perfection. The code must be clean, easy to read, and understandable for collaborators. Avoid unnecessary complexity.
* I'm not in a rush. Please be precise and do the task thoroughly. 
* Please ask me any question for clarification. I would rather that you ask too many questions than assume certain details. 

Workflow:
* Ask at least 3 clarifying questions before beginning.
* Based on my answers, suggest a few general approaches. These should range from simple solutions to more sophisticated alternatives, with clear trade-offs for each. For every approach, explain:
   - Complexity (difficulty, dependencies, maintainability)
   - Readability (clarity for collaborators)
   - Effect (impact on performance, usability, flexibility)
* Give your recommendation regarding the alternatives discribed earlier, with a short reasoning. 
* After I select an approach, draft a detailed plan for implementation.
* Only start working if I agree with the proposed plan.


### Priority 3
- [ ] EXLUCDE IMGS PAGE - Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] DROPDOWN SETTING - Limit the notifcation species options to only the ones selected to be poresent in the project.
- [ ] FULL SCREEN MAP VIEW - Add option to see maps in full screen. 

**SPW server**
- [ ] NEW server spw.addaxai.com project namne: ANLIER NORD
