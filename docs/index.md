# AddaxAI Connect

An open-source platform that automatically processes camera trap images with machine learning. It picks up images from your cameras via FTPS, detects and classifies animals, and shows you everything in a web interface with maps, charts, and notifications. Fully self-hosted on a single server.

**Try the demo:** [demo.addaxai.com](https://demo.addaxai.com/login)

![AddaxAI Connect on desktop, tablet, and phone](https://github.com/user-attachments/assets/0dad03d3-d103-41b7-bed7-626dffd0ff16#only-light)
![AddaxAI Connect on desktop, tablet, and phone](https://github.com/user-attachments/assets/76e0415d-956c-4c5c-8d72-ed4bae09da6d#only-dark)

## Getting started

1. [Check camera compatibility](camera-requirements.md): any FTPS-capable camera works, but each model needs a profile. See the list of supported cameras and how to add yours
2. [Deploy your server](deployment.md) with Ansible (about an hour)
3. [Set up your project](setup-guide.md): register, configure settings, add cameras, invite users
4. If you chose SpeciesNet, follow the [SpeciesNet setup](speciesnet-setup.md) for taxonomy mapping

## Using the app

- [Sites and cameras](sites-and-deployments.md): how images are organised by place, and how camera moves are handled
- [Install as an app](install-as-app.md): put AddaxAI Connect on your phone or computer

## Running your server

- [Operations and monitoring](operations.md): check service health, view logs, monitor the pipeline
- [Update guide](update-guide.md): safely update to new versions with backup and rollback
- [Restore guide](restore-guide.md): rebuild a server from a backup when the old one is lost

## Developer

- [Architecture](architecture.md): technology stack, data flow, services, data storage, security, and user roles
- [Dev server setup](dev-server-setup.md): create a development server from a production snapshot

Questions? [Open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) or email peter@addaxdatascience.com.
