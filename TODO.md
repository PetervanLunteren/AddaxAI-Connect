# TODO list
- [ ] The email verification feature works perfectly, but it seems like we do not really use it, since users can only register on a invitation basis anyway. Is that true? If so, we might want to avoid the registration link sending, since that is confusing to users. It would be a waste to just delete that perfectly working code, but we might want to avoid using it for now...
- [ ] If a user that is not on the invitation list / white list tries to register, nothing happens. There should be an error message or something like that.
- [ ] Make a Health page where we can see the status of all the services. Would it also be possible to restart the services there? Would it also be somehow possible to initiate a safe reboot of the entire server?
- [ ] Make a page for project admins where we can include/exclude images from the view and statistics. That way we can exclude test images for example.
- [ ] Can we expand the rejected page for server admins to also see the contents of the uploads folder directly?
- [ ] Add a detection threshold setting. 
- [ ] Test the new Pure-FTPd daemon with real camera images.

 Testing Steps

  1. Test FTPS connection:
  # From your local machine
  brew install lftp  # if not installed
  lftp -u camera,<ftps_password> -e "set ssl:verify-certificate no; set ftp:ssl-force true; put test.txt; bye" <your_vm_ip>

  2. Test auto-rename feature:
  # Upload same file twice
  lftp -u camera,<ftps_password> -e "set ssl:verify-certificate no; set ftp:ssl-force true; put test.txt; put test.txt; bye" <your_vm_ip>

  # SSH into VM and check
  ssh <user>@<vm_ip>
  ls -la /opt/addaxai-connect/uploads/
  # Should see: test.txt and test.1.txt

  3. Test atomic uploads (temp files):
  # While a large file is uploading, check for temp files
  ssh <user>@<vm_ip>
  watch -n 0.5 'ls -la /opt/addaxai-connect/uploads/ | grep pureftpd'
  # Should see .pureftpd-upload.* files during upload

  4. Monitor ingestion service:
  ssh <user>@<vm_ip>
  cd /opt/addaxai-connect
  docker compose logs -f ingestion
  # Should process renamed files normally