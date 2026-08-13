"""Per-camera recency lookups.

One place that answers "when did we last hear from these cameras", used by
the Cameras page, the camera export, and the deployment timeline. Two
grouped queries, whatever the number of cameras.

Two clocks live here on purpose, do not mix them up (see DEVELOPERS.md):

- `last_captured` / `last_reported` are camera wall-clock readings, naive.
  They are what the camera claims, and they are only for display.
- `last_image_arrival` / `last_report_arrival` are server receive times,
  aware UTC. They are what actually reached us, and they drive the
  liveness status in `shared.camera_status`.

Only live images count as an arrival. A bulk upload is an SD card carried
in by hand, not the camera transmitting.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import CameraHealthReport, Image


@dataclass(frozen=True)
class CameraRecency:
    """Recency maps keyed by camera id. A missing key means it never happened."""

    last_captured: dict[int, datetime] = field(default_factory=dict)
    last_reported: dict[int, datetime] = field(default_factory=dict)
    last_image_arrival: dict[int, datetime] = field(default_factory=dict)
    last_report_arrival: dict[int, datetime] = field(default_factory=dict)


async def fetch_camera_recency(
    db: AsyncSession, camera_ids: list[int]
) -> CameraRecency:
    """Fetch the four recency maps for `camera_ids` in two grouped queries."""
    if not camera_ids:
        return CameraRecency()

    # `last_captured` covers every image so the displayed "Last image" keeps
    # showing a bulk import, while the arrival column is filtered to live
    # images because only those prove the camera is transmitting.
    image_rows = await db.execute(
        select(
            Image.camera_id,
            func.max(Image.captured_at),
            func.max(Image.ingested_at).filter(Image.origin == 'live'),
        )
        .where(Image.camera_id.in_(camera_ids))
        .group_by(Image.camera_id)
    )
    last_captured: dict[int, datetime] = {}
    last_image_arrival: dict[int, datetime] = {}
    for cam_id, captured_at, ingested_at in image_rows.all():
        if captured_at is not None:
            last_captured[cam_id] = captured_at
        if ingested_at is not None:
            last_image_arrival[cam_id] = ingested_at

    report_rows = await db.execute(
        select(
            CameraHealthReport.camera_id,
            func.max(CameraHealthReport.reported_at),
            func.max(CameraHealthReport.created_at),
        )
        .where(CameraHealthReport.camera_id.in_(camera_ids))
        .group_by(CameraHealthReport.camera_id)
    )
    last_reported: dict[int, datetime] = {}
    last_report_arrival: dict[int, datetime] = {}
    for cam_id, reported_at, created_at in report_rows.all():
        if reported_at is not None:
            last_reported[cam_id] = reported_at
        if created_at is not None:
            last_report_arrival[cam_id] = created_at

    return CameraRecency(
        last_captured=last_captured,
        last_reported=last_reported,
        last_image_arrival=last_image_arrival,
        last_report_arrival=last_report_arrival,
    )
