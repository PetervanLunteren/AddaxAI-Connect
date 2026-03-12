# TODO list

# Verification tasks
- [ ] CHECK IF THE TOTAL AND SEND PER DAY COUNTS ARE CORRECTLY STORED. 
- [ ] does the exsessive image notification work? 

### TODO Priority 1
- [ ] SPECIESNET ADDITION - Make the whole system be able to use SpeciesNet as well as DeepFaune. (this will probably take a day or so, so make sure to write an elaborate prompt for this). 

great! thanks for the report. With all that information you already gathered, please investigate the following:

I want to add the option to deploy servers with a SpeciesNet classification model in stead of the Deppfaune model. It should be set in the ansible files somewhere (e.g., "speciesIDmodel: "DeepFaune-vXXX" / "SpeciesNet-vYYY""). There is no need for a selection of models in a server. The server is spin up with either models, never both. Switching between deepfaune and specienet is not needed. 

Please investigate how speciesnet works. You can find its repo here: /Users/peter/Documents/Repos/cameratrapai

I want to run only the classification model, not the full ensemble. I've done it before, where I only run the classification model separately from the detection model (no megadetector since we have a separate worker for that, right?). You can see how I've done it before here: /Users/peter/Documents/Repos/AddaxAI-WebUI

I just want a classification model worker with speciesnet running wihtout MD and without any rollup or geofencing. Just the raw classification model. 

In the end I want to run the model with a CSV that specifies the target animals (restrict_to_taxa_list), as can be read here: speciesnet-integration-notes.md. But that might be a step to far for this task. If we just get SpeciesNet running as a separate model instead of DeepFaune, the extra step to use that CSV is minor (right?). What do you think? 

Instructions:
* Read all MD file in root to get a understanding of the project. 
* If something is unclear at any point, stop and ask before continuing.
* Prioritize simplicity and clarity over perfection. The code must be clean, easy to read, and understandable for collaborators. Avoid unnecessary complexity.
* I'm not in a rush. Please be precise and do the task thoroughly. 
* Please ask me any question for clarification. I would rather that you ask too many questions than assume certain details. 
* Ask at least 3 clarifying questions before beginning. Based on the conventions set out in CONVENTIONS.md and your knowledge, give your recommended solution to each questions you ask me. 

Workflow:
* Based on my answers, suggest a few general approaches. These should range from simple solutions to more sophisticated alternatives, with clear trade-offs for each. For every approach, explain:
   - Complexity (difficulty, dependencies, maintainability)
   - Readability (clarity for collaborators)
   - Effect (impact on performance, usability, flexibility)
* Give your recommendation regarding the alternatives discribed earlier, with a short reasoning. 
* After I select an approach, draft a detailed plan for implementation.
* Only start working if I agree with the proposed plan.


### TODO Priority 2
- [ ] Add a notification method that sends out emails if something weird is happening with the server, like certain serveices not working anymore, or cameras not sending any images anymore for longer than X time, etc. What would a server maintainer want to get notified about, wihtout getting false positives. perhaps a last update of more than 1 day? 
- [ ] VERSION TAG NOT UPDATED - If I follow the steps in docs/update-guide.md, the tag in https://pwn.addaxai.com/about doesnt update.... Why? Shoudl we simplify this tag system to just an TXT file that gets written every time a release is done via github actions? That is very easy and just works always. 
- [ ] IMPROVE README - Improve the README so that it reflects a good, working repo. Make it consice, and refer to other specialised MD files if people want more info, or step-by-step instructions. 
- [ ] SETUP GUIDE - add a full step - by - step setup guide, including screenshots, etc. This goes past the server setup, and also handles user managment, timezone settings, testing via FTPS, etc. 
