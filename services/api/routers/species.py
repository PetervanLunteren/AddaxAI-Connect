"""
Species endpoints for available classification labels.

Returns the species list for the active classification model so the
frontend can populate notification and filter dropdowns dynamically.
"""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, TaxonomyMapping
from shared.database import get_async_session
from shared.config import get_settings
from shared.species import DEEPFAUNE_SPECIES
from auth.users import current_verified_user

router = APIRouter(prefix="/api/species", tags=["species"])
settings = get_settings()


class AvailableSpeciesResponse(BaseModel):
    model: str
    species: List[str]


@router.get("/available", response_model=AvailableSpeciesResponse)
async def get_available_species(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species list for the active classification model.

    For deepfaune: returns the 38 hardcoded species.
    For speciesnet: returns distinct common names from taxonomy_mapping.
    """
    model = settings.classification_model or "deepfaune"

    if model == "speciesnet":
        result = await db.execute(
            select(TaxonomyMapping.common).distinct().order_by(TaxonomyMapping.common)
        )
        species = [row[0] for row in result.all()]
    else:
        species = list(DEEPFAUNE_SPECIES)

    return AvailableSpeciesResponse(model=model, species=species)
