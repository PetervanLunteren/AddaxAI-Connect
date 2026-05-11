"""Camera liveness status helper.

Single source of truth for the 'active / inactive / never_reported' state
shown on the Cameras page and on the Insights -> Deployment timeline page.
Driven by the most recent CameraHealthReport, not by image arrival, so the
two pages always agree on whether a camera is reachable.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Literal

CameraStatus = Literal['active', 'inactive', 'never_reported']

CAMERA_SILENCE_DAYS = 7


def camera_status(last_reported_at: Optional[datetime]) -> CameraStatus:
    """Classify a camera based on when its most recent health report arrived.

    `active` means the last report is within `CAMERA_SILENCE_DAYS` of now.
    `inactive` means the camera has reported at least once but not recently.
    `never_reported` means there is no report on file.

    A few-hour drift from the true local-vs-UTC offset is irrelevant for a
    7-day window, so the cutoff is computed naive.
    """
    if last_reported_at is None:
        return 'never_reported'
    cutoff = datetime.utcnow() - timedelta(days=CAMERA_SILENCE_DAYS)
    return 'active' if last_reported_at >= cutoff else 'inactive'
