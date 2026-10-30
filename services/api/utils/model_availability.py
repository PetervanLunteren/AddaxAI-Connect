"""
Which classification models a new project can pick on this server.

The catalog (shared.classification_models) lists every model. Whether one
fits is decided from what the classification worker last reported in
Redis: its loaded models and the server's free memory. A model that would
not fit is still listed, greyed out with the reason, so the user knows the
model exists and who to ask.

The create endpoint runs the same check, so the greying is a convenience
and the server decides.
"""
from datetime import datetime, timezone
import json
from typing import Optional

from pydantic import BaseModel

from shared.classification_models import (
    CLASSIFICATION_MODELS,
    ClassificationModel,
    fits_in_memory,
)
from shared.queue import (
    RedisQueue,
    HEARTBEAT_KEY_CLASSIFICATION,
    HEARTBEAT_STALE_AFTER_MINUTES,
    MODELS_KEY_CLASSIFICATION,
    parse_heartbeat,
)

WORKER_DOWN = "The classification worker is not running, ask the server admin"
NOT_ENOUGH_MEMORY = "Not enough memory on this server for another model, ask the server admin"


class ModelAvailability(BaseModel):
    id: str
    name: str
    description: str
    developer: str
    region: str
    emoji: str
    licence_url: str
    info_url: str
    kind: str
    loaded: bool
    fits: bool
    # Why it does not fit; None when it does.
    reason: Optional[str] = None


def _worker_state() -> tuple[Optional[int], list[str]]:
    """(free memory in MB, loaded model ids) from the worker's last report,
    or (None, []) when the worker is down or has never reported."""
    client = RedisQueue("health-check").client
    last_seen = parse_heartbeat(client.get(HEARTBEAT_KEY_CLASSIFICATION))
    if last_seen is None:
        return None, []
    age = datetime.now(timezone.utc) - last_seen
    if age.total_seconds() > HEARTBEAT_STALE_AFTER_MINUTES * 60:
        return None, []
    raw = client.get(MODELS_KEY_CLASSIFICATION)
    if not raw:
        return None, []
    state = json.loads(raw)
    return int(state["available_mb"]), list(state["loaded"])


def _availability(model: ClassificationModel, available_mb: Optional[int], loaded: list[str]) -> ModelAvailability:
    if available_mb is None:
        fits, reason = False, WORKER_DOWN
    elif fits_in_memory(model, available_mb, loaded):
        fits, reason = True, None
    else:
        fits, reason = False, NOT_ENOUGH_MEMORY
    return ModelAvailability(
        id=model.id, name=model.name, description=model.description,
        developer=model.developer, region=model.region, emoji=model.emoji,
        licence_url=model.licence_url, info_url=model.info_url, kind=model.kind,
        loaded=model.id in loaded, fits=fits, reason=reason,
    )


def list_models() -> list[ModelAvailability]:
    """Every catalog model with whether it fits right now."""
    available_mb, loaded = _worker_state()
    return [_availability(m, available_mb, loaded) for m in CLASSIFICATION_MODELS.values()]


def check_model(model: ClassificationModel) -> Optional[str]:
    """None when a new project may use the model, else the reason it may not."""
    available_mb, loaded = _worker_state()
    return _availability(model, available_mb, loaded).reason
