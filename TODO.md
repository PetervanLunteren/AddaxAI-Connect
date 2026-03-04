# TODO list

### PWN feedback
- [x] in the dashboard, plot "Detection trend", if set to "by month", it does not sort the months properly on the x-axis. It now does e.g., feb 2026, jan 2026, mar 2026. why? investigate the issue and show me how to solve it. 
- [x] Person and vehicle are also important to include in the filters. Currently, most filters only show species (cow, fox, dog, etc). Can we include the classes "Person" and "Vehicle" in there too? They are a bit different than the species, as the species have to labels and confidences (animal 78%, cow 96%), and person and vehicle only have predictions for the detection model (person 89%). Is it difficult to implement these two classes alongside the speices? First lets make an overview of where in the app we use filters, lists, or other multi selects for species, and then implement the addition of person and vehicle into those widgets. 
- [ ] in the PWN server ("ssh pwn", only read there! No edits!) the [map](https://pwn.addaxai.com/projects/1/map) view "points" show several different deployments for each camera. See examples below. Why? As far as I know they did not change camera's. Why are they separated in deployments? I did do an update on server on the 25th. Could that have caused this discrepancy? Investigate.
1)  Zeepoort ZO
    Period:
    2026-01-18 — 2026-02-24
    Trap-days:
    38
    Detections:
    106
    Rate:
    278.95 / 100 trap-days
2)  Zeepoort ZO(Deployment 2)
    Period:
    2026-02-25 — Active
    Trap-days:
    6
    Detections:
    13
    Rate:
    216.67 / 100 trap-days
- [ ] In the history tab of the camera details slideout (triggers when clicked on a camera row in the /cameras page), it shows the signal as a line plot with absolute values on the Y axis. This is great! But its hard for users to interpret these values on the y axis. In the table we have converted them to "Excelent, fair, moderate, poor" or something similar. Can you check those categories, their ranges, and plot them on the same signal history plot as ranges where the line crosses through? That will give the user more context, and we keep the same level of detail. 
- [ ] In the history tab of the camera details slideout (triggers when clicked on a camera row in the /cameras page), it shows the "SD used" as 100%, while the table shows 0% SD used... why? Whats the problem? I've been fixing these SD used vs SD free bugs for some time now. Lets make an overview of where this information is showed to the user, and whether or not it converts it (100-X) before showing it. It needs to be fixed once and for all. I think a lot of confusing comes from the format that the daily reports report the SD values. Should we normalise all SD showing forntend points to all use the same value (SD used, which is low (0 - 5%) in the PWN server) ("ssh pwn", only read there! No edits!). Would it make more sense to just convert the SD value from the daily report in the camera profile directly? Another camera might supply the SD value is another format, so the convertion needs to happen there directly, and then just passed on to the rest of the app without any further conversion. Does that make sense? 
- [ ]In the history tab of the camera details slideout (triggers when clicked on a camera row in the /cameras page), it shows the "images on SD" as 0 all the time. Why? How do we get these values anyway? Are they on the daily reports? Or are we counting them ourselves? Where do we currently get that information from, and is that the best solution? It doesnt seem to work... Investigate.
- [ ] Can we add an email notification toggle that sends an email when a camera has send 50 images that day to the system? It should reset every day at 00:00 in the night (timezone aware). The notification email should follow the same UI format as the others and tell the user which camera it is (friendly name, IMEI, location (perhaps show a tiny map with pin), some other information like tags, comments, etc). This should be a new checkbox in the email section of the notifications page. 
- [ ] Currently, the telegram notifications also show checkboxes for "battery warnings", and "system health alerts". These do not work, right? They are mockups, correct? I couldnt get them to work at least. Investigate. 
- [ ] The notifications page currently shows "Enable telegram notifications" and "enable email reports". WHy? That can also be deterred from whether or not the user has chosen to get a notification below, right? So perhaps just show all options anyway, regardless of whether the checkboxes "Enable telegram notifications" and "enable email reports" are enabled. If telegram is not linked, show the current message as-is, but grey out the telegram options below. Also if the server admin did not yet set up an telegram bot, show the message in the same format as the "Your Telegram account is connected and ready to receive notifications. Click here to unlink." text (non intrusive), but change text to something like "Your server admin has not yet configured a Telegram bot for this project. Click here to email server admin." and then the options below should be greyed out too. 
- [ ] I want to implement a tag system for camera's. Lets make an option to add tags (choose from existing project-specific tags, or add new) at camera level. This addition should be done at the camera details slideout (triggers when clicked on a camera row in the /cameras page). There should be a new column in the table that shows the tags with max with and a max number. Something like (bridge), (naturephot...), (+ 2). These tags should then be filterable in the dashboard (next to the date range, or perhaps better, make it a filter popover so we can add more later), and in the /images page filters. It should be a multiselect for tags. default: all. Lets make a plan.
- [ ] We've received some feedback form users that they would like to have something like the "Independence interval" in the /settings page, but then to link multiple camera's to each other. E.g., sometimes projects have camera's from different locations pointing at the same location, or they would have cameras on both ends of an ecoduct. Both these examples show that multiple cameras actually capture the same individuals. So could we make something where users can "link" (or perhaps better "group" camera's inoto pools that share their "independence interval"). Probabaly best to have it open a Modal where users can set these groups. How this will look exactly in terms of UI I would like to be recommended by you. What is the standard here? What is usually done in situations like this? Lets make a plan! 

- 



### Priority 1
- [ ] make the "Import cameras from CSV" modal clearer that it only needs IMEI. Give some more examples, one only IMEI, one with IMEI, notes, friendly_name, and one with additional key:value pairs. 
- [ ] for the CSV camera import, do not require any cols except IMEI. Only IMEI should be sufficient. If friendly name and notes are not present, add them as empty cols. Or just fill in wioth the current logic....
- [ ] what happens if we add a camera profile that doesnt send daily reports? Or daily reports with less information? Or not daily reports, but weekly reports, or hourly reports? Or variable duration reports? What breaks downstream? What features will not be used? That will ofcourse affect the information the user can find, but does it do it gracefully? 
- [ ] If friendly name not supplied, make unique combination of adjective and animal. That is a nice wink to the app. What do you propose? 
- [ ] build a proper test infrascturture where we can keep adding tests. Add some basic ones to fill the test suite. 
- [ ] add filter and sort options to the cameras table. How difficult would that be? 
- [ ] add a search bar above the cameras table that also searches the metadata key values pairs. 
- [ ] I cant remove a camera form the list (try SPW camera IMEI "8,61943E+14"). Its probabaly an issue wit the IMEI being weird. This also avoids the delete all data option. We need to make this possible. The IMEI can also be some weird unique ID. 
- [ ] Add link to location google maps from ImageModal. For quick check for image location. 
- [ ] Add a page where project admins can see all the images (add it under the "Admin tools" section) in a simple table with column sorting, filtering, etc. The idea here is that admins can select one or mulitple images and choose to hide them from the analysis, or remove them from the database all together (like test images or private images, etc).  

### Priority 2
- [ ] SPECIESNET ADDITION - Make the whole system be able to use SpeciesNet as well as DeepFaune. (this will probably take a day or so, so make sure to write an elaborate prompt for this). 

### Priority 3
- [ ] EXLUCDE IMGS PAGE - Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] CLEAN REPO - Find all the MD files in the repo and check if they are old and redundant, or usefull to keep. Make a list, show me what they contain in one sentence, recommend to keep or remove, and ask me what to do with them for each file separately. 

**SPW server**
- [ ] NEW server spw.addaxai.com project namne: ANLIER NORD
