"""
The classification models a project can pick.

Every catalog model, with whether a new project on this server could use
it right now (see utils.model_availability). The create dialog greys out
the ones that do not fit, and the About page lists them all with their
credits.
"""
from typing import List

from fastapi import APIRouter, Depends

from shared.models import User
from auth.users import current_verified_user
from utils.model_availability import ModelAvailability, list_models

router = APIRouter(prefix="/api/classification-models", tags=["classification-models"])


@router.get("", response_model=List[ModelAvailability])
async def get_classification_models(current_user: User = Depends(current_verified_user)):
    return list_models()
