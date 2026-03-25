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

**AddaxAI Connect** is an open-source platform that automatically processes camera trap images with machine learning. It picks up images from your cameras via FTPS, figures out what's in them, and shows you everything in a web interface with maps, charts, and notifications. Fully self-hosted on a single server, so your data stays yours. Deploy it, point your cameras at it, and go do something more fun than manually sorting thousands of photos of empty bushes.

A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org). Built on [AddaxAI](https://github.com/PetervanLunteren/addaxai) for the ML backbone.

## What it looks like

Try it yourself: [demo.addaxai.com](https://demo.addaxai.com/login)

<p>
<img width="49%" alt="Screenshot 1" src="https://github.com/user-attachments/assets/99f2f7fe-f861-4bc2-8956-067285fd3bea" />
<img width="49%" alt="Screenshot 2" src="https://github.com/user-attachments/assets/732dd48a-47aa-4ac0-9d3b-1695eb371343" />
<img width="49%" alt="Screenshot 3" src="https://github.com/user-attachments/assets/d8b6adba-e5f0-44fb-8264-26b52003095a" />
<img width="49%" alt="Screenshot 4" src="https://github.com/user-attachments/assets/ba55901c-585d-4b85-a86c-762b02340391" />
<img width="49%" alt="Screenshot 5" src="https://github.com/user-attachments/assets/5aa9a949-027f-4a52-b6b7-c8bacb35a546" />
<img width="49%" alt="Screenshot 6" src="https://github.com/user-attachments/assets/5fac4b00-c5b4-490a-a7aa-67a8b5d60bc7" />
</p>

## How it works

Your camera uploads an image via FTPS. From there, AddaxAI Connect handles the pipeline automatically:

1. **Ingestion** validates the file, reads GPS and timestamp from the metadata, stores it
2. **Detection** with [MegaDetector v1000 Redwood](https://github.com/agentmorris/MegaDetector) finds animals, people, and vehicles
3. **Classification** identifies the species using [DeepFaune](https://www.deepfaune.cnrs.fr/) or [SpeciesNet](https://github.com/google/speciesnet). Need another model? [Open an issue!](https://github.com/PetervanLunteren/AddaxAI-Connect/issues)
4. **Notifications** via email and Telegram: instant alerts, daily/weekly/monthly reports, battery warnings, etc
5. **Web interface** lets you browse results, view them on a map, check stats, and export data

Each step runs as its own Docker service. They pass messages through Redis queues, store images in MinIO, and share a PostgreSQL database. It supports multiple projects with role-based access control, so different teams can work from the same server. For the full breakdown, see its [architecture](docs/architecture.md).

## Getting started

You need an Ubuntu server and a domain name. Deployment is automated with Ansible: fill in a config file, run a command, and you're up and running in about an hour.

**[Deployment guide](docs/deployment.md)**

## Documentation

| Document | Description |
|---|---|
| [Deployment guide](docs/deployment.md) | Step-by-step server setup and configuration |
| [Setup guide](docs/setup-guide.md) | First login, projects, cameras, and inviting users |
| [Update guide](docs/update-guide.md) | Safely updating a running server |
| [Architecture](docs/architecture.md) | Technology stack, data flow, and security model |
| [Developer docs](DEVELOPERS.md) | Repo structure, logging, tests, and conventions |
| [Data formats](docs/data-formats.md) | EXIF metadata, daily reports, and file naming |
| [Conventions](CONVENTIONS.md) | Code style and repo guidelines |

## License

[MIT](LICENSE)
