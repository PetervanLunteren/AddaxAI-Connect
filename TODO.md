# TODO list

### Priority 1
- [ ] INDEPENDENCE INTERVAL - I have been asked by users to add a independece interval, so we do not overcount animals that have several images taken of them. SO for example, if a group of grazing deer walk through the field of view, we might get 10 images of 5 deer. The system currently overcounts it as 50 deer, while in reality its just 5. How do similar camera trap management systems like Agouti, Camelot, Wildlife insights, TrapTagger, WildTrax, TRAPPER AI, eMammal do it? See below stadards to keep in mind. Please thoroughly investigate. I'm not in a rush. 
- GBIF camera trap best practices - https://docs.gbif.org/camera-trap-guide/en/ - Guidance on managing, structuring, validating, and publishing camera trap data at scale.
- Camtrap-DP (TDWG camera trap data package) - https://camtrap-dp.tdwg.org/ - The de facto data standard for camera trap datasets, defining tables, fields, relationships, and controlled vocabularies.
- Darwin Core (TDWG) - https://dwc.tdwg.org/ - A widely used biodiversity data standard enabling interoperability with GBIF and other biodiversity infrastructures.
- FAIR data principles - https://www.go-fair.org/fair-principles/ - Principles for making data findable, accessible, interoperable, and reusable.
- MegaDetector documentation (Microsoft AI for Earth) - https://github.com/microsoft/CameraTraps - Standards and conventions for animal detection models commonly used in camera trap workflows.
- eMammal camera trap protocols - https://emammal.si.edu/protocols - Best practices for camera deployment, metadata capture, QA/QC, and long-term monitoring.
- WCAG accessibility standards - https://www.w3.org/WAI/standards-guidelines/wcag/ - Accessibility guidelines applicable to research dashboards and annotation tools.
- Nielsen Norman Group usability heuristics - https://www.nngroup.com/articles/ten-usability-heuristics/ - Core UX principles for evaluating interface and workflow usability.
- OCI (Operational Camera Trap Metadata Standard) - https://github.com/tdwg/camtrap-dp/blob/main/metadata/README.md - Guidance for consistent camera trap metadata capture across projects.
- Open Geospatial Consortium standards (OGC) - https://www.ogc.org/standards - Standards for spatial metadata and georeferencing, relevant when publishing precise camera trap locations.
- Snapshot Safari / Zooniverse project design guidelines - https://help.zooniverse.org/kb/ - Guidance on annotation UI/UX, workflow design, and volunteer engagement for large-scale projects.


  ---
  Summary of defaults across platforms

  ┌───────────────────┬───────────────────┬────────────────────────┬────────────────────┬──────────────────────────────────────────────┐
  │     Platform      │ Sequence interval │ Independence interval  │   Configurable?    │                Applied when?                 │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ Agouti            │ 120s              │ N/A (at analysis)      │ Yes, per project   │ Sequence at ingest, independence at analysis │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ Wildlife Insights │ burst grouping    │ N/A (at download)      │ N/A                │ Download/analysis                            │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ TrapTagger        │ 60s (cluster)     │ 15min (sub-cluster)    │ Yes                │ Annotation time                              │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ Camelot           │ 600s              │ configurable           │ Yes                │ Analysis time                                │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ eMammal           │ 60s               │ 60 min                 │ Yes, per project   │ Sequence at ingest, independence at analysis │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ TRAPPER           │ 120s              │ 30 min typical         │ Yes                │ Analysis time                                │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ camtrapR          │ N/A               │ 0 (default, user sets) │ Yes (minDeltaTime) │ Analysis time                                │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ Snapshot Safari   │ burst (3 imgs)    │ 30 min                 │ Fixed              │ Analysis time                                │
  ├───────────────────┼───────────────────┼────────────────────────┼────────────────────┼──────────────────────────────────────────────┤
  │ Most common       │ 60-120s           │ 30 min                 │ Yes                │ Analysis/export time                         │
  └───────────────────┴───────────────────┴────────────────────────┴────────────────────┴──────────────────────────────────────────────┘

  ---
  Recommendation for AddaxAI Connect

  Based on this research, the standard approach would be:

  1. Sequence grouping (Level 1): Group consecutive images from the same camera within ~120 seconds into a sequence. This could happen at ingestion or detection time. The max count
   across images in the sequence is the group size.
  2. Independence interval (Level 2): Apply a configurable filter (default 30 minutes) when calculating statistics (RAI, species counts, etc.) and during data export. This filter
  operates per-species, per-camera. It should be a project-level setting that users can adjust.
  3. Store raw data: Keep every individual detection/classification in the database. Never discard data at ingestion. The independence filter is a view on the data, not a mutation
  of it.
  4. Align with Camtrap-DP: Use eventID to group observations. Support both media-level and event-level observation exports.












### Priority 2
- [ ] DEPLOYMENT DEFINITION - understand the definition of a deployment better. what defines it? Is that also what CamtrapDP defines as a deployment? 
- [ ] DAILY REPORT DEPENDENCE - make sure to understand how the mapping, deployment creation, etc. works. I'm curious because the current setup had two points of GPS truth (from the image and form the camera daily report). The current camera type (Willfine) does send this via daily report, but we want to make the system generic to cmaera types, so we should not rely on the daily reports, as I exepct that many cameras dont have this feature. The whole system (mapping, deployment creation, etc) should work just as well without these daily reports. Investigate. 
- [ ] SPECIESNET ADDITION - Make the whole system be able to use SpeciesNet as well as DeepFaune. (this will probably take a day or so, so make sure to write an elaborate prompt for this). 
- [ ] CAMID + IMEI - Make an ANIML sort of camera registration field, where you can choose "Camera type" and input "IMEI number". Thats all. That means that we need to properly make the camera types at the ingestion service. That we we can keep adding them as we go. The other cols, like box, serial number, etc, etc, are just metadata. The code should not depend on it. IMEI + camera type. 
- [ ] REJECT PAGE IMPROVEMENT - Can we expand the rejected page for server admins to also see the contents of the uploads folder directly?
- [ ] IPHONE APP - Make it so that the webapp looks like a native app on iphone. 
- [ ] ARTIFACT STORAGE - Add a project artifacts upload and download function. Good for storing settings files, etc. 
- [ ] TEST DATA SCRIPT - create a script that populates a fresh server with dummy data for showcaseing the platform. The script must populate the database with ecologically relevant data, and make sure it looks engaging in in maps, graphs, etc. We can go full overboard with 100 cams and 2 years of data.

### Priority 3
- [ ] EXLUCDE IMGS PAGE - Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] DROPDOWN SETTING - Limit the notifcation species options to only the ones selected to be poresent in the project.
- [ ] FULL SCREEN MAP VIEW - Add option to see maps in full screen. 

**SPW server**
- [ ] NEW server spw.addaxai.com project namne: ANLIER NORD
