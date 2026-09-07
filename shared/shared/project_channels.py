"""
The outbound integrations that act as rule channels.

Email and Telegram reach the rule's creator. A project channel reaches
the project's integration (an EarthRanger site, a Sensing Clues group)
and is a project-level choice: admins only, one per rule, listed on the
integration page and not on the personal notifications page. The API
(rule validation) and the notifications coordinator (delivery dispatch)
both read this one definition.
"""
from typing import Optional, Sequence

EARTHRANGER = "earthranger"
SENSINGCLUES = "sensingclues"
PROJECT_CHANNELS = frozenset({EARTHRANGER, SENSINGCLUES})
LABELS = {EARTHRANGER: "EarthRanger", SENSINGCLUES: "Sensing Clues"}


def project_channel_of(channels: Optional[Sequence[str]]) -> Optional[str]:
    """The project channel a rule sends to, or None for a personal rule.
    A rule carries at most one; the API enforces that on write."""
    for channel in channels or []:
        if channel in PROJECT_CHANNELS:
            return channel
    return None
