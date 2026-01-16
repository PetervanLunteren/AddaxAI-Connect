# TODO list
### LLM: do not edit! Manual edits only.
- [ ] The email verification feature works perfectly, but it seems like we do not really use it, since users can only register on a invitation basis anyway. Is that true? If so, we might want to avoid the registration link sending, since that is confusing to users. It would be a waste to just delete that perfectly working code, but we might want to avoid using it for now...
- [ ] If a user that is not on the invitation list / white list tries to register, nothing happens. There should be an error message or something like that.
- [ ] With the delete all data button for server admins, we should not remove the camera registration. That should remain.
- [ ] The label on the thumbnails currently says "X detections". I want the classification labels there. If there are more than one, list them as separate items. And if there are more than 2, do something like "+ 2 more"