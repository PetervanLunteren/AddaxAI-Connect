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

</div>

<br>

Your camera traps take the photos. Connect does the rest.

**AddaxAI Connect** is an open-source platform that automatically processes camera trap images with machine learning. It picks up images from your cameras via FTPS, figures out what's in them, and shows you everything in a web interface with maps, charts, and notifications. Deploy it on a single server, point your cameras at it, and go do something more fun than manually sorting thousands of photos of empty bushes.

A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org). Built on [AddaxAI](https://github.com/PetervanLunteren/addaxai) for the ML backbone.

## What it looks like

<!-- Add screenshots to docs/images/ and update the paths below -->

| ![Gallery view](docs/images/screenshot-gallery.png) | ![Map view](docs/images/screenshot-map.png) |
|:---:|:---:|
| Browse and filter your images | See where your cameras are |

| ![Image detail](docs/images/screenshot-detail.png) | ![Dashboard](docs/images/screenshot-dashboard.png) |
|:---:|:---:|
| Detections with bounding boxes | Stats at a glance |

## How it works

Your camera uploads an image via FTPS. From there, Connect handles the pipeline automatically:

1. **Ingestion** validates the file, reads GPS and timestamp from the metadata, stores it
2. **Detection** with [MegaDetector](https://github.com/PetervanLunteren/MegaDetector) finds animals, people, and vehicles
3. **Classification** identifies the species using [DeepFaune](https://www.deepfaune.cnrs.fr/) or [SpeciesNet](https://github.com/google/speciesnet)
4. **Notifications** sends you an email, Telegram message, or adds it to your report
5. **Web interface** lets you browse results, view them on a map, check stats, and export data

Each step runs as its own Docker service. They pass messages through Redis queues, store images in MinIO, and share a PostgreSQL database. For the full breakdown, see [architecture](docs/architecture.md).

## Features

- **Automatic processing** from camera to classified result without lifting a finger
- **Two classification models** to choose from: DeepFaune (38 European species) or SpeciesNet (2,498 species worldwide)
- **Web interface** with image gallery, filters, interactive map, and statistics dashboard
- **Notifications** via email and Telegram: instant alerts, daily/weekly/monthly reports, battery warnings
- **Multi-project support** for managing separate camera trap projects from one server
- **User roles** with server admins, project admins, and viewers, each with per-project access control
- **Fully self-hosted** on a single Ubuntu server. Your data stays yours.

## Getting started

You need an Ubuntu server (24.04, 8 GB RAM minimum), a domain name, and about 30 minutes. Deployment is automated with Ansible: fill in a config file, run one command, and it handles the rest.

**[Deployment guide](docs/deployment.md)**

## Documentation

| Document | Description |
|---|---|
| [Deployment guide](docs/deployment.md) | Step-by-step server setup and configuration |
| [Update guide](docs/update-guide.md) | Safely updating a running server |
| [Architecture](docs/architecture.md) | Technology stack, data flow, and security model |
| [Developer docs](DEVELOPERS.md) | Repo structure, logging, tests, and conventions |
| [Data formats](docs/data-formats.md) | EXIF metadata, daily reports, and file naming |
| [Conventions](CONVENTIONS.md) | Code style and repo guidelines |

## License

[MIT](LICENSE)
