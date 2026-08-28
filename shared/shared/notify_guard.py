"""
Stops a development server notifying real people.

A dev server is normally loaded with a restored production database, so it
holds every real user, their email address and their Telegram chat id. The
scheduled jobs do not know the difference, and the delivery workers hold real
SMTP credentials, so without this an update test would send daily reports and
alerts to actual users. Telegram already had half of this: scripts/restore.sh
deletes the restored bot config on a dev box after the 12 Aug 2026 incident
where two servers fought over one bot token. Email had the same hole and no
guard at all.

The rule is one line: on a development server, deliver only to an explicit
allow-list and drop everything else, loudly.

Why `environment` and not the domain name. It is explicit, it survives a
server being renamed, and it is the variable that already decides the Telegram
question in restore.sh. It only works because the default is "production", so
a server that never sets it keeps notifying. Failing the other way would
silence a real server on a missing variable, and a quiet production server is
far worse than a chatty dev one.

The allow-list keeps fire drills working. A blanket block would make it
impossible to test that an alert email renders and arrives, which is exactly
how the theft watch and the delivery-liveness alerts were verified.
"""
from typing import Optional, Tuple

from shared.config import get_settings


def _split(raw: Optional[str]) -> set[str]:
    """Comma-separated setting to a set, tolerating spaces and empties."""
    if not raw:
        return set()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def is_development() -> bool:
    """True when this server is marked as not production.

    Anything other than the exact word "development" counts as production, so a
    typo cannot silence a real server.
    """
    return (get_settings().environment or "").strip().lower() == "development"


def email_allowed(to_email: Optional[str]) -> Tuple[bool, str]:
    """May this address be emailed from this server?

    Returns (allowed, reason). The reason is for the log line on a block, so
    whoever runs an update test can see who would have been mailed.
    """
    if not is_development():
        return True, ""

    allowed = _split(get_settings().dev_notify_emails)
    if not allowed:
        return False, "development server with an empty DEV_NOTIFY_EMAILS allow-list"

    if (to_email or "").strip().lower() in allowed:
        return True, ""

    return False, "development server, recipient is not in DEV_NOTIFY_EMAILS"


def chat_id_allowed(chat_id: Optional[str]) -> Tuple[bool, str]:
    """May this Telegram chat be messaged from this server?

    Same rule as email. Empty allow-list means no Telegram at all, which is the
    right default: chat ids are opaque numbers, so nobody can eyeball a mistake
    the way they can with an address.
    """
    if not is_development():
        return True, ""

    allowed = _split(get_settings().dev_notify_chat_ids)
    if not allowed:
        return False, "development server with an empty DEV_NOTIFY_CHAT_IDS allow-list"

    if str(chat_id or "").strip() in allowed:
        return True, ""

    return False, "development server, chat id is not in DEV_NOTIFY_CHAT_IDS"


def earthranger_allowed(project_id: Optional[int]) -> Tuple[bool, str]:
    """May this project post events to EarthRanger from this server?

    Same rule again. A restored production database carries every project's
    Gundi API key, and an event posted from a dev box lands on a real
    ranger map, so on a development server only the listed project ids may
    post. That is also how a test against a sandbox site is run: list the
    one project that points at it.
    """
    if not is_development():
        return True, ""

    allowed = _split(get_settings().dev_notify_earthranger_projects)
    if not allowed:
        return False, "development server with an empty DEV_NOTIFY_EARTHRANGER_PROJECTS allow-list"

    if str(project_id or "").strip() in allowed:
        return True, ""

    return False, "development server, project is not in DEV_NOTIFY_EARTHRANGER_PROJECTS"
