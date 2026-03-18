# TODO list

# Verification tasks
- [ ] CHECK IF THE TOTAL AND SEND PER DAY COUNTS ARE CORRECTLY STORED. 
- [ ] does the exsessive image notification work? 

### TODO Priority 
- [x] make a speciesnet config page with the taxonomy mapping CSV upload option, validaiton, country and state dropdowns, etc. page only visible for servers deployed for speciesnet (for other models it wont make sense to have), where you can update the taxonomy mapping CSV and reprocess. 
- [x] make the server/settings and "SpeciesNet configuration" pages follow the same UI format as the projects settings page and notifications pages. Two col layout, title, caption left, widget on the right, one save button for all settings on the page. 
- [x] merge the "rejected files" and "upload to FTPS" pages into one. How to call it? I dont know. What about "Ingestion" or "FTPS". What do you propose? Merge them into one, with two cards, one for the upload function (two col, just like the settings pages, title + caption on the left, upload drag/drop widget on the right), and a separate card for the "rejected files". 
- [x] You can remove the "Delete all data" option in the server hamburger menu. We now have replaced it with a more finegrained option in the projects "curation" option. So remove the "Delete all data" option in the server hamburger menu, along with all the code and redundant files, API calls etc. No dead code. 
- [ ] make the country and state codes required. keep it simple, KISS. rollup and geofencing are always enabled. 
- [ ] if all looks good and there are no immediate things to edit anymore, test it from scratch for both speciesnet and deepfaune. Do some FTPS uploads, some notifcations, som CSVs, etc. Give it a full test suite manually. 



### TODO Priority 2
- [ ] Add a notification method that sends out emails if something weird is happening with the server, like certain serveices not working anymore, or cameras not sending any images anymore for longer than X time, etc. What would a server maintainer want to get notified about, wihtout getting false positives. perhaps a last update of more than 1 day? 
- [ ] VERSION TAG NOT UPDATED - If I follow the steps in docs/update-guide.md, the tag in https://pwn.addaxai.com/about doesnt update.... Why? Shoudl we simplify this tag system to just an TXT file that gets written every time a release is done via github actions? That is very easy and just works always. 
- [ ] IMPROVE README - Improve the README so that it reflects a good, working repo. Make it consice, and refer to other specialised MD files if people want more info, or step-by-step instructions. 
- [ ] SETUP GUIDE - add a full step - by - step setup guide, including screenshots, etc. This goes past the server setup, and also handles user managment, timezone settings, testing via FTPS, etc. 
