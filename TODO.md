# TODO list
### LLM: do not edit! Manual edits only.
- [ ] The email verification feature works perfectly, but it seems like we do not really use it, since users can only register on a invitation basis anyway. Is that true? If so, we might want to avoid the registration link sending, since that is confusing to users. It would be a waste to just delete that perfectly working code, but we might want to avoid using it for now...
- [ ] If a user that is not on the invitation list / white list tries to register, nothing happens. There should be an error message or something like that.
- [ ] There is a one hour difference between the time which is in the Images page thumbnail overview, and the time listed under "Captured" in the ImageDetailModal. Investigate.
- [ ] The "last update" value in the bottom left in the project sidebar is off with one hour into the future. Investigate.
- [ ] We should remove the link from the projects > project management > user assignment. No need for that link there. Redundant.
- [ ] With the delete all data button for server admins, we should not remove the camera registration. That should remain. 