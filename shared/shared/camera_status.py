"""Camera liveness status.

Single source of truth for the 'active / inactive / never_reported' state
shown on the Cameras page, the camera detail sheet, the Insights ->
Deployment timeline, the camera export, and the email reports.

Liveness follows *last contact*: the most recent moment a camera reached
the server, either with a daily health report or with a live image.
Health reports alone are not enough. Some camera models send no daily
report at all (INSTAR), and report parsing can break while the camera
keeps delivering photos. In both cases a report-only rule marks a
perfectly healthy camera as silent.

Contact is measured with server receive times (`CameraHealthReport.created_at`,
`Image.ingested_at`), never with the camera clock. A camera trap clock is
often unset or years off when it is first deployed, which is exactly when
the status matters most. The camera alert rules and the theft watch
already define contact this way, so all three now agree.

Only live images count. A bulk upload is an SD card carried in by hand,
not the camera transmitting, so it must never make a stolen camera look
alive.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

CameraStatus = Literal['active', 'inactive', 'never_reported']

CAMERA_SILENCE_DAYS = 7


def camera_status(
    last_report_arrival: Optional[datetime],
    last_image_arrival: Optional[datetime],
) -> CameraStatus:
    """Classify a camera by when it last reached the server.

    `active` means contact within `CAMERA_SILENCE_DAYS`.
    `inactive` means the camera reached the server before, but not recently.
    `never_reported` means it never reached the server at all.

    Both arguments are aware UTC server receive times, or None when that
    kind of contact never happened. Passing a naive datetime raises, which
    is intended: it means a camera-clock column was wired in by mistake.
    """
    stamps = [s for s in (last_report_arrival, last_image_arrival) if s is not None]
    if not stamps:
        return 'never_reported'
    cutoff = datetime.now(timezone.utc) - timedelta(days=CAMERA_SILENCE_DAYS)
    return 'active' if max(stamps) >= cutoff else 'inactive'
