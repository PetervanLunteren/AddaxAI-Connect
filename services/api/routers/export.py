"""
Export endpoints for project data.

Supports:
- CamTrap DP: Camera Trap Data Package (https://camtrap-dp.tdwg.org/) as a ZIP file
- CSV: Simple observations CSV for analysis in Excel or R
"""
from typing import List, Dict, Optional, Any
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import csv
import io
import json
import re
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
)
from shared.database import get_async_session
from shared.storage import StorageClient, BUCKET_THUMBNAILS
from shared.logger import get_logger
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids

router = APIRouter(prefix="/api/projects/{project_id}/export", tags=["export"])
logger = get_logger("api.export")

# TODO: make timezone configurable per project
EXPORT_TIMEZONE = "Europe/Amsterdam"

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

    tz = ZoneInfo(EXPORT_TIMEZONE)

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
            storage_client = StorageClient()
            for entry in media_entries:
                image = entry["image"]
                if not image.thumbnail_path:
                    continue
                try:
                    thumb_data = storage_client.download_fileobj(BUCKET_THUMBNAILS, image.thumbnail_path)
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


def _build_csv_export(
    images: list,
    camera_names: Dict[int, str],
    taxonomy_lookup: Dict[str, dict],
    detection_threshold: float,
    tz: ZoneInfo,
) -> str:
    """
    Build a simple observations CSV with one row per species per image.

    Detections are grouped by species (animals) or category (person/vehicle).
    Blank images get a single row with empty species/count fields.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "image_uuid", "filename", "datetime", "camera_name",
        "latitude", "longitude",
        "species", "scientific_name", "count", "max_confidence",
        "classification_method", "observation_comments", "is_verified",
    ]
    writer.writerow(headers)

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
            # Human observations for verified images
            for ho in image.human_observations:
                has_observations = True
                tax = taxonomy_lookup.get(ho.species, {})
                sci_name = tax.get("scientific_name") or ho.species

                writer.writerow([
                    image.uuid, image.filename, ts_str, camera_name,
                    lat, lon,
                    ho.species, sci_name, ho.count, "",
                    "human", "Human identification", is_verified,
                ])
        else:
            # Group AI detections above threshold by species/category
            groups: Dict[str, Dict[str, Any]] = {}

            for det in image.detections:
                if det.confidence < detection_threshold:
                    continue

                if det.category == "animal" and det.classifications:
                    species = det.classifications[0].species
                    confidence = det.classifications[0].confidence
                    classified_by = "MegaDetector v1000 + DeepFaune v1.4"
                else:
                    species = det.category  # "person" or "vehicle"
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

                writer.writerow([
                    image.uuid, image.filename, ts_str, camera_name,
                    lat, lon,
                    species, sci_name, data["count"],
                    round(data["max_confidence"], 6),
                    "machine", f"{data['classified_by']}, not reviewed", is_verified,
                ])

        # Blank row for images with no observations
        if not has_observations:
            if image.is_verified:
                blank_method = "human"
                blank_comments = "Human identification"
            else:
                blank_method = "machine"
                blank_comments = "MegaDetector v1000, not reviewed"

            writer.writerow([
                image.uuid, image.filename, ts_str, camera_name,
                lat, lon,
                "blank", "", "", "",
                blank_method, blank_comments, is_verified,
            ])

    return output.getvalue()


@router.get("/csv")
async def export_csv(
    project_id: int,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
) -> StreamingResponse:
    """
    Export project observations as a simple CSV file.

    One row per species per image, grouped by species (animals) or category
    (person/vehicle). Includes blank images, applies detection threshold.
    """
    # Verify project access
    if project_id not in accessible_project_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    # Load project
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    tz = ZoneInfo(EXPORT_TIMEZONE)

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

    # Load camera names for this project
    cam_result = await db.execute(
        select(Camera.id, Camera.name).where(Camera.project_id == project_id)
    )
    camera_names = {row.id: row.name for row in cam_result.all()}

    # Load all classified images with related data
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
        "Starting CSV export",
        project_id=project_id,
        num_images=len(images),
    )

    csv_content = _build_csv_export(
        images, camera_names, taxonomy_lookup, project.detection_threshold, tz,
    )

    today = date.today().isoformat()
    filename = f"observations-{_slugify(project.name)}-{today}.csv"

    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
