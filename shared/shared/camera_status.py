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

A retired camera (`Camera.retired_at` set) is `retired` whatever its last
contact. It left its project on purpose, with its data kept, so it must
never read as `inactive`, which is the alarm word, nor as `active` when it
was retired an hour after its last photo.

The rejected files warning follows the same clocks. A camera is
*rejecting* while its latest rejected file is newer than its latest
accepted live image. A camera without a GPS fix after a battery change
rejects a photo or two and then recovers on its own; counting rejections
would keep warning about it for days, while this clears with the first
good photo. A bulk upload never clears it, a carried-in SD card says
nothing about the camera's GPS today.

The health limits live here too, so the Cameras page, the To do list and
the email report flag the same cameras: battery under
`LOW_BATTERY_PERCENT`, SD card over `SD_NEARLY_FULL_PERCENT`, a SIM card
that expires before the 1st of the month after next. They only count for
a camera that reports (`counts_for_health`): a retired camera left its
project, one that never reported has nothing to read.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

CameraStatus = Literal['active', 'inactive', 'never_reported', 'retired']

CAMERA_SILENCE_DAYS = 7
LOW_BATTERY_PERCENT = 30
SD_NEARLY_FULL_PERCENT = 80
# A SIM card counts as expiring on or before the 1st of the month this many
# months ahead: the monthly email then warns a whole month before.
SIM_LOOKAHEAD_MONTHS = 2


def camera_status(
    last_report_arrival: Optional[datetime],
    last_image_arrival: Optional[datetime],
    retired_at: Optional[datetime] = None,
) -> CameraStatus:
    """Classify a camera by when it last reached the server.

    `retired` means the camera was taken out of its project, data kept.
    `active` means contact within `CAMERA_SILENCE_DAYS`.
    `inactive` means the camera reached the server before, but not recently.
    `never_reported` means it never reached the server at all.

    The arrival arguments are aware UTC server receive times, or None when
    that kind of contact never happened. Passing a naive datetime raises,
    which is intended: it means a camera-clock column was wired in by
    mistake. `retired_at` is only tested for presence.
    """
    if retired_at is not None:
        return 'retired'
    stamps = [s for s in (last_report_arrival, last_image_arrival) if s is not None]
    if not stamps:
        return 'never_reported'
    cutoff = datetime.now(timezone.utc) - timedelta(days=CAMERA_SILENCE_DAYS)
    return 'active' if max(stamps) >= cutoff else 'inactive'


def is_rejecting(
    last_rejected_at: Optional[datetime],
    last_live_image_at: Optional[datetime],
) -> bool:
    """True while the latest rejected file is newer than the latest live image.

    Both arguments are aware UTC server receive times (`Rejection.rejected_at`,
    `Image.ingested_at` of live images), or None when that never happened. The
    time window is the caller's: it decides which rejections it looked at.
    A naive datetime raises, it means a camera-clock column was wired in.
    """
    for stamp in (last_rejected_at, last_live_image_at):
        if stamp is not None and stamp.tzinfo is None:
            raise ValueError("is_rejecting needs aware UTC server receive times")
    if last_rejected_at is None:
        return False
    return last_live_image_at is None or last_rejected_at > last_live_image_at


def counts_for_health(status: CameraStatus) -> bool:
    """Whether a camera's health readings may raise a warning at all."""
    return status in ('active', 'inactive')


def is_low_battery(percent: Optional[float]) -> bool:
    return percent is not None and percent < LOW_BATTERY_PERCENT


def is_sd_nearly_full(percent: Optional[float]) -> bool:
    return percent is not None and percent > SD_NEARLY_FULL_PERCENT


def sim_expiry_threshold(today: date) -> date:
    """The 1st of the month `SIM_LOOKAHEAD_MONTHS` after today's month."""
    months = today.year * 12 + today.month - 1 + SIM_LOOKAHEAD_MONTHS
    return date(months // 12, months % 12 + 1, 1)


def is_sim_expiring(expiry: Optional[date], today: date) -> bool:
    """True when the SIM card expires on or before the threshold, or already
    expired. `today` is the server's date (its timezone setting)."""
    return expiry is not None and expiry <= sim_expiry_threshold(today)
