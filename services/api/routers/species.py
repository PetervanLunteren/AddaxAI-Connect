"""
Species endpoints for available classification labels.

Returns a project's label list for the active classification model so the
frontend can populate notification and filter dropdowns dynamically.
"""
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, TaxonomyMapping
from shared.database import get_async_session
from shared.config import get_settings
from shared.species import DEEPFAUNE_SPECIES
from shared.taxonomy import UNKNOWN_ANIMAL
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids, narrow_to_project

router = APIRouter(prefix="/api/species", tags=["species"])
settings = get_settings()


class AvailableSpeciesResponse(BaseModel):
    model: str
    species: List[str]


@router.get("/available", response_model=AvailableSpeciesResponse)
async def get_available_species(
    project_id: int = Query(..., description="The project whose labels to list"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get the label list of a project for the active classification model.

    For deepfaune: returns the 38 hardcoded species.
    For speciesnet: returns the distinct common names of the project's
    taxonomy mapping, plus the fallback label every prediction that matches
    no row gets, so rules and filters can target it too.
    """
    narrow_to_project(accessible_project_ids, project_id)
    model = settings.classification_model or "deepfaune"

    if model == "speciesnet":
        result = await db.execute(
            select(TaxonomyMapping.common)
            .where(TaxonomyMapping.project_id == project_id)
            .distinct()
        )
        species = sorted({row[0] for row in result.all()} | {UNKNOWN_ANIMAL})
    else:
        species = list(DEEPFAUNE_SPECIES)

    return AvailableSpeciesResponse(model=model, species=species)
