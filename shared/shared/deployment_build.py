"""
Build a camera's deployments from its GPS readings.

One function without database access: the same readings always give the same
deployments. It applies the rule live ingestion uses today
(update_or_create_site_and_deployment in services/ingestion/db_operations.py),
quirks included, so the result can be compared with what is stored. See
DEPLOYMENTS_PLAN.md, "How one camera's deployments are built".

Not in here, on purpose: sites, statements by people, photos without GPS, and
any write. Daily reports are not readings: only photos make deployments.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional, Sequence

from .geo import (
    RELOCATION_CONFIRMATIONS,
    SITE_THRESHOLD_METERS,
    calculate_gps_distance,
    next_mean_pin,
)


@dataclass(frozen=True)
class Reading:
    """The GPS of one photo (images.gps_lat and gps_lon)."""
    image_id: int
    taken_at: datetime  # camera clock, naive, as images.captured_at
    lat: float
    lon: float


@dataclass
class BuiltDeployment:
    """One camera at one place for a period. The period is [start_at, end_at):
    the end of one deployment is the start of the next, and None means the
    camera still stands there."""
    start_at: datetime
    end_at: Optional[datetime]
    lat: float  # the pin, the running mean of the readings in range
    lon: float
    reading_count: int
    image_ids: list[int] = field(default_factory=list)

    @property
    def start_date(self) -> date:
        return self.start_at.date()

    @property
    def end_date(self) -> Optional[date]:
        """The last whole day of the deployment. The day of a move belongs to
        the new deployment, so every day counts once for effort. Never before
        the start: a camera that moves on the day it started shares that day
        with the next deployment, as it does today."""
        if self.end_at is None:
            return None
        return max(self.end_at.date() - timedelta(days=1), self.start_date)


@dataclass
class _Held:
    """Far readings waiting for a second one to confirm a move."""
    lat: float
    lon: float
    first_at: datetime
    count: int
    image_ids: list[int]


def build_deployments(readings: Sequence[Reading]) -> list[BuiltDeployment]:
    """
    Walk the readings in the order given and return the deployments, oldest
    first. The function does not sort: capture order gives the history as it
    happened, arrival order gives what live ingestion made of it.

    The rule:
    - A reading within SITE_THRESHOLD_METERS of the open deployment's pin
      joins it and is averaged into the pin.
    - A reading further away is held on the open deployment. When
      RELOCATION_CONFIRMATIONS far readings in a row lie within the threshold
      of each other, the camera moved: a new deployment starts at the time of
      the first of them and takes their photos.
    - A far reading that is not near the held one replaces it. A reading back
      in range drops it.
    """
    deployments: list[BuiltDeployment] = []
    held: Optional[_Held] = None

    for reading in readings:
        if not deployments:
            deployments.append(_open(reading, reading.taken_at, [reading.image_id]))
            continue

        active = deployments[-1]
        distance = calculate_gps_distance(active.lat, active.lon, reading.lat, reading.lon)

        if distance <= SITE_THRESHOLD_METERS:
            held = None
            active.start_at = min(active.start_at, reading.taken_at)
            active.lat, active.lon, active.reading_count = next_mean_pin(
                active.lat, active.lon, active.reading_count, reading.lat, reading.lon
            )
            active.image_ids.append(reading.image_id)
            continue

        near_held = held is not None and calculate_gps_distance(
            held.lat, held.lon, reading.lat, reading.lon
        ) <= SITE_THRESHOLD_METERS
        if near_held:
            count = held.count + 1
            first_at = held.first_at
            waiting = held.image_ids
        else:
            count = 1
            first_at = reading.taken_at
            waiting = []

        if count < RELOCATION_CONFIRMATIONS:
            # Not a move yet. The photo stays on the open deployment, and its
            # reading does not touch the pin or the start.
            held = _Held(reading.lat, reading.lon, first_at, count, waiting + [reading.image_id])
            active.image_ids.append(reading.image_id)
            continue

        # A move. The held photos were shot at the new place, so they go
        # along. The new pin starts at this reading alone: the held readings
        # are not averaged in.
        moving = set(waiting)
        active.image_ids = [i for i in active.image_ids if i not in moving]
        active.end_at = first_at
        deployments.append(_open(reading, first_at, waiting + [reading.image_id]))
        held = None

    return deployments


def _open(reading: Reading, start_at: datetime, image_ids: list[int]) -> BuiltDeployment:
    return BuiltDeployment(
        start_at=start_at,
        end_at=None,
        lat=reading.lat,
        lon=reading.lon,
        reading_count=1,
        image_ids=image_ids,
    )
