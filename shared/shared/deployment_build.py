"""
Build a camera's deployments from its GPS readings and the statements people
made about it.

One function without database access: the same input always gives the same
deployments. Without statements it applies the rule live ingestion used
before phase 2 (the 250 m threshold, two far readings to confirm a move),
quirks included. See DEPLOYMENTS_PLAN.md, "How one camera's deployments are
built".

Not in here, on purpose: choosing a site for a deployment that GPS made,
photos without GPS, and any write. Daily reports are not readings: only
photos make deployments.
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


@dataclass(frozen=True)
class Statement:
    """A decision by a person: this camera stood at this site in this period.

    A statement fixes the past, not the future.
    - With an end (until_at), it is exactly that period: one deployment, and
      GPS does not cut inside it. After the period the walk starts again from
      the next reading, as for a new camera.
    - Without an end the camera is still there. Everything up to
      fixed_until_at, the camera's newest photo when the statement was made,
      is fixed the same way. After that the GPS rule carries on from this
      deployment, so a later move is still seen.
    A newer statement (higher id) wins over an older one where they overlap.
    """
    id: int
    site_id: int
    from_at: datetime
    until_at: Optional[datetime] = None
    fixed_until_at: Optional[datetime] = None  # only read when until_at is None


@dataclass(frozen=True)
class Move:
    """Why the GPS rule started a deployment: the camera moved."""
    distance_m: float  # from the previous deployment's pin to the reading that confirmed the move
    readings: int  # how many far readings in a row confirmed it
    first_at: datetime  # the first of them, which is where the deployment starts


@dataclass
class BuiltDeployment:
    """One camera at one place for a period. The period is [start_at, end_at):
    None as end means the camera still stands there."""
    start_at: datetime
    end_at: Optional[datetime]
    lat: Optional[float]  # the pin, the running mean of the readings in range.
    lon: Optional[float]  # None for a stated deployment without any reading.
    reading_count: int
    image_ids: list[int] = field(default_factory=list)
    site_id: Optional[int] = None  # set when a statement made this deployment
    statement_id: Optional[int] = None
    move: Optional[Move] = None  # set when the GPS rule cut here, for the "why" in the camera updates check

    @property
    def start_date(self) -> date:
        return self.start_at.date()

    @property
    def end_date(self) -> Optional[date]:
        """The last whole day of the deployment. The day of a move belongs to
        the new deployment, so every day counts once for effort. Never before
        the start: a camera that moves on the day it started shares that day
        with the next deployment, as it did before phase 2."""
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


@dataclass(frozen=True)
class _Piece:
    """The part of a statement that is left after newer statements took their
    periods out of it. end is None when it runs for ever."""
    start: datetime
    end: Optional[datetime]
    statement: Statement

    def is_fixed(self, moment: datetime) -> bool:
        """Whether GPS may not cut at this moment inside the piece."""
        s = self.statement
        if s.until_at is not None:
            return True
        return s.fixed_until_at is not None and moment <= s.fixed_until_at


def _lay_out(statements: Sequence[Statement]) -> list[_Piece]:
    """Statements as periods that do not overlap, oldest period first. Goes
    through the statements from old to new, and each one cuts its own period
    out of what the older ones had."""
    pieces: list[_Piece] = []
    for s in sorted(statements, key=lambda s: s.id):
        if s.until_at is not None and s.until_at <= s.from_at:
            continue  # an empty period states nothing
        kept: list[_Piece] = []
        for p in pieces:
            if p.start < s.from_at:
                before_end = s.from_at if p.end is None or p.end > s.from_at else p.end
                kept.append(_Piece(p.start, before_end, p.statement))
            if s.until_at is not None and (p.end is None or p.end > s.until_at):
                kept.append(_Piece(max(p.start, s.until_at), p.end, p.statement))
        kept.append(_Piece(s.from_at, s.until_at, s))
        pieces = kept
    return sorted(pieces, key=lambda p: p.start)


def build_deployments(
    readings: Sequence[Reading],
    statements: Sequence[Statement] = (),
    closed_at: Optional[datetime] = None,
) -> list[BuiltDeployment]:
    """
    Walk the readings in the order given and return the deployments, oldest
    first. The function does not sort the readings. Without statements,
    capture order gives the history as it happened and arrival order gives
    what live ingestion made of it. With statements the readings must be in
    capture order.

    The GPS rule, for readings that no statement fixes:
    - A reading within SITE_THRESHOLD_METERS of the open deployment's pin
      joins it and is averaged into the pin.
    - A reading further away is held on the open deployment. When
      RELOCATION_CONFIRMATIONS far readings in a row lie within the threshold
      of each other, the camera moved: a new deployment starts at the time of
      the first of them and takes their photos.
    - A far reading that is not near the held one replaces it. A reading back
      in range drops it.

    Statements, see Statement: a period a statement fixes is one deployment at
    the stated site, whatever the GPS says.

    closed_at ends the last deployment when it is still open. A retired
    camera's history stops there.
    """
    deployments: list[BuiltDeployment] = []
    todo = _lay_out(statements)  # pieces not entered yet, soonest first
    current: Optional[_Piece] = None  # the piece the walk is inside
    active: Optional[BuiltDeployment] = None  # the deployment readings join
    held: Optional[_Held] = None

    def pass_time(until: Optional[datetime]) -> None:
        """Enter and leave every piece that starts or ends before `until`
        (None = the end of time: leave nothing open that has an end)."""
        nonlocal current, active, held
        while True:
            if current is not None and current.end is not None and (until is None or until >= current.end):
                if active is not None and active.end_at is None:
                    active.end_at = current.end
                current, active, held = None, None, None
            elif current is None and todo and (until is None or todo[0].start <= until):
                piece = todo.pop(0)
                if active is not None and active.end_at is None:
                    active.end_at = piece.start
                active = BuiltDeployment(
                    start_at=piece.start, end_at=None, lat=None, lon=None, reading_count=0,
                    site_id=piece.statement.site_id, statement_id=piece.statement.id,
                )
                deployments.append(active)
                current, held = piece, None
            else:
                return

    for reading in readings:
        pass_time(reading.taken_at)

        if active is None:
            active = _open(reading, reading.taken_at, [reading.image_id])
            deployments.append(active)
            continue

        fixed = current is not None and current.is_fixed(reading.taken_at)
        if active.lat is None:
            # A stated deployment without a reading yet: nothing to measure
            # against, so the first one sets the pin.
            distance = 0.0
        else:
            distance = calculate_gps_distance(active.lat, active.lon, reading.lat, reading.lon)

        if fixed or distance <= SITE_THRESHOLD_METERS:
            held = None
            active.start_at = min(active.start_at, reading.taken_at)
            if active.lat is None:
                active.lat, active.lon, active.reading_count = reading.lat, reading.lon, 1
            else:
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
        active = _open(reading, first_at, waiting + [reading.image_id])
        active.move = Move(distance_m=distance, readings=count, first_at=first_at)
        deployments.append(active)
        held = None

    pass_time(None)

    if closed_at is not None and deployments and deployments[-1].end_at is None:
        deployments[-1].end_at = max(closed_at, deployments[-1].start_at)

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
