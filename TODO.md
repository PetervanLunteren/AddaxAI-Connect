# TODO list

# Verification tasks
- [ ] CHECK IF THE TOTAL AND SEND PER DAY COUNTS ARE CORRECTLY STORED. 
- [ ] does the exsessive image notification work? 

## TODO Priority 2
- [ ] is it difficult to have the Activity pattern in the dashboard resemble a clock with hours around it? 
- [ ] Now it shows the bounding boxes on every image in the ImageDetailsModal by default. But the boxes are actually AI predictions, If a user adds an aninal via verification, it doesnt add a bounding box. Perhaps we can change the default to not show anything, but have a toggle to "Show AI predicitons" which makes it clearer that these are AI predictions, right? 
- [ ] Can a 2-minute independence interval be configured to ensure consistency with our previous projects?
- [ ] In the annotation tool, the dropdown only allows selection of species already observed in the project. Can this be expanded to allow corrections to species not yet observed?
- [ ] Similarly, how can a new species be added to the list? Could predefined species lists (like in Agouti) be implemented?
- [x] In the settings, I am unable to link a Telegram account for alerts, and I also get an error when saving preferences. Could you please check this? Errors and also cant save notification settings. Should be fixed in the latest version already. No change needed. Already fixed. 
- [ ] There is an inconsistency between the “Camera” and “Map” tabs: some deleted locations (test data) still appear on the map.
- [ ] Is it possible to define species-specific confidence thresholds?
- [ ] When navigating through images, is it possible to filter and display only those classified as “empty” in order to review false negatives? Should we add Empty as a label and change the filter "Species" to "Labels" so you have full control? 
- [ ] For each picture, it would be useful to add “stage” (adult, subadult, juvenile) and “sex” (male, female) fields, with “Unknown” as the default value.
- [ ] WOuld it make sense to have a list of behaviours to choose from? This can be image level.
- [ ] Could options such as “empty” and “unknown” be added as tags for images?
- [ ] It would be helpful to have a “like” feature (or similar tag) to send selected photos to a dedicated “Gallery” tab. This would be useful for reporting and communication purposes, allowing us to easily select the best images without browsing the entire dataset.
- [ ] Could brightness and contrast adjustment tools be added for night images (similar to Agouti)?
- [ ] Could a reference photo be attached to each camera to help identify its location in the field? We can have an upload feature in the camera slideout. 
- [ ] Could a “Performance” tab be added, including a confusion matrix summarizing corrected annotations (false positives, false negatives, misclassifications)? How would this work?


## Possible future features
- [ ] Allow manual upload of all SD card images that were not transmitted, in order to benefit from automatic recognition and centralize all data on the server?

