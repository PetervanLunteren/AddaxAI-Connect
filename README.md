<p align="center">
  <img src="https://github.com/PetervanLunteren/EcoAssist-metadata/blob/main/AddaxAI-logo/logo_incl_text_bottom.png" width="40%" />
</p>
<h1 align="center">Connect</h1>

<br>

<div align="center">

[![status](https://joss.theoj.org/papers/dabe3753aae2692d9908166a7ce80e6e/status.svg)](https://joss.theoj.org/papers/dabe3753aae2692d9908166a7ce80e6e)
[![Project Status: Active The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)
![GitHub](https://img.shields.io/github/license/PetervanLunteren/AddaxAI-Connect)

</div>

<div align="center">

![GitHub last commit](https://img.shields.io/github/last-commit/PetervanLunteren/AddaxAI-Connect)
![GitHub release](https://img.shields.io/github/v/release/PetervanLunteren/AddaxAI-Connect)
[![docs](https://github.com/PetervanLunteren/AddaxAI-Connect/actions/workflows/deploy-docs.yml/badge.svg)](https://petervanlunteren.github.io/AddaxAI-Connect/)

<h3>
  
Official documentation: https://petervanlunteren.github.io/AddaxAI-Connect/

</h3>

</div>

<br>


**AddaxAI Connect** is an open-source platform that automatically processes camera trap images with machine learning. It picks up images from your cameras via FTPS, figures out what's in them, and shows you everything in a web interface with maps, charts, and notifications. Fully self-hosted on a single server, so your data stays yours. Deploy it, point your cameras at it, and go do something more fun than manually sorting thousands of photos of empty bushes.

A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org). Built on [AddaxAI](https://github.com/PetervanLunteren/addaxai) for the ML backbone.

## What it looks like

Try it yourself: [demo.addaxai.com](https://demo.addaxai.com/login)

<p>
<img width="49%" alt="Screenshot 1" src="https://github.com/user-attachments/assets/99f2f7fe-f861-4bc2-8956-067285fd3bea" />
<img width="49%" alt="Screenshot 2" src="https://github.com/user-attachments/assets/732dd48a-47aa-4ac0-9d3b-1695eb371343" />
<img width="49%" alt="Screenshot 3" src="https://github.com/user-attachments/assets/d8b6adba-e5f0-44fb-8264-26b52003095a" />
<img width="49%" alt="Screenshot 4" src="https://github.com/user-attachments/assets/ba55901c-585d-4b85-a86c-762b02340391" />
</p>

## How it works

Your camera uploads an image via FTPS. From there, AddaxAI Connect handles the pipeline automatically:

1. **Ingestion** validates the file, reads GPS and timestamp from the metadata, stores it
2. **Detection** with [MegaDetector v1000 Redwood](https://github.com/agentmorris/MegaDetector) finds animals, people, and vehicles
3. **Classification** identifies the species using [DeepFaune](https://www.deepfaune.cnrs.fr/) or [SpeciesNet](https://github.com/google/speciesnet). Need another model? [Open an issue!](https://github.com/PetervanLunteren/AddaxAI-Connect/issues)
4. **Notifications** via email and Telegram: instant alerts, daily/weekly/monthly reports, battery warnings, etc
5. **Web interface** lets you browse results, view them on a map, check stats, and export data

Each step runs as its own Docker service. They pass messages through Redis queues, store images in MinIO, and share a PostgreSQL database. It supports multiple projects with role-based access control, so different teams can work from the same server. For the full breakdown, see the [architecture](https://petervanlunteren.github.io/AddaxAI-Connect/architecture/).

## Camera compatibility

AddaxAI Connect works with any camera trap that can upload images via FTPS. Each camera model needs a camera profile, a small piece of code that tells the system how to extract the camera ID, GPS coordinates, and timestamp from that model's images. Profiles can pull these from EXIF (Willfine, Swift Enduro) or from the upload directory path (INSTAR).

Adding a new camera usually takes a bit of development and testing. If your camera isn't listed, [open an issue](https://github.com/PetervanLunteren/AddaxAI-Connect/issues) with a few sample images and we'll work it out. See [camera requirements](https://petervanlunteren.github.io/AddaxAI-Connect/camera-requirements/) for the full details and list of supported cameras.

## Getting started

You need an Ubuntu server and a domain name. Deployment is automated with Ansible: fill in a config file, run a command, and you're up and running in about an hour. See the [documentation](https://petervanlunteren.github.io/AddaxAI-Connect/) for camera requirements, step-by-step deployment, and setup instructions.

For contributors: [developer docs](DEVELOPERS.md) and [conventions](CONVENTIONS.md).

## Hardware

The system requires hardware to operate. You will need cameras, SIM cards, and a server. If you need assistance sourcing hardware or setting everything up, visit [plan.addaxai.com](https://plan.addaxai.com).

## License

[MIT](LICENSE)
