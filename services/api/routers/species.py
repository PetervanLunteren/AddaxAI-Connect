"""
Species endpoints for available classification labels.

Returns a project's label list for its classification model so the
frontend can populate notification and filter dropdowns dynamically.
"""
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.classification_models import SPECIESNET, class_labels, get_model
from shared.models import User, Project, TaxonomyMapping
from shared.database import get_async_session
from shared.taxonomy import UNKNOWN_ANIMAL
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids, narrow_to_project

router = APIRouter(prefix="/api/species", tags=["species"])


class AvailableSpeciesResponse(BaseModel):
    model: str
    kind: str
    species: List[str]


@router.get("/available", response_model=AvailableSpeciesResponse)
async def get_available_species(
    project_id: int = Query(..., description="The project whose labels to list"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get the label list of a project for its classification model.

    A fixed-class model's labels come from the catalog. A SpeciesNet
    project's labels are the distinct common names of its taxonomy mapping,
    plus the fallback label every prediction that matches no row gets, so
    rules and filters can target it too.
    """
    narrow_to_project(accessible_project_ids, project_id)
    model_id = (
        await db.execute(select(Project.classification_model).where(Project.id == project_id))
    ).scalar_one()
    model = get_model(model_id)

    if model.kind == SPECIESNET:
        result = await db.execute(
            select(TaxonomyMapping.common)
            .where(TaxonomyMapping.project_id == project_id)
            .distinct()
        )
        species = sorted({row[0] for row in result.all()} | {UNKNOWN_ANIMAL})
    else:
        species = class_labels(model.id)

    return AvailableSpeciesResponse(model=model.id, kind=model.kind, species=species)
