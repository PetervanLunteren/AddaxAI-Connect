"""
Export endpoints for project data.

Supports:
- CamTrap DP: Camera Trap Data Package (https://camtrap-dp.tdwg.org/) as a ZIP file
- Observations: CSV, TSV, or XLSX spreadsheet for analysis in Excel or R
- Spatial: GeoJSON, Shapefile, or GeoPackage for GIS tools
"""
from typing import List, Dict, Optional, Any
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import csv
import io
import json
import re
import sqlite3
import struct
import uuid
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, text
from sqlalchemy.orm import selectinload

from shared.models import (
    User, Image, Camera, Detection, Classification, Project,
    HumanObservation, CameraDeploymentPeriod, SpeciesTaxonomy,
    ServerSettings,
)
from shared.database import get_async_session
from shared.storage import StorageClient, BUCKET_THUMBNAILS
from shared.logger import get_logger
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids

router = APIRouter(prefix="/api/projects/{project_id}/export", tags=["export"])
logger = get_logger("api.export")

CAMTRAP_DP_VERSION = "1.0"
CAMTRAP_DP_PROFILE = f"https://raw.githubusercontent.com/tdwg/camtrap-dp/{CAMTRAP_DP_VERSION}/camtrap-dp-profile.json"
DEPLOYMENTS_SCHEMA = f"https://raw.githubusercontent.com/tdwg/camtrap-dp/{CAMTRAP_DP_VERSION}/deployments-table-schema.json"
MEDIA_SCHEMA = f"https://raw.githubusercontent.com/tdwg/camtrap-dp/{CAMTRAP_DP_VERSION}/media-table-schema.json"
OBSERVATIONS_SCHEMA = f"https://raw.githubusercontent.com/tdwg/camtrap-dp/{CAMTRAP_DP_VERSION}/observations-table-schema.json"


def _parse_timestamp(image: Image, tz: ZoneInfo) -> Optional[datetime]:
    """
    Parse image capture timestamp from EXIF metadata.

    Falls back to uploaded_at if DateTimeOriginal is missing.
    """
    dto = None
    if image.image_metadata and image.image_metadata.get("DateTimeOriginal"):
        raw = image.image_metadata["DateTimeOriginal"]
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                dto = datetime.strptime(raw, fmt)
                break
            except ValueError:
                continue

    if dto is None and image.uploaded_at:
        # uploaded_at is timezone-aware (UTC); convert to target tz
        return image.uploaded_at.astimezone(tz)

    if dto is None:
        return None

    # Localize naive datetime to project timezone
    return dto.replace(tzinfo=tz)


def _format_dt(dt: Optional[datetime]) -> str:
    """Format datetime as ISO 8601 with timezone offset."""
    if dt is None:
        return ""
    return dt.isoformat()


def _format_date_as_dt(d: Optional[date], tz: ZoneInfo) -> str:
    """Format a date as a datetime at midnight in the given timezone."""
    if d is None:
        return ""
    dt = datetime(d.year, d.month, d.day, tzinfo=tz)
    return dt.isoformat()


def _slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    return text


def _find_deployment_id(
    camera_id: int,
    capture_date: Optional[date],
    deployments_by_camera: Dict[int, list],
) -> Optional[str]:
    """
    Match an image to a deployment period by camera_id and capture date.

    Returns the deployment ID string (e.g., "dep-13-1") or None if no match.
    """
    if capture_date is None:
        return None

    periods = deployments_by_camera.get(camera_id, [])
    for cdp in periods:
        start = cdp["start_date"]
        end = cdp["end_date"] or date.today()
        if start <= capture_date <= end:
            return cdp["deployment_id_str"]

    return None


def _build_deployments_csv(deployments: list, tz: ZoneInfo) -> str:
    """Build deployments.csv content."""
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "deploymentID", "latitude", "longitude",
        "deploymentStart", "deploymentEnd",
        "cameraID", "cameraModel",
    ]
    writer.writerow(headers)

    for dep in deployments:
        camera_model = ""
        if dep["manufacturer"] and dep["model"]:
            camera_model = f"{dep['manufacturer']}-{dep['model']}"
        elif dep["manufacturer"]:
            camera_model = dep["manufacturer"]
        elif dep["model"]:
            camera_model = dep["model"]

        writer.writerow([
            dep["deployment_id_str"],
            dep["latitude"],
            dep["longitude"],
            _format_date_as_dt(dep["start_date"], tz),
            _format_date_as_dt(dep["end_date"] or date.today(), tz),
            dep["camera_identifier"],
            camera_model,
        ])

    return output.getvalue()


def _build_media_csv(
    images: list,
    deployments_by_camera: Dict[int, list],
    camera_identifiers: Dict[int, str],
    tz: ZoneInfo,
    include_media: bool,
) -> tuple[str, list]:
    """
    Build media.csv content and return (csv_string, media_entries).

    media_entries is a list of dicts with keys needed for observations and thumbnail download.
    Filenames are prefixed with {cameraID}_ to avoid collisions across cameras.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "mediaID", "deploymentID", "captureMethod", "timestamp",
        "filePath", "filePublic", "fileMediatype",
    ]
    writer.writerow(headers)

    media_entries = []
    for image in images:
        ts = _parse_timestamp(image, tz)
        capture_date = ts.date() if ts else None
        dep_id = _find_deployment_id(image.camera_id, capture_date, deployments_by_camera)

        if dep_id is None:
            logger.warning(
                "Image has no matching deployment period, skipping from export",
                image_uuid=image.uuid,
                camera_id=image.camera_id,
            )
            continue

        cam_id = camera_identifiers.get(image.camera_id, str(image.camera_id))
        short_uuid = image.uuid.split("-")[0]  # first 8 chars of UUID
        name, ext = image.filename.rsplit(".", 1) if "." in image.filename else (image.filename, "")
        unique_filename = f"{cam_id}_{name}_{short_uuid}.{ext}" if ext else f"{cam_id}_{name}_{short_uuid}"
        file_path = f"media/{unique_filename}" if include_media else unique_filename

        writer.writerow([
            image.uuid,
            dep_id,
            "activityDetection",
            _format_dt(ts),
            file_path,
            "false",
            "image/jpeg",
        ])

        media_entries.append({
            "image": image,
            "deployment_id": dep_id,
            "timestamp": ts,
            "unique_filename": unique_filename,
        })

    return output.getvalue(), media_entries


def _build_observations_csv(
    media_entries: list,
    taxonomy_lookup: Dict[str, dict],
    detection_threshold: float,
    tz: ZoneInfo,
) -> tuple[str, set]:
    """
    Build observations.csv content.

    Returns (csv_string, observed_species_set) where observed_species_set
    contains common_name strings of all species in the export.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "observationID", "deploymentID", "mediaID",
        "eventID", "eventStart", "eventEnd",
        "observationLevel", "observationType",
        "scientificName", "count",
        "classificationMethod", "classifiedBy", "classificationProbability",
        "bboxX", "bboxY", "bboxWidth", "bboxHeight",
        "observationComments",
    ]
    writer.writerow(headers)

    observed_species = set()

    for entry in media_entries:
        image = entry["image"]
        dep_id = entry["deployment_id"]
        ts_str = _format_dt(entry["timestamp"])
        has_observations = False

        if image.is_verified:
            # Human observations for verified images
            for ho in image.human_observations:
                has_observations = True
                observed_species.add(ho.species)
                sci_name = ""
                tax = taxonomy_lookup.get(ho.species)
                if tax and tax["scientific_name"]:
                    sci_name = tax["scientific_name"]
                else:
                    # Fall back to common name if no mapping exists
                    sci_name = ho.species

                writer.writerow([
                    f"obs-human-{ho.id}",
                    dep_id,
                    image.uuid,
                    image.uuid,  # eventID = group by image
                    ts_str,
                    ts_str,
                    "media",
                    "animal",
                    sci_name,
                    ho.count,
                    "human",
                    "",  # classifiedBy - user privacy
                    "",  # classificationProbability
                    "", "", "", "",  # bbox
                    "Human identification",
                ])
        else:
            # AI detections for unverified images
            for detection in image.detections:
                if detection.confidence < detection_threshold:
                    continue

                # Map detection category to CamTrap DP observationType
                obs_type = "unknown"
                if detection.category == "animal":
                    obs_type = "animal"
                elif detection.category == "person":
                    obs_type = "human"
                elif detection.category == "vehicle":
                    obs_type = "vehicle"

                # Get species and bbox for animal detections
                sci_name = ""
                class_confidence = ""
                classified_by = "MegaDetector v1000"
                species_name = ""

                if detection.category == "animal" and detection.classifications:
                    classification = detection.classifications[0]
                    species_name = classification.species
                    observed_species.add(species_name)
                    class_confidence = str(round(classification.confidence, 6))
                    classified_by = "MegaDetector v1000 + DeepFaune v1.4"

                    tax = taxonomy_lookup.get(species_name)
                    if tax and tax["scientific_name"]:
                        sci_name = tax["scientific_name"]
                    else:
                        sci_name = species_name

                # Extract normalized bounding box (already in 0-1 range)
                bbox_x = bbox_y = bbox_w = bbox_h = ""
                normalized = detection.bbox.get("normalized") if detection.bbox else None
                if normalized and len(normalized) == 4:
                    bbox_x = str(round(normalized[0], 6))
                    bbox_y = str(round(normalized[1], 6))
                    bbox_w = str(round(normalized[2], 6))
                    bbox_h = str(round(normalized[3], 6))

                has_observations = True
                observation_comments = f"{classified_by}, not reviewed"
                writer.writerow([
                    f"obs-ai-{detection.id}",
                    dep_id,
                    image.uuid,
                    image.uuid,
                    ts_str,
                    ts_str,
                    "media",
                    obs_type,
                    sci_name,
                    1,  # count = 1 per detection
                    "machine",
                    classified_by,
                    class_confidence,
                    bbox_x, bbox_y, bbox_w, bbox_h,
                    observation_comments,
                ])

        # Blank observation for images with no detections/observations
        if not has_observations:
            if image.is_verified:
                blank_method = "human"
                blank_comments = "Human identification"
            else:
                blank_method = "machine"
                blank_comments = "MegaDetector v1000, not reviewed"

            writer.writerow([
                f"obs-blank-{image.uuid}",
                dep_id,
                image.uuid,
                image.uuid,
                ts_str,
                ts_str,
                "media",
                "blank",
                "", "",  # scientificName, count
                blank_method, "", "",  # classificationMethod, classifiedBy, classificationProbability
                "", "", "", "",  # bbox
                blank_comments,
            ])

    return output.getvalue(), observed_species


def _build_datapackage_json(
    project: Project,
    deployments: list,
    media_entries: list,
    observed_species: set,
    taxonomy_lookup: Dict[str, dict],
    tz: ZoneInfo,
) -> str:
    """Build datapackage.json content."""
    # Compute spatial bounding box from deployment locations
    lats = [d["latitude"] for d in deployments if d["latitude"] is not None]
    lons = [d["longitude"] for d in deployments if d["longitude"] is not None]

    spatial = {}
    if lats and lons:
        min_lat, max_lat = min(lats), max(lats)
        min_lon, max_lon = min(lons), max(lons)
        spatial = {
            "type": "Polygon",
            "bbox": [min_lon, min_lat, max_lon, max_lat],
            "coordinates": [[
                [min_lon, min_lat],
                [max_lon, min_lat],
                [max_lon, max_lat],
                [min_lon, max_lat],
                [min_lon, min_lat],
            ]],
        }

    # Compute temporal range
    dep_starts = [d["start_date"] for d in deployments if d["start_date"]]
    timestamps = [e["timestamp"] for e in media_entries if e["timestamp"]]

    temporal = {}
    if dep_starts:
        temporal["start"] = str(min(dep_starts))
    if timestamps:
        temporal["end"] = str(max(ts.date() for ts in timestamps))
    elif dep_starts:
        dep_ends = [d["end_date"] for d in deployments if d["end_date"]]
        if dep_ends:
            temporal["end"] = str(max(dep_ends))

    # Build taxonomic list from observed species
    taxonomic = []
    for common_name in sorted(observed_species):
        tax = taxonomy_lookup.get(common_name, {})
        entry = {}
        if tax.get("scientific_name"):
            entry["scientificName"] = tax["scientific_name"]
        else:
            entry["scientificName"] = common_name
        if tax.get("taxon_rank"):
            entry["taxonRank"] = tax["taxon_rank"]
        entry["vernacularNames"] = {"en": common_name.replace("_", " ")}
        taxonomic.append(entry)

    package = {
        "profile": CAMTRAP_DP_PROFILE,
        "name": f"addaxai-{_slugify(project.name)}",
        "id": str(uuid.uuid4()),
        "created": datetime.now(tz=ZoneInfo("UTC")).isoformat(),
        "title": project.name,
        "description": project.description or "",
        "version": "1.0.0",
        "contributors": [
            {"title": "AddaxAI Connect", "role": "publisher"},
        ],
        "licenses": [
            {"name": "CC-BY-4.0", "scope": "data"},
            {"name": "CC-BY-4.0", "scope": "media"},
        ],
        "project": {
            "id": str(project.id),
            "title": project.name,
            "samplingDesign": "opportunistic",
            "captureMethod": ["activityDetection"],
            "individualAnimals": False,
            "observationLevel": ["media"],
        },
        "spatial": spatial,
        "temporal": temporal,
        "taxonomic": taxonomic,
        "resources": [
            {
                "name": "deployments",
                "path": "deployments.csv",
                "profile": "tabular-data-resource",
                "format": "csv",
                "mediatype": "text/csv",
                "encoding": "utf-8",
                "schema": DEPLOYMENTS_SCHEMA,
            },
            {
                "name": "media",
                "path": "media.csv",
                "profile": "tabular-data-resource",
                "format": "csv",
                "mediatype": "text/csv",
                "encoding": "utf-8",
                "schema": MEDIA_SCHEMA,
            },
            {
                "name": "observations",
                "path": "observations.csv",
                "profile": "tabular-data-resource",
                "format": "csv",
                "mediatype": "text/csv",
                "encoding": "utf-8",
                "schema": OBSERVATIONS_SCHEMA,
            },
        ],
    }

    return json.dumps(package, indent=2, ensure_ascii=False)


@router.get("/camtrap-dp")
async def export_camtrap_dp(
    project_id: int,
    include_media: bool = Query(True, description="Include thumbnail images in the ZIP"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
) -> StreamingResponse:
    """
    Export project data as a CamTrap DP package (ZIP file).

    The package follows the Camera Trap Data Package standard v1.0
    (https://camtrap-dp.tdwg.org/) and contains:
    - datapackage.json: package metadata
    - deployments.csv: camera deployment periods
    - media.csv: image metadata
    - observations.csv: species observations (AI + human + blank)
    - media/ folder: thumbnail images (when include_media=true)
    """
    # Verify project access
    if project_id not in accessible_project_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    # Load project
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    from routers.admin import get_server_timezone
    server_tz = await get_server_timezone(db)
    tz = ZoneInfo(server_tz)

    # Load species taxonomy lookup
    tax_result = await db.execute(select(SpeciesTaxonomy))
    taxonomy_rows = tax_result.scalars().all()
    taxonomy_lookup = {
        t.common_name: {
            "scientific_name": t.scientific_name,
            "taxon_rank": t.taxon_rank,
        }
        for t in taxonomy_rows
    }

    # Load deployment periods with camera info via raw SQL for PostGIS extraction
    dep_query = text("""
        SELECT
            cdp.id, cdp.camera_id, cdp.deployment_id, cdp.start_date, cdp.end_date,
            ST_Y(cdp.location::geometry) as latitude,
            ST_X(cdp.location::geometry) as longitude,
            c.name as camera_name, c.serial_number, c.imei,
            c.manufacturer, c.model as camera_model
        FROM camera_deployment_periods cdp
        JOIN cameras c ON cdp.camera_id = c.id
        WHERE c.project_id = :project_id
        ORDER BY cdp.camera_id, cdp.deployment_id
    """)
    dep_result = await db.execute(dep_query, {"project_id": project_id})
    dep_rows = dep_result.mappings().all()

    if not dep_rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No deployment periods found for this project. CamTrap DP requires at least one camera deployment.",
        )

    # Build deployment data structures
    deployments = []
    deployments_by_camera: Dict[int, list] = {}

    for row in dep_rows:
        camera_identifier = row["serial_number"] or row["imei"] or row["camera_name"]
        dep_data = {
            "deployment_id_str": f"dep-{row['camera_id']}-{row['deployment_id']}",
            "camera_id": row["camera_id"],
            "latitude": float(row["latitude"]) if row["latitude"] is not None else None,
            "longitude": float(row["longitude"]) if row["longitude"] is not None else None,
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "camera_identifier": camera_identifier,
            "manufacturer": row["manufacturer"] or "",
            "model": row["camera_model"] or "",
        }
        deployments.append(dep_data)

        if row["camera_id"] not in deployments_by_camera:
            deployments_by_camera[row["camera_id"]] = []
        deployments_by_camera[row["camera_id"]].append(dep_data)

    # Load all classified images for this project with related data
    images_query = (
        select(Image)
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Image.status == "classified",
            )
        )
        .options(
            selectinload(Image.detections).selectinload(Detection.classifications),
            selectinload(Image.human_observations),
        )
        .order_by(Image.uploaded_at)
    )
    images_result = await db.execute(images_query)
    images = images_result.scalars().unique().all()

    logger.info(
        "Starting CamTrap DP export",
        project_id=project_id,
        num_deployments=len(deployments),
        num_images=len(images),
        include_media=include_media,
    )

    # Build camera_id -> camera identifier lookup for unique filenames
    camera_identifiers: Dict[int, str] = {}
    for cam_id, cam_deps in deployments_by_camera.items():
        camera_identifiers[cam_id] = cam_deps[0]["camera_identifier"]

    # Build CSV contents
    deployments_csv = _build_deployments_csv(deployments, tz)
    media_csv, media_entries = _build_media_csv(
        images, deployments_by_camera, camera_identifiers, tz, include_media,
    )
    observations_csv, observed_species = _build_observations_csv(
        media_entries, taxonomy_lookup, project.detection_threshold, tz,
    )
    datapackage_json = _build_datapackage_json(
        project, deployments, media_entries, observed_species, taxonomy_lookup, tz,
    )

    # Assemble ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("datapackage.json", datapackage_json)
        zf.writestr("deployments.csv", deployments_csv)
        zf.writestr("media.csv", media_csv)
        zf.writestr("observations.csv", observations_csv)

        # Add thumbnails if requested
        if include_media:
            from utils.image_processing import apply_privacy_blur

            storage_client = StorageClient()
            for entry in media_entries:
                image = entry["image"]
                if not image.thumbnail_path:
                    continue
                try:
                    thumb_data = storage_client.download_fileobj(BUCKET_THUMBNAILS, image.thumbnail_path)

                    # Apply privacy blur to person/vehicle detections
                    if project.blur_people_vehicles:
                        blur_regions = [
                            d.bbox for d in image.detections
                            if d.category in ("person", "vehicle")
                            and d.confidence >= project.detection_threshold
                        ]
                        thumb_data = apply_privacy_blur(thumb_data, blur_regions)

                    zf.writestr(f"media/{entry['unique_filename']}", thumb_data)
                except Exception as e:
                    logger.warning(
                        "Failed to download thumbnail, skipping",
                        image_uuid=image.uuid,
                        thumbnail_path=image.thumbnail_path,
                        error=str(e),
                    )

    zip_buffer.seek(0)

    today = date.today().isoformat()
    filename = f"camtrap-dp-{_slugify(project.name)}-{today}.zip"

    logger.info(
        "CamTrap DP export complete",
        project_id=project_id,
        num_media=len(media_entries),
        num_species=len(observed_species),
        zip_size_mb=round(zip_buffer.getbuffer().nbytes / 1024 / 1024, 2),
    )

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------


def _build_observation_rows(
    images: list,
    camera_names: Dict[int, str],
    taxonomy_lookup: Dict[str, dict],
    detection_threshold: float,
    tz: ZoneInfo,
) -> tuple:
    """
    Build observation data as (headers, rows) for export in any tabular format.

    One row per species per image, grouped by species (animals) or category
    (person/vehicle). Blank images get a single row with species="blank".
    """
    headers = [
        "image_uuid", "filename", "datetime", "camera_name",
        "latitude", "longitude",
        "species", "scientific_name", "count", "max_confidence",
        "classification_method", "observation_comments", "is_verified",
    ]
    rows = []

    for image in images:
        ts = _parse_timestamp(image, tz)
        ts_str = _format_dt(ts)
        camera_name = camera_names.get(image.camera_id, "")

        # Extract GPS from image EXIF metadata
        lat, lon = "", ""
        gps = image.image_metadata.get("gps_decimal") if image.image_metadata else None
        if gps and len(gps) == 2:
            lat, lon = gps[0], gps[1]

        is_verified = "TRUE" if image.is_verified else "FALSE"
        has_observations = False

        if image.is_verified:
            for ho in image.human_observations:
                has_observations = True
                tax = taxonomy_lookup.get(ho.species, {})
                sci_name = tax.get("scientific_name") or ho.species

                rows.append([
                    image.uuid, image.filename, ts_str, camera_name,
                    lat, lon,
                    ho.species, sci_name, ho.count, "",
                    "human", "Human identification", is_verified,
                ])
        else:
            groups: Dict[str, Dict[str, Any]] = {}

            for det in image.detections:
                if det.confidence < detection_threshold:
                    continue

                if det.category == "animal" and det.classifications:
                    species = det.classifications[0].species
                    confidence = det.classifications[0].confidence
                    classified_by = "MegaDetector v1000 + DeepFaune v1.4"
                else:
                    species = det.category
                    confidence = det.confidence
                    classified_by = "MegaDetector v1000"

                if species not in groups:
                    groups[species] = {"count": 0, "max_confidence": 0.0, "classified_by": classified_by}
                groups[species]["count"] += 1
                groups[species]["max_confidence"] = max(groups[species]["max_confidence"], confidence)

            for species, data in groups.items():
                has_observations = True
                tax = taxonomy_lookup.get(species, {})
                sci_name = tax.get("scientific_name") or ""

                rows.append([
                    image.uuid, image.filename, ts_str, camera_name,
                    lat, lon,
                    species, sci_name, data["count"],
                    round(data["max_confidence"], 6),
                    "machine", f"{data['classified_by']}, not reviewed", is_verified,
                ])

        if not has_observations:
            if image.is_verified:
                blank_method = "human"
                blank_comments = "Human identification"
            else:
                blank_method = "machine"
                blank_comments = "MegaDetector v1000, not reviewed"

            rows.append([
                image.uuid, image.filename, ts_str, camera_name,
                lat, lon,
                "blank", "", "", "",
                blank_method, blank_comments, is_verified,
            ])

    return headers, rows


def _serialize_csv(headers: list, rows: list) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


def _serialize_tsv(headers: list, rows: list) -> str:
    output = io.StringIO()
    writer = csv.writer(output, delimiter="\t")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


def _serialize_xlsx(headers: list, rows: list) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Observations"
    ws.append(headers)
    for row in rows:
        ws.append(row)
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


@router.get("/observations")
async def export_observations(
    project_id: int,
    format: str = Query("csv", pattern="^(csv|tsv|xlsx)$"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
) -> StreamingResponse:
    """
    Export project observations as CSV, TSV, or XLSX.

    One row per species per image, grouped by species (animals) or category
    (person/vehicle). Includes blank images, applies detection threshold.
    """
    if project_id not in accessible_project_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    from routers.admin import get_server_timezone
    server_tz = await get_server_timezone(db)
    tz = ZoneInfo(server_tz)

    tax_result = await db.execute(select(SpeciesTaxonomy))
    taxonomy_rows = tax_result.scalars().all()
    taxonomy_lookup = {
        t.common_name: {
            "scientific_name": t.scientific_name,
            "taxon_rank": t.taxon_rank,
        }
        for t in taxonomy_rows
    }

    cam_result = await db.execute(
        select(Camera.id, Camera.name).where(Camera.project_id == project_id)
    )
    camera_names = {row.id: row.name for row in cam_result.all()}

    images_query = (
        select(Image)
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Image.status == "classified",
            )
        )
        .options(
            selectinload(Image.detections).selectinload(Detection.classifications),
            selectinload(Image.human_observations),
        )
        .order_by(Image.uploaded_at)
    )
    images_result = await db.execute(images_query)
    images = images_result.scalars().unique().all()

    logger.info(
        "Starting observations export",
        project_id=project_id,
        format=format,
        num_images=len(images),
    )

    headers, rows = _build_observation_rows(
        images, camera_names, taxonomy_lookup, project.detection_threshold, tz,
    )

    today = date.today().isoformat()
    slug = _slugify(project.name)

    if format == "xlsx":
        content = _serialize_xlsx(headers, rows)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="observations-{slug}-{today}.xlsx"'},
        )
    elif format == "tsv":
        content = _serialize_tsv(headers, rows)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="text/tab-separated-values",
            headers={"Content-Disposition": f'attachment; filename="observations-{slug}-{today}.tsv"'},
        )
    else:
        content = _serialize_csv(headers, rows)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="observations-{slug}-{today}.csv"'},
        )


# ---------------------------------------------------------------------------
# Spatial export (GeoJSON, Shapefile, GeoPackage)
# ---------------------------------------------------------------------------


def _build_spatial_layers(
    images: list,
    camera_names: Dict[int, str],
    taxonomy_lookup: Dict[str, dict],
    detection_threshold: float,
    tz: ZoneInfo,
    deployment_rows: list,
) -> Dict[str, list]:
    """
    Build three spatial layers from project data.

    Returns a dict with keys "deployments", "observations", and
    "species_summary".  Each value is a list of feature dicts with
    "lon", "lat", and "properties" keys.
    """
    from collections import defaultdict

    # --- Deployments layer: one feature per deployment row ---
    deployments = []
    for row in deployment_rows:
        deployments.append({
            "lon": float(row.lon) if row.lon is not None else 0.0,
            "lat": float(row.lat) if row.lat is not None else 0.0,
            "properties": {
                "camera_name": row.camera_name,
                "deployment_id": row.deployment_number,
                "start_date": row.start_date.isoformat() if row.start_date else "",
                "end_date": row.end_date.isoformat() if row.end_date else "",
                "trap_days": row.trap_days,
                "detection_count": row.detection_count,
                "detection_rate_per_100": round(float(row.detection_rate_per_100), 2),
            },
        })

    # --- Observations layer ---
    headers, rows = _build_observation_rows(
        images, camera_names, taxonomy_lookup, detection_threshold, tz,
    )

    # Build GPS lookup from image objects (reliable float values)
    gps_lookup: Dict[str, tuple] = {}
    for image in images:
        gps = image.image_metadata.get("gps_decimal") if image.image_metadata else None
        if gps and len(gps) == 2:
            try:
                lat_f = float(gps[0])
                lon_f = float(gps[1])
                gps_lookup[image.uuid] = (lat_f, lon_f)
            except (ValueError, TypeError):
                pass

    observations = []
    for row in rows:
        image_uuid = row[0]
        coords = gps_lookup.get(image_uuid)
        if coords is None:
            continue
        lat_val, lon_val = coords
        if lat_val == 0.0 and lon_val == 0.0:
            continue

        observations.append({
            "lon": lon_val,
            "lat": lat_val,
            "properties": {
                "image_uuid": row[0],
                "filename": row[1],
                "datetime": row[2],
                "camera_name": row[3],
                "species": row[6],
                "scientific_name": row[7],
                "count": row[8],
                "max_confidence": row[9],
                "classification_method": row[10],
                "observation_comments": row[11],
                "is_verified": row[12],
            },
        })

    # --- Species summary layer ---
    # Aggregate observations by (camera_name, species)
    camera_species: Dict[tuple, Dict[str, Any]] = defaultdict(lambda: {
        "scientific_name": "",
        "total_count": 0,
    })
    for feat in observations:
        props = feat["properties"]
        key = (props["camera_name"], props["species"])
        camera_species[key]["scientific_name"] = props["scientific_name"]
        count_val = props["count"]
        try:
            camera_species[key]["total_count"] += int(count_val)
        except (ValueError, TypeError):
            pass

    # Find the most recent deployment per camera for location
    camera_latest_deployment: Dict[str, Any] = {}
    camera_total_trap_days: Dict[str, int] = defaultdict(int)
    for row in deployment_rows:
        cam = row.camera_name
        camera_total_trap_days[cam] += int(row.trap_days) if row.trap_days else 0
        existing = camera_latest_deployment.get(cam)
        if existing is None or (row.start_date and (existing["start_date"] is None or row.start_date > existing["start_date"])):
            camera_latest_deployment[cam] = {
                "start_date": row.start_date,
                "lon": float(row.lon) if row.lon is not None else 0.0,
                "lat": float(row.lat) if row.lat is not None else 0.0,
            }

    species_summary = []
    for (camera_name, species), data in camera_species.items():
        dep_info = camera_latest_deployment.get(camera_name)
        if dep_info is None:
            continue
        total_trap = camera_total_trap_days.get(camera_name, 0)
        rate = (data["total_count"] / total_trap * 100) if total_trap > 0 else 0.0

        species_summary.append({
            "lon": dep_info["lon"],
            "lat": dep_info["lat"],
            "properties": {
                "camera_name": camera_name,
                "species": species,
                "scientific_name": data["scientific_name"],
                "total_count": data["total_count"],
                "detection_rate_per_100": round(rate, 2),
            },
        })

    return {
        "deployments": deployments,
        "observations": observations,
        "species_summary": species_summary,
    }


def _serialize_spatial_geojson(layers: Dict[str, list]) -> str:
    """Serialize spatial layers as a single GeoJSON FeatureCollection.

    Each feature has a "layer" property to distinguish deployments,
    observations, and species_summary.
    """
    all_features = []
    for layer_name, features in layers.items():
        for feat in features:
            props = dict(feat["properties"])
            props["layer"] = layer_name
            all_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [feat["lon"], feat["lat"]],
                },
                "properties": props,
            })
    return json.dumps({
        "type": "FeatureCollection",
        "features": all_features,
    }, indent=2)


def _serialize_spatial_shapefile(layers: Dict[str, list]) -> bytes:
    """
    Serialize spatial layers as a ZIP containing three shapefiles.

    Uses pyshp (imported as ``shapefile``) to write .shp/.shx/.dbf
    buffers and adds a .prj file for WGS84.
    """
    import shapefile

    WGS84_PRJ = (
        'GEOGCS["GCS_WGS_1984",'
        'DATUM["D_WGS_1984",'
        'SPHEROID["WGS_1984",6378137.0,298.257223563]],'
        'PRIMEM["Greenwich",0.0],'
        'UNIT["Degree",0.0174532925199433]]'
    )

    # Field definitions per layer.
    # Each entry: (short_name, field_type, size, decimal)
    layer_fields = {
        "deployments": [
            ("cam_name",  "C", 80,  0),
            ("deploy_id", "N", 10,  0),
            ("start_date","C", 10,  0),
            ("end_date",  "C", 10,  0),
            ("trap_days", "N", 10,  0),
            ("det_count", "N", 10,  0),
            ("det_rate",  "N", 10,  2),
        ],
        "observations": [
            ("img_uuid",  "C", 36,  0),
            ("filename",  "C", 100, 0),
            ("datetime",  "C", 25,  0),
            ("cam_name",  "C", 80,  0),
            ("species",   "C", 80,  0),
            ("sci_name",  "C", 100, 0),
            ("count",     "C", 10,  0),
            ("max_conf",  "C", 10,  0),
            ("class_meth","C", 10,  0),
            ("obs_cmnt",  "C", 100, 0),
            ("is_verif",  "C", 5,   0),
        ],
        "species_summary": [
            ("cam_name",  "C", 80,  0),
            ("species",   "C", 80,  0),
            ("sci_name",  "C", 100, 0),
            ("total_cnt", "N", 10,  0),
            ("det_rate",  "N", 10,  2),
        ],
    }

    # Map from full property names to short field names, per layer
    property_keys = {
        "deployments": [
            "camera_name", "deployment_id", "start_date", "end_date",
            "trap_days", "detection_count", "detection_rate_per_100",
        ],
        "observations": [
            "image_uuid", "filename", "datetime", "camera_name",
            "species", "scientific_name", "count", "max_confidence",
            "classification_method", "observation_comments", "is_verified",
        ],
        "species_summary": [
            "camera_name", "species", "scientific_name",
            "total_count", "detection_rate_per_100",
        ],
    }

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for layer_name, features in layers.items():
            shp_buf = io.BytesIO()
            shx_buf = io.BytesIO()
            dbf_buf = io.BytesIO()
            w = shapefile.Writer(shp=shp_buf, shx=shx_buf, dbf=dbf_buf)
            w.shapeType = shapefile.POINT

            for fname, ftype, fsize, fdecimal in layer_fields[layer_name]:
                w.field(fname, ftype, size=fsize, decimal=fdecimal)

            keys = property_keys[layer_name]
            for feat in features:
                w.point(feat["lon"], feat["lat"])
                record_values = [feat["properties"].get(k, "") for k in keys]
                # Ensure values are the right type for numeric fields
                coerced = []
                for val, (_, ftype, _, _) in zip(record_values, layer_fields[layer_name]):
                    if ftype == "N" and val == "":
                        coerced.append(0)
                    else:
                        coerced.append(val)
                w.record(*coerced)

            w.close()

            zf.writestr(f"{layer_name}.shp", shp_buf.getvalue())
            zf.writestr(f"{layer_name}.shx", shx_buf.getvalue())
            zf.writestr(f"{layer_name}.dbf", dbf_buf.getvalue())
            zf.writestr(f"{layer_name}.prj", WGS84_PRJ)

    return zip_buf.getvalue()


def _make_gpkg_point(lon: float, lat: float) -> bytes:
    """
    Build a GeoPackage binary geometry for a Point (EPSG:4326).

    Layout (29 bytes total):
      - 'GP' magic (2 bytes)
      - version 0 (1 byte)
      - flags 1 = little-endian, no envelope (1 byte)
      - SRID 4326 (4 bytes, int32 LE)
      - WKB Point: byte-order 1, type 1, X=lon, Y=lat
    """
    header = b'GP' + struct.pack('<BBi', 0, 1, 4326)
    wkb = struct.pack('<BI2d', 1, 1, lon, lat)
    return header + wkb


def _serialize_spatial_geopackage(layers: Dict[str, list]) -> bytes:
    """
    Serialize spatial layers as a GeoPackage (.gpkg) file.

    Creates an in-memory SQLite database conforming to the GeoPackage
    standard, writes it to a temporary file, and returns the bytes.
    """
    import os
    import tempfile

    WGS84_WKT = (
        'GEOGCS["WGS 84",DATUM["WGS_1984",'
        'SPHEROID["WGS_1984",6378137.0,298.257223563]],'
        'PRIMEM["Greenwich",0.0],'
        'UNIT["Degree",0.0174532925199433]]'
    )

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".gpkg")
    os.close(tmp_fd)

    try:
        conn = sqlite3.connect(tmp_path)
        conn.execute("PRAGMA application_id = 1196444487")  # 'GPKG'
        conn.execute("PRAGMA user_version = 10200")  # GeoPackage 1.2

        conn.execute("""
            CREATE TABLE gpkg_spatial_ref_sys (
                srs_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL PRIMARY KEY,
                organization TEXT NOT NULL,
                organization_coordsys_id INTEGER NOT NULL,
                definition TEXT NOT NULL,
                description TEXT
            )
        """)
        conn.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
            ("Undefined Cartesian", -1, "NONE", -1, "undefined", None),
        )
        conn.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
            ("Undefined Geographic", 0, "NONE", 0, "undefined", None),
        )
        conn.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
            ("WGS 84", 4326, "EPSG", 4326, WGS84_WKT, "WGS 84"),
        )

        conn.execute("""
            CREATE TABLE gpkg_contents (
                table_name TEXT NOT NULL PRIMARY KEY,
                data_type TEXT NOT NULL DEFAULT 'features',
                identifier TEXT UNIQUE,
                description TEXT DEFAULT '',
                last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
                srs_id INTEGER,
                CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id)
                    REFERENCES gpkg_spatial_ref_sys(srs_id)
            )
        """)

        conn.execute("""
            CREATE TABLE gpkg_geometry_columns (
                table_name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                geometry_type_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL,
                z TINYINT NOT NULL,
                m TINYINT NOT NULL,
                CONSTRAINT pk_gc PRIMARY KEY (table_name, column_name),
                CONSTRAINT fk_gc_tn FOREIGN KEY (table_name)
                    REFERENCES gpkg_contents(table_name),
                CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id)
                    REFERENCES gpkg_spatial_ref_sys(srs_id)
            )
        """)

        # Column definitions per layer: (col_name, sql_type)
        layer_columns = {
            "deployments": [
                ("camera_name", "TEXT"),
                ("deployment_id", "INTEGER"),
                ("start_date", "TEXT"),
                ("end_date", "TEXT"),
                ("trap_days", "INTEGER"),
                ("detection_count", "INTEGER"),
                ("detection_rate_per_100", "REAL"),
            ],
            "observations": [
                ("image_uuid", "TEXT"),
                ("filename", "TEXT"),
                ("datetime", "TEXT"),
                ("camera_name", "TEXT"),
                ("species", "TEXT"),
                ("scientific_name", "TEXT"),
                ("count", "TEXT"),
                ("max_confidence", "TEXT"),
                ("classification_method", "TEXT"),
                ("observation_comments", "TEXT"),
                ("is_verified", "TEXT"),
            ],
            "species_summary": [
                ("camera_name", "TEXT"),
                ("species", "TEXT"),
                ("scientific_name", "TEXT"),
                ("total_count", "INTEGER"),
                ("detection_rate_per_100", "REAL"),
            ],
        }

        for layer_name, features in layers.items():
            columns = layer_columns[layer_name]
            col_defs = ", ".join(f"{name} {typ}" for name, typ in columns)
            conn.execute(f"""
                CREATE TABLE "{layer_name}" (
                    fid INTEGER PRIMARY KEY AUTOINCREMENT,
                    geom BLOB,
                    {col_defs}
                )
            """)

            # Compute bounding box
            if features:
                min_x = min(f["lon"] for f in features)
                max_x = max(f["lon"] for f in features)
                min_y = min(f["lat"] for f in features)
                max_y = max(f["lat"] for f in features)
            else:
                min_x = max_x = min_y = max_y = 0.0

            conn.execute(
                "INSERT INTO gpkg_contents (table_name, data_type, identifier, "
                "description, min_x, min_y, max_x, max_y, srs_id) "
                "VALUES (?, 'features', ?, '', ?, ?, ?, ?, 4326)",
                (layer_name, layer_name, min_x, min_y, max_x, max_y),
            )
            conn.execute(
                "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', 4326, 0, 0)",
                (layer_name,),
            )

            # Insert features
            col_names = [name for name, _ in columns]
            placeholders = ", ".join(["?"] * (1 + len(col_names)))
            insert_sql = (
                f'INSERT INTO "{layer_name}" (geom, {", ".join(col_names)}) '
                f"VALUES ({placeholders})"
            )
            for feat in features:
                geom_blob = _make_gpkg_point(feat["lon"], feat["lat"])
                values = [feat["properties"].get(c, "") for c in col_names]
                conn.execute(insert_sql, [geom_blob] + values)

        conn.commit()
        conn.close()

        with open(tmp_path, "rb") as f:
            data = f.read()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return data


@router.get("/spatial")
async def export_spatial(
    project_id: int,
    format: str = Query("geojson", pattern="^(geojson|shapefile|gpkg)$"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
) -> StreamingResponse:
    """
    Export spatial data as GeoJSON, Shapefile (ZIP), or GeoPackage.

    Produces three layers -- deployments, observations, and species_summary --
    suitable for loading into QGIS, ArcGIS, or other GIS tools.
    """
    if project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )

    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    from routers.admin import get_server_timezone
    server_tz = await get_server_timezone(db)
    tz = ZoneInfo(server_tz)

    # Taxonomy lookup
    tax_result = await db.execute(select(SpeciesTaxonomy))
    taxonomy_rows = tax_result.scalars().all()
    taxonomy_lookup = {
        t.common_name: {
            "scientific_name": t.scientific_name,
            "taxon_rank": t.taxon_rank,
        }
        for t in taxonomy_rows
    }

    # Camera name lookup
    cam_result = await db.execute(
        select(Camera.id, Camera.name).where(Camera.project_id == project_id)
    )
    camera_names = {row.id: row.name for row in cam_result.all()}

    # Load classified images with detections and human observations
    images_query = (
        select(Image)
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Image.status == "classified",
            )
        )
        .options(
            selectinload(Image.detections).selectinload(Detection.classifications),
            selectinload(Image.human_observations),
        )
        .order_by(Image.uploaded_at)
    )
    images_result = await db.execute(images_query)
    images = images_result.scalars().unique().all()

    # Query deployment data with detection counts
    deployment_sql = text("""
        WITH dep_info AS (
            SELECT cdp.id,
                   cdp.camera_id,
                   c.name AS camera_name,
                   cdp.deployment_id AS deployment_number,
                   cdp.start_date,
                   cdp.end_date,
                   ST_X(cdp.location::geometry) AS lon,
                   ST_Y(cdp.location::geometry) AS lat,
                   COALESCE(
                       cdp.end_date - cdp.start_date + 1,
                       CURRENT_DATE - cdp.start_date + 1
                   ) AS trap_days
            FROM camera_deployment_periods cdp
            JOIN cameras c ON cdp.camera_id = c.id
            WHERE c.project_id = :project_id
        ),
        dep_det_counts AS (
            SELECT di.id AS dep_id,
                   COUNT(d.id) AS det_count
            FROM dep_info di
            LEFT JOIN images i
                ON i.camera_id = di.camera_id
                AND i.uploaded_at::date >= di.start_date
                AND (di.end_date IS NULL OR i.uploaded_at::date <= di.end_date)
                AND i.status = 'classified'
            LEFT JOIN detections d
                ON d.image_id = i.id
                AND d.confidence >= :detection_threshold
            GROUP BY di.id
        )
        SELECT di.*,
               COALESCE(dc.det_count, 0) AS detection_count,
               CASE
                   WHEN di.trap_days > 0
                   THEN (COALESCE(dc.det_count, 0)::float / di.trap_days) * 100
                   ELSE 0.0
               END AS detection_rate_per_100
        FROM dep_info di
        LEFT JOIN dep_det_counts dc ON dc.dep_id = di.id
        ORDER BY di.camera_name, di.start_date
    """)
    dep_result = await db.execute(
        deployment_sql,
        {"project_id": project_id, "detection_threshold": project.detection_threshold},
    )
    deployment_rows = dep_result.all()

    logger.info(
        "Starting spatial export",
        project_id=project_id,
        format=format,
        num_images=len(images),
        num_deployments=len(deployment_rows),
    )

    layers = _build_spatial_layers(
        images, camera_names, taxonomy_lookup,
        project.detection_threshold, tz, deployment_rows,
    )

    today = date.today().isoformat()
    slug = _slugify(project.name)

    if format == "shapefile":
        content = _serialize_spatial_shapefile(layers)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="spatial-{slug}-{today}.zip"'
            },
        )
    elif format == "gpkg":
        content = _serialize_spatial_geopackage(layers)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/geopackage+sqlite3",
            headers={
                "Content-Disposition": f'attachment; filename="spatial-{slug}-{today}.gpkg"'
            },
        )
    else:
        content = _serialize_spatial_geojson(layers)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="application/geo+json",
            headers={
                "Content-Disposition": f'attachment; filename="spatial-{slug}-{today}.geojson"'
            },
        )
