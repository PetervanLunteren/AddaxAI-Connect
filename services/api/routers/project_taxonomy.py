"""
A project's SpeciesNet taxonomy mapping: view it, and replace it.

The mapping is the project's label list (see shared/taxonomy.py). Replacing
it relabels the project's unverified classifications right away, from the
stored SpeciesNet prediction, without running the model again. A label that
leaves the list is removed from the rules and thresholds that use it, after
the admin confirmed that (see utils/label_changes.py).
"""
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.classification_models import SPECIESNET, get_model
from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import (
    Camera,
    Classification,
    Detection,
    Image,
    Project,
    TaxonomyMapping,
    User,
)
from shared.taxonomy import apply_taxonomy_walkup
from auth.permissions import can_admin_project
from auth.users import current_verified_user
from utils.label_changes import (
    LabelChangeImpact,
    clean_gone_labels,
    confirm_or_refuse,
    send_label_change_emails,
)
from utils.taxonomy_csv import parse_taxonomy_csv, replace_project_taxonomy

router = APIRouter(prefix="/api/projects", tags=["project-taxonomy"])
logger = get_logger("api.project_taxonomy")

REPROCESS_BATCH_SIZE = 500


class TaxonomyMappingEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    latin: str
    common: str


class TaxonomyMappingResponse(BaseModel):
    count: int
    entries: List[TaxonomyMappingEntry]


class TaxonomyUploadResponse(TaxonomyMappingResponse):
    reprocessed_count: int
    # What the upload removed from rules and thresholds, because their label
    # is no longer in the list. Counts only: rules are private to their owner.
    impact: LabelChangeImpact


async def _require_admin(db: AsyncSession, user: User, project_id: int) -> None:
    if not await can_admin_project(user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )


async def _entries(db: AsyncSession, project_id: int) -> List[TaxonomyMapping]:
    result = await db.execute(
        select(TaxonomyMapping)
        .where(TaxonomyMapping.project_id == project_id)
        .order_by(TaxonomyMapping.latin)
    )
    return list(result.scalars().all())


@router.get("/{project_id}/taxonomy", response_model=TaxonomyMappingResponse)
async def get_project_taxonomy(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """The project's taxonomy mapping, ordered by latin name (project admin)."""
    await _require_admin(db, current_user, project_id)
    entries = await _entries(db, project_id)
    return TaxonomyMappingResponse(
        count=len(entries),
        entries=[TaxonomyMappingEntry.model_validate(e) for e in entries],
    )


@router.post("/{project_id}/taxonomy", response_model=TaxonomyUploadResponse)
async def upload_project_taxonomy(
    project_id: int,
    file: UploadFile = File(...),
    confirm: bool = Form(False),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Replace the project's taxonomy mapping with an uploaded CSV (project admin).

    Relabels the project's unverified classifications with the new mapping.
    When the new list lacks a label that rules or thresholds use, nothing is
    saved and the answer is 409 with the impact, until the request comes
    with `confirm`. Then the label is removed from those rules and
    thresholds in the same commit, and the other affected users get an email.
    """
    await _require_admin(db, current_user, project_id)
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if get_model(project.classification_model).kind != SPECIESNET:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A taxonomy mapping CSV is only used by SpeciesNet projects",
        )

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be a .csv file")
    try:
        text = (await file.read()).decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be UTF-8 encoded")
    try:
        rows = parse_taxonomy_csv(text)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Before the first write, so a refused upload changes nothing.
    labels = [common for _, common in rows]
    await confirm_or_refuse(db, project, labels, current_user, confirmed=confirm)

    await replace_project_taxonomy(db, project_id, rows)

    # Relabel this project's unverified classifications, batched for memory.
    # Images belong to a project through their camera, like everywhere else.
    taxonomy_map = dict(rows)
    reprocessed_count = 0
    stream = await db.stream(
        select(Classification)
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            Camera.project_id == project_id,
            Classification.raw_prediction.isnot(None),
            Image.is_verified == False,  # noqa: E712
        )
        .execution_options(yield_per=REPROCESS_BATCH_SIZE)
    )
    async for partition in stream.scalars().partitions(REPROCESS_BATCH_SIZE):
        for classification in partition:
            new_species = apply_taxonomy_walkup(classification.raw_prediction, taxonomy_map)
            if classification.species != new_species:
                classification.species = new_species
                reprocessed_count += 1

    impact, recipients = await clean_gone_labels(db, project, labels, current_user, apply=True)
    project_name = project.name

    await db.commit()
    await send_label_change_emails(project_id, project_name, recipients)

    entries = await _entries(db, project_id)
    logger.info(
        "Taxonomy mapping uploaded",
        project_id=project_id,
        count=len(entries),
        reprocessed_count=reprocessed_count,
        removed_labels=impact.labels,
        rules_updated=impact.rules_updated,
        rules_deleted=impact.rules_deleted,
        uploaded_by=current_user.email,
    )
    return TaxonomyUploadResponse(
        count=len(entries),
        entries=[TaxonomyMappingEntry.model_validate(e) for e in entries],
        reprocessed_count=reprocessed_count,
        impact=impact,
    )
