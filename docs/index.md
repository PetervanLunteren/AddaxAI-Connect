# AddaxAI Connect

An open-source platform that automatically processes camera trap images with machine learning. It picks up images from your cameras via FTPS, detects and classifies animals, and shows you everything in a web interface with maps, charts, and notifications. Fully self-hosted on a single server.

**Try the demo:** [demo.addaxai.com](https://demo.addaxai.com/login)

<p>
<img width="49%" alt="Dashboard" src="https://github.com/user-attachments/assets/99f2f7fe-f861-4bc2-8956-067285fd3bea" />
<img width="49%" alt="Map view" src="https://github.com/user-attachments/assets/732dd48a-47aa-4ac0-9d3b-1695eb371343" />
<img width="49%" alt="Gallery" src="https://github.com/user-attachments/assets/d8b6adba-e5f0-44fb-8264-26b52003095a" />
<img width="49%" alt="Statistics" src="https://github.com/user-attachments/assets/ba55901c-585d-4b85-a86c-762b02340391" />
</p>

## Getting started

Before you start, check [camera compatibility](camera-requirements.md): any FTPS-capable camera works, but each model needs a profile. See the list of supported cameras and how to add yours.

1. [Deploy your server](deployment.md) with Ansible (about an hour)
2. [Set up your project](setup-guide.md): register, configure settings, add cameras, invite users
3. If you chose SpeciesNet, follow the [SpeciesNet setup](speciesnet-setup.md) for taxonomy mapping

## Running your server

- [Operations and monitoring](operations.md): check service health, view logs, monitor the pipeline
- [Update guide](update-guide.md): safely update to new versions with backup and rollback

## Reference

- [Architecture](architecture.md): technology stack, data flow, services, security, and user roles

Questions? [Open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) or email peter@addaxdatascience.com.
