# Gundi export phase 1 (batch backfill) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project admin configure a Gundi connection and push a date range of classified images to Gundi as Events (one per independence-interval group) with blurred thumbnail attachments, with live progress in the UI.

**Architecture:** A new `services/gundi-sync/` worker container consumes a `gundi-sync-backfill` Redis queue (BulkUploadJob pattern: job row + publish + polling endpoint). Per-project credentials live in a `gundi_integrations` table (TelegramConfig pattern: validate on save + health check). A `gundi_events` / `gundi_attachments` ledger makes re-runs idempotent. Two small pieces of API code (the independence-interval CTE and the privacy-blur helper) move into `shared/` so the worker can reuse them.

**Tech Stack:** FastAPI + async SQLAlchemy (API), sync SQLAlchemy + requests + Pillow (worker), PostgreSQL/PostGIS, Redis lists, MinIO, Alembic, React + TypeScript + @tanstack/react-query (frontend), pytest.

**Spec:** `future-plans/gundi-export.md` (phase 1 scope only: no continuous sync, no PATCH updates, no per-integration filters).

## Global constraints

- ALL work happens on branch `feature/gundi-export-phase1`. Never commit to `main`. Task 1 creates the branch; every other task assumes it is checked out.
- `CONVENTIONS.md` applies to every file you touch: no em dashes or double hyphens anywhere (code comments, docstrings, docs, UI copy); sentence case (only first word and proper nouns capitalized) in headings and UI text; type hints everywhere in Python; crash early and loudly; never commit secrets.
- Never return, log, or render the Gundi `api_key` after it is saved. Config responses expose `is_configured`, never the key.
- The Alembic migration's `down_revision` is `'20260706_notify_sites'` (current head).
- Run Python tests from the repo root: `pytest tests/...` (pyproject sets `testpaths = ["tests"]`).
- Frontend check: `cd services/frontend && npm run build` must pass.
- Timestamps: `Image.captured_at` is a NAIVE camera-clock datetime interpreted under `ServerSettings.timezone`. All Gundi `recorded_at` values are that naive time localized to the server timezone and converted to UTC.
- Commit at the end of every task with the message given in that task. End every commit message with the trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Branch, queue constant, models, migration

**Files:**
- Modify: `shared/shared/queue.py` (queue name constants block, near line 150-173)
- Modify: `shared/shared/models.py` (imports at top; new classes appended at end of file)
- Create: `services/api/alembic/versions/20260721_gundi_tables.py`

**Interfaces:**
- Consumes: existing `Base`, `Column`, `func` etc. already imported in `models.py`.
- Produces: `shared.queue.QUEUE_GUNDI_BACKFILL: str`; models `shared.models.GundiIntegration`, `GundiEvent`, `GundiAttachment`, `GundiBackfillJob` with exactly the columns below. Later tasks import these names verbatim.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main && git pull && git checkout -b feature/gundi-export-phase1
```

Expected: `Switched to a new branch 'feature/gundi-export-phase1'`

- [ ] **Step 2: Add the queue constant**

In `shared/shared/queue.py`, directly above the `# Future channels:` comment block at the end of the file, add:

```python
# Gundi export (future-plans/gundi-export.md). Phase 1 only has the
# backfill queue; phase 2 adds a live queue that the worker will
# consume with priority over backfill.
QUEUE_GUNDI_BACKFILL = "gundi-sync-backfill"
```

- [ ] **Step 3: Add the four models**

In `shared/shared/models.py`, add `UniqueConstraint` to the existing top-of-file `from sqlalchemy import ...` line (read the file first; it already imports `Column`, `Integer`, etc.). Then append at the end of the file:

```python
class GundiIntegration(Base):
    """
    Per-project Gundi connection (future-plans/gundi-export.md).

    Row exists = integration is configured. api_key is stored plain,
    the same trade-off as TelegramConfig.bot_token.
    """
    __tablename__ = "gundi_integrations"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(
        Integer,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    endpoint_url = Column(String(255), nullable=False)
    api_key = Column(String(255), nullable=False)
    # Phase 2 (continuous sync) reads this; phase 1 only stores it so a
    # second migration is not needed later.
    sync_enabled = Column(Boolean, nullable=False, server_default="false")
    health_status = Column(String(50), nullable=True)  # healthy | error
    last_health_check = Column(DateTime(timezone=True), nullable=True)
    events_sent = Column(Integer, nullable=False, server_default="0")
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class GundiEvent(Base):
    """
    Sync ledger: one row per independence-interval group pushed to Gundi.

    group_key is "{pool_id}:{species}:{event_start.isoformat()}". The
    unique constraint is what makes backfill re-runs idempotent: a group
    already 'sent' is never posted twice. If images are added later
    inside an existing window the recomputed group can get a new
    event_start and therefore a new key; acceptable for phase 1 where
    backfill targets settled historical data.
    """
    __tablename__ = "gundi_events"
    __table_args__ = (
        UniqueConstraint("project_id", "group_key", name="uq_gundi_events_project_group"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    group_key = Column(String(512), nullable=False)
    species = Column(String(255), nullable=False)
    # Gundi's object_id for the created event. Set as soon as the event
    # POST succeeds, even if attachments later fail, so a retry attaches
    # to the existing event instead of creating a duplicate.
    gundi_object_id = Column(String(64), nullable=True)
    status = Column(String(20), nullable=False, server_default="pending", index=True)  # pending | sent | failed
    # Naive camera-clock bounds, same convention as Image.captured_at.
    event_start = Column(DateTime(timezone=False), nullable=False)
    event_end = Column(DateTime(timezone=False), nullable=False)
    image_count = Column(Integer, nullable=False, server_default="0")
    retry_count = Column(Integer, nullable=False, server_default="0")
    last_error = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GundiAttachment(Base):
    """One image pushed (or attempted) as an attachment on a Gundi event."""
    __tablename__ = "gundi_attachments"
    __table_args__ = (
        UniqueConstraint("gundi_event_id", "image_id", name="uq_gundi_attachments_event_image"),
    )

    id = Column(Integer, primary_key=True, index=True)
    gundi_event_id = Column(
        Integer, ForeignKey("gundi_events.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    image_id = Column(
        Integer, ForeignKey("images.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    status = Column(String(20), nullable=False, server_default="pending")  # pending | sent | failed
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GundiBackfillJob(Base):
    """
    One user-triggered "send date range to Gundi" job. Mirrors
    BulkUploadJob: the API creates the row and publishes to Redis, the
    gundi-sync worker processes it and updates the counters, and the
    frontend polls the row for progress.
    """
    __tablename__ = "gundi_backfill_jobs"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, nullable=False, index=True)
    project_id = Column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Naive camera-clock bounds like Image.captured_at. Null = unbounded.
    start_date = Column(DateTime(timezone=False), nullable=True)
    end_date = Column(DateTime(timezone=False), nullable=True)
    status = Column(String(20), nullable=False, server_default="queued", index=True)  # queued | processing | done | failed
    total_events = Column(Integer, nullable=False, server_default="0")
    sent_events = Column(Integer, nullable=False, server_default="0")
    failed_events = Column(Integer, nullable=False, server_default="0")
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```

- [ ] **Step 4: Write the migration**

Create `services/api/alembic/versions/20260721_gundi_tables.py`:

```python
"""Gundi export tables (phase 1: backfill)

Adds gundi_integrations (per-project credentials), gundi_events and
gundi_attachments (idempotency ledger), and gundi_backfill_jobs
(user-triggered export jobs). See future-plans/gundi-export.md.

Revision ID: 20260721_gundi_tables
Revises: 20260706_notify_sites
Create Date: 2026-07-21

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260721_gundi_tables'
down_revision = '20260706_notify_sites'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'gundi_integrations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  nullable=False, unique=True, index=True),
        sa.Column('endpoint_url', sa.String(length=255), nullable=False),
        sa.Column('api_key', sa.String(length=255), nullable=False),
        sa.Column('sync_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('health_status', sa.String(length=50), nullable=True),
        sa.Column('last_health_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('events_sent', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'gundi_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('group_key', sa.String(length=512), nullable=False),
        sa.Column('species', sa.String(length=255), nullable=False),
        sa.Column('gundi_object_id', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False,
                  server_default='pending', index=True),
        sa.Column('event_start', sa.DateTime(timezone=False), nullable=False),
        sa.Column('event_end', sa.DateTime(timezone=False), nullable=False),
        sa.Column('image_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('project_id', 'group_key',
                            name='uq_gundi_events_project_group'),
    )
    op.create_table(
        'gundi_attachments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('gundi_event_id', sa.Integer(),
                  sa.ForeignKey('gundi_events.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('image_id', sa.Integer(),
                  sa.ForeignKey('images.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('gundi_event_id', 'image_id',
                            name='uq_gundi_attachments_event_image'),
    )
    op.create_table(
        'gundi_backfill_jobs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('uuid', sa.String(length=36), nullable=False, unique=True, index=True),
        sa.Column('project_id', sa.Integer(),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('created_by_user_id', sa.Integer(),
                  sa.ForeignKey('users.id'), nullable=False),
        sa.Column('start_date', sa.DateTime(timezone=False), nullable=True),
        sa.Column('end_date', sa.DateTime(timezone=False), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False,
                  server_default='queued', index=True),
        sa.Column('total_events', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sent_events', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_events', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('gundi_backfill_jobs')
    op.drop_table('gundi_attachments')
    op.drop_table('gundi_events')
    op.drop_table('gundi_integrations')
```

- [ ] **Step 5: Verify imports**

```bash
python -c "
import sys, os
sys.path.insert(0, 'shared')
os.environ.update({'DATABASE_URL': 'postgresql://t:t@localhost/t', 'REDIS_URL': 'redis://localhost', 'MINIO_ENDPOINT': 'localhost:9000', 'MINIO_ACCESS_KEY': 'x', 'MINIO_SECRET_KEY': 'x'})
from shared.models import GundiIntegration, GundiEvent, GundiAttachment, GundiBackfillJob
from shared.queue import QUEUE_GUNDI_BACKFILL
print('ok', QUEUE_GUNDI_BACKFILL)
"
```

Expected: `ok gundi-sync-backfill`

- [ ] **Step 6: Run the existing test suite to confirm nothing broke**

Run: `pytest tests -q`
Expected: all tests pass (same count as on main).

- [ ] **Step 7: Commit**

```bash
git add shared/shared/queue.py shared/shared/models.py services/api/alembic/versions/20260721_gundi_tables.py
git commit -m "Add Gundi export tables, models, and backfill queue name"
```

---

### Task 2: Move the independence CTE into shared

The gundi-sync worker must group images exactly like the CamTrap DP export, but it cannot import `services/api` code. Move only the CTE string; every API function stays where it is.

**Files:**
- Create: `shared/shared/independence_sql.py`
- Modify: `services/api/utils/independence_filter.py` (lines 23-108 hold the `_INDEPENDENCE_CTE` literal)
- Test (existing): `tests/api/test_independence_filter.py` must keep passing unchanged.

**Interfaces:**
- Produces: `shared.independence_sql.INDEPENDENCE_CTE: str`, format placeholders `{verified_filters}`, `{unverified_filters}`, `{pv_filters}`, `{classification_filter}`; bind params `:project_ids`, `:interval`. Task 6 consumes this.
- `services/api/utils/independence_filter.py` keeps exporting `_INDEPENDENCE_CTE` (as an alias) so existing imports and tests do not change.

- [ ] **Step 1: Create the shared module**

Create `shared/shared/independence_sql.py` with this exact content, where the triple-quoted string is the byte-for-byte content of `_INDEPENDENCE_CTE` currently in `services/api/utils/independence_filter.py:23-108` (copy it from the file, do not retype it):

```python
"""
Independence-interval event grouping SQL.

Shared between the API (statistics, exports) and the gundi-sync worker
so both group images into events identically. Moved here from
services/api/utils/independence_filter.py, which re-exports it; the
API-side query builders and async helpers stay in that module.

Format placeholders: {verified_filters}, {unverified_filters},
{pv_filters}, {classification_filter}. Bind params: :project_ids,
:interval, plus whatever the filter clauses add.
"""

INDEPENDENCE_CTE = """
<verbatim copy of the current _INDEPENDENCE_CTE body>
"""
```

- [ ] **Step 2: Replace the literal in the API module**

In `services/api/utils/independence_filter.py`, delete the `_INDEPENDENCE_CTE = """..."""` assignment and replace it with:

```python
from shared.independence_sql import INDEPENDENCE_CTE as _INDEPENDENCE_CTE
```

Put the import with the other `from shared...` imports at the top of the file. Everything else in the module is untouched.

- [ ] **Step 3: Run the tests that cover the CTE**

Run: `pytest tests/api/test_independence_filter.py tests/api/test_naive_occupancy.py tests/api/test_statistics_hour_extraction.py -q`
Expected: PASS, zero failures. These tests import `_INDEPENDENCE_CTE` and the builders from the API module, proving the re-export works.

- [ ] **Step 4: Run the full suite**

Run: `pytest tests -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/shared/independence_sql.py services/api/utils/independence_filter.py
git commit -m "Move independence CTE to shared for reuse by gundi-sync"
```

---

### Task 3: Move the privacy-blur helper into shared

Blur is applied at export/serve time, not baked into thumbnails, so the worker needs the helper too.

**Files:**
- Create: `shared/shared/image_privacy.py`
- Modify: `services/api/utils/image_processing.py` (function `apply_privacy_blur` at line 209)

**Interfaces:**
- Produces: `shared.image_privacy.apply_privacy_blur(image_data: bytes, blur_regions: list[dict]) -> bytes`. Regions are detection bbox dicts with a `"normalized"` key `[x, y, w, h]` in 0-1 range. Task 6 consumes this.
- `services/api/utils/image_processing.py` keeps exporting `apply_privacy_blur` so `routers/export.py` and `routers/images.py` do not change.

- [ ] **Step 1: Create the shared module**

Create `shared/shared/image_privacy.py`. Move the entire `apply_privacy_blur` function body verbatim from `services/api/utils/image_processing.py:209-256`, with this module header:

```python
"""
Privacy blur for person/vehicle detections.

Shared between the API (exports, image serving) and the gundi-sync
worker. Pillow is not a dependency of every service that installs the
shared package, so it is only imported when this module is imported;
services that use it (api, gundi-sync) list Pillow in their own
requirements.
"""
from io import BytesIO
from typing import List

from PIL import Image, ImageFilter


def apply_privacy_blur(image_data: bytes, blur_regions: List[dict]) -> bytes:
    <verbatim body from services/api/utils/image_processing.py>
```

- [ ] **Step 2: Re-export from the API module**

In `services/api/utils/image_processing.py`, delete the `apply_privacy_blur` function and add near the top imports:

```python
# Moved to shared so the gundi-sync worker can blur attachments too.
# Re-exported here so routers/export.py and routers/images.py keep
# their existing import path.
from shared.image_privacy import apply_privacy_blur  # noqa: F401
```

Keep every other function and import in the file (check whether `BytesIO` / `ImageFilter` are still used by the remaining functions before removing any import).

- [ ] **Step 3: Verify**

```bash
python -c "
import sys, os
sys.path.insert(0, 'shared'); sys.path.insert(0, 'services/api')
os.environ.update({'DATABASE_URL': 'postgresql://t:t@localhost/t', 'REDIS_URL': 'redis://localhost', 'MINIO_ENDPOINT': 'localhost:9000', 'MINIO_ACCESS_KEY': 'x', 'MINIO_SECRET_KEY': 'x'})
from shared.image_privacy import apply_privacy_blur
from utils.image_processing import apply_privacy_blur as reexported
assert apply_privacy_blur is reexported
print('ok')
"
```

Expected: `ok` (requires Pillow in your environment; `pip install Pillow` if missing).

Run: `pytest tests -q`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add shared/shared/image_privacy.py services/api/utils/image_processing.py
git commit -m "Move privacy blur helper to shared for reuse by gundi-sync"
```

---

### Task 4: Worker mapping module (pure, test-driven)

All Gundi payload construction is pure Python in one module with no third-party imports, so tests exercise it directly.

**Files:**
- Create: `services/gundi-sync/mapping.py`
- Test: `tests/gundi_sync/__init__.py` (empty), `tests/gundi_sync/test_mapping.py`

**Interfaces:**
- Produces (Task 6 and 7 consume these exact signatures):
  - `event_type_for(species: str) -> str` ("person" -> "camera_trap_person", "vehicle" -> "camera_trap_vehicle", anything else -> "camera_trap_animal")
  - `group_key(pool_id: str, species: str, event_start: datetime) -> str`
  - `to_utc_iso(naive_camera_time: datetime, tz: ZoneInfo) -> str` (format `%Y-%m-%dT%H:%M:%SZ`)
  - `build_event_payload(*, species, event_start, event_end, event_count, image_count, source, lat, lon, site_name, camera_label, tz, scientific_name=None, confidence=None, is_verified=False) -> dict` (raises `GundiMappingError` when lat or lon is None)
  - `parse_create_event_response(body: Any) -> str` (raises `GundiRequestParseError` on anything without an object_id)
  - exceptions `GundiMappingError`, `GundiRequestParseError`

- [ ] **Step 1: Write the failing tests**

Create `tests/gundi_sync/__init__.py` (empty) and `tests/gundi_sync/test_mapping.py`:

```python
"""Tests for the gundi-sync payload mapping (pure functions, no I/O)."""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

# Add the worker service to the path so we can import mapping directly.
_svc = os.path.join(os.path.dirname(__file__), "..", "..", "services", "gundi-sync")
_svc = os.path.abspath(_svc)
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from mapping import (  # noqa: E402
    GundiMappingError,
    GundiRequestParseError,
    build_event_payload,
    event_type_for,
    group_key,
    parse_create_event_response,
    to_utc_iso,
)

AMS = ZoneInfo("Europe/Amsterdam")


class TestEventTypeFor:
    def test_animal_species(self):
        assert event_type_for("red fox") == "camera_trap_animal"

    def test_person(self):
        assert event_type_for("person") == "camera_trap_person"

    def test_vehicle(self):
        assert event_type_for("vehicle") == "camera_trap_vehicle"


class TestGroupKey:
    def test_format_is_stable(self):
        key = group_key("s12", "red fox", datetime(2026, 7, 1, 8, 30, 0))
        assert key == "s12:red fox:2026-07-01T08:30:00"


class TestToUtcIso:
    def test_summer_time_offset(self):
        # 08:30 Amsterdam summer time is 06:30 UTC.
        assert to_utc_iso(datetime(2026, 7, 1, 8, 30, 0), AMS) == "2026-07-01T06:30:00Z"

    def test_utc_passthrough(self):
        assert to_utc_iso(datetime(2026, 1, 1, 12, 0, 0), ZoneInfo("UTC")) == "2026-01-01T12:00:00Z"


def _payload(**overrides):
    kwargs = dict(
        species="red fox",
        event_start=datetime(2026, 7, 1, 8, 30, 0),
        event_end=datetime(2026, 7, 1, 8, 42, 0),
        event_count=2,
        image_count=5,
        source="CAM-012",
        lat=52.1,
        lon=5.2,
        site_name="Site 4",
        camera_label="CAM-012",
        tz=AMS,
        scientific_name="Vulpes vulpes",
        confidence=0.87654,
        is_verified=False,
    )
    kwargs.update(overrides)
    return build_event_payload(**kwargs)


class TestBuildEventPayload:
    def test_top_level_fields(self):
        p = _payload()
        assert p["source"] == "CAM-012"
        assert p["title"] == "red fox at Site 4"
        assert p["event_type"] == "camera_trap_animal"
        assert p["recorded_at"] == "2026-07-01T06:30:00Z"
        assert p["location"] == {"lat": 52.1, "lon": 5.2}

    def test_details(self):
        d = _payload()["event_details"]
        assert d["species"] == "red fox"
        assert d["scientific_name"] == "Vulpes vulpes"
        assert d["animal_count"] == 2
        assert d["image_count"] == 5
        assert d["camera"] == "CAM-012"
        assert d["site"] == "Site 4"
        assert d["identified_by"] == "ai"
        assert d["confidence"] == 0.8765
        assert d["event_end"] == "2026-07-01T06:42:00Z"

    def test_verified_flag(self):
        assert _payload(is_verified=True)["event_details"]["identified_by"] == "human"

    def test_no_site_falls_back_to_camera(self):
        p = _payload(site_name=None)
        assert p["title"] == "red fox at camera CAM-012"
        assert "site" not in p["event_details"]

    def test_optional_fields_omitted(self):
        d = _payload(scientific_name=None, confidence=None)["event_details"]
        assert "scientific_name" not in d
        assert "confidence" not in d

    def test_missing_location_raises(self):
        with pytest.raises(GundiMappingError):
            _payload(lat=None)
        with pytest.raises(GundiMappingError):
            _payload(lon=None)


class TestParseCreateEventResponse:
    def test_dict_with_object_id(self):
        assert parse_create_event_response({"object_id": "abc-123"}) == "abc-123"

    def test_list_wrapper(self):
        assert parse_create_event_response([{"object_id": "abc-123"}]) == "abc-123"

    def test_missing_object_id_raises(self):
        with pytest.raises(GundiRequestParseError):
            parse_create_event_response({"ok": True})

    def test_empty_list_raises(self):
        with pytest.raises(GundiRequestParseError):
            parse_create_event_response([])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/gundi_sync/test_mapping.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'mapping'`

- [ ] **Step 3: Implement the module**

Create `services/gundi-sync/mapping.py`:

```python
"""
Pure mapping helpers: Connect event groups to Gundi event payloads.

No I/O and no third-party imports, so tests/gundi_sync/ can exercise
them directly. The Gundi payload shape is documented in
future-plans/gundi-export.md (verified against the Gundi v2 API docs).
"""
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

# Person and vehicle are MegaDetector categories, not species. They get
# their own event types so EarthRanger sites can style and route them
# separately from animal detections.
CATEGORY_EVENT_TYPES = {
    "person": "camera_trap_person",
    "vehicle": "camera_trap_vehicle",
}
ANIMAL_EVENT_TYPE = "camera_trap_animal"


class GundiMappingError(Exception):
    """A group cannot be mapped to a valid Gundi event payload."""


class GundiRequestParseError(Exception):
    """A Gundi API response did not have the expected shape."""


def event_type_for(species: str) -> str:
    return CATEGORY_EVENT_TYPES.get(species, ANIMAL_EVENT_TYPE)


def group_key(pool_id: str, species: str, event_start: datetime) -> str:
    """
    Stable identity of an independence-interval group, used as the
    idempotency key in the gundi_events ledger.
    """
    return f"{pool_id}:{species}:{event_start.isoformat()}"


def to_utc_iso(naive_camera_time: datetime, tz: ZoneInfo) -> str:
    """Interpret a naive camera-clock time in the server timezone, format for Gundi."""
    return (
        naive_camera_time.replace(tzinfo=tz)
        .astimezone(timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def build_event_payload(
    *,
    species: str,
    event_start: datetime,
    event_end: datetime,
    event_count: int,
    image_count: int,
    source: str,
    lat: Optional[float],
    lon: Optional[float],
    site_name: Optional[str],
    camera_label: str,
    tz: ZoneInfo,
    scientific_name: Optional[str] = None,
    confidence: Optional[float] = None,
    is_verified: bool = False,
) -> dict:
    """
    One Gundi event per independence-interval group. Raises
    GundiMappingError when there is no location: Gundi requires one,
    and a ranger-map event without coordinates is meaningless.
    """
    if lat is None or lon is None:
        raise GundiMappingError("group has no deployment location")

    details: dict[str, Any] = {
        "species": species,
        "animal_count": event_count,
        "image_count": image_count,
        "camera": camera_label,
        "identified_by": "human" if is_verified else "ai",
        "event_start": to_utc_iso(event_start, tz),
        "event_end": to_utc_iso(event_end, tz),
    }
    if scientific_name:
        details["scientific_name"] = scientific_name
    if site_name:
        details["site"] = site_name
    if confidence is not None:
        details["confidence"] = round(confidence, 4)

    where = site_name if site_name else f"camera {camera_label}"
    return {
        "source": source,
        "title": f"{species} at {where}",
        "event_type": event_type_for(species),
        "recorded_at": to_utc_iso(event_start, tz),
        "location": {"lat": lat, "lon": lon},
        "event_details": details,
    }


def parse_create_event_response(body: Any) -> str:
    """
    Pull object_id out of a create-event response. Gundi returns a dict
    with object_id; tolerate a single-element list wrapper.
    """
    if isinstance(body, list) and body:
        body = body[0]
    if isinstance(body, dict):
        object_id = body.get("object_id")
        if object_id:
            return str(object_id)
    raise GundiRequestParseError(f"Unexpected Gundi create-event response: {body!r}")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/gundi_sync/test_mapping.py -q`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add services/gundi-sync/mapping.py tests/gundi_sync/
git commit -m "Add gundi-sync payload mapping with tests"
```

---

### Task 5: Gundi HTTP client

**Files:**
- Create: `services/gundi-sync/gundi_client.py`

**Interfaces:**
- Consumes: `mapping.parse_create_event_response`, `mapping.GundiRequestParseError`.
- Produces (Task 6 consumes): `GundiClient(endpoint_url: str, api_key: str)` with `create_event(payload: dict) -> str` (returns object_id) and `attach_file(object_id: str, filename: str, data: bytes) -> None`; exception `GundiRequestError`.

- [ ] **Step 1: Implement**

Create `services/gundi-sync/gundi_client.py`:

```python
"""
Minimal Gundi v2 API client for the sync worker.

Endpoints (verified against the Gundi v2 API docs, see
future-plans/gundi-export.md):
    POST {base}/v2/events/                          -> {"object_id": ...}
    POST {base}/v2/events/{object_id}/attachments/  (multipart)

Synchronous (requests), retries transient failures with exponential
backoff. 4xx responses are terminal: retrying a rejected payload can
only fail again.
"""
import time
from typing import Any, Optional

import requests

from shared.logger import get_logger

from mapping import GundiRequestParseError, parse_create_event_response

logger = get_logger("gundi_sync.client")

MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 30


class GundiRequestError(Exception):
    """A Gundi API call failed after retries (or terminally on 4xx)."""


class GundiClient:
    def __init__(self, endpoint_url: str, api_key: str):
        self.base_url = endpoint_url.rstrip("/")
        self.headers = {"apikey": api_key}

    def create_event(self, payload: dict) -> str:
        """POST one event, return Gundi's object_id."""
        response = self._request("post", f"{self.base_url}/v2/events/", json=payload)
        try:
            return parse_create_event_response(response.json())
        except (ValueError, GundiRequestParseError) as e:
            raise GundiRequestError(str(e))

    def attach_file(self, object_id: str, filename: str, data: bytes) -> None:
        """Attach one image file to an existing event."""
        self._request(
            "post",
            f"{self.base_url}/v2/events/{object_id}/attachments/",
            files={"file1": (filename, data, "image/jpeg")},
        )

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        last_error: Optional[Exception] = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = requests.request(
                    method, url, headers=self.headers,
                    timeout=REQUEST_TIMEOUT_SECONDS, **kwargs,
                )
            except requests.RequestException as e:
                last_error = e
            else:
                if response.status_code < 300:
                    return response
                if response.status_code < 500:
                    # Client error: retrying the same payload cannot help.
                    raise GundiRequestError(
                        f"Gundi returned {response.status_code} for {url}: "
                        f"{response.text[:500]}"
                    )
                last_error = GundiRequestError(
                    f"Gundi returned {response.status_code} for {url}"
                )
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(BACKOFF_BASE_SECONDS ** (attempt + 1))
        raise GundiRequestError(
            f"Gundi request failed after {MAX_ATTEMPTS} attempts: {last_error}"
        )
```

- [ ] **Step 2: Verify it parses**

Run: `python -m py_compile services/gundi-sync/gundi_client.py && echo ok`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add services/gundi-sync/gundi_client.py
git commit -m "Add Gundi HTTP client with retry and backoff"
```

---

### Task 6: gundi-sync worker, Dockerfile, compose entry

**Files:**
- Create: `services/gundi-sync/events.py`
- Create: `services/gundi-sync/worker.py`
- Create: `services/gundi-sync/Dockerfile`
- Create: `services/gundi-sync/requirements.txt`
- Modify: `docker-compose.yml` (add a `gundi-sync` service after the `bulk-upload` block, which ends at line 208)

**Interfaces:**
- Consumes: `shared.independence_sql.INDEPENDENCE_CTE` (Task 2), `shared.image_privacy.apply_privacy_blur` (Task 3), `mapping` (Task 4), `gundi_client` (Task 5), models and `QUEUE_GUNDI_BACKFILL` (Task 1), `shared.database.get_db_session`, `shared.storage.StorageClient` / `BUCKET_THUMBNAILS`.
- Produces: a worker that consumes `{"job_uuid": "..."}` messages from `gundi-sync-backfill`. The API (Task 7) only needs the queue name and the `GundiBackfillJob` row contract.

- [ ] **Step 1: Implement the group-loading module**

Create `services/gundi-sync/events.py`:

```python
"""
Event-group loading for the gundi-sync worker.

Reuses the shared independence-interval CTE so backfill grouping is
identical to the CamTrap DP export. All queries are synchronous: the
worker is a plain queue consumer like bulk-upload.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import text

from shared.classification_threshold import CLASSIFICATION_THRESHOLD_FILTER_SQL
from shared.independence_sql import INDEPENDENCE_CTE


def build_group_rows_query(has_start: bool, has_end: bool) -> str:
    filters = []
    if has_start:
        filters.append("AND i.captured_at >= :start_date")
    if has_end:
        filters.append("AND i.captured_at <= :end_date")
    joined = "\n      ".join(filters)
    cte = INDEPENDENCE_CTE.format(
        verified_filters=joined,
        unverified_filters=joined,
        pv_filters=joined,
        classification_filter=CLASSIFICATION_THRESHOLD_FILTER_SQL.strip(),
    )
    return f"""
    {cte}
    , event_boundaries AS (
        SELECT pool_id, species, event_id,
               MIN(ts) as event_start, MAX(ts) as event_end,
               MAX(img_count) as event_count
        FROM with_events
        GROUP BY pool_id, species, event_id
    )
    SELECT DISTINCT we.pool_id, we.species, we.event_id,
           eb.event_start, eb.event_end, eb.event_count,
           i.id as image_id, i.uuid as image_uuid, i.captured_at,
           i.deployment_id, i.camera_id
    FROM with_events we
    JOIN event_boundaries eb ON we.pool_id = eb.pool_id
        AND we.species = eb.species AND we.event_id = eb.event_id
    JOIN images i ON i.camera_id = we.camera_id AND i.captured_at = we.ts
    JOIN cameras c ON i.camera_id = c.id
    WHERE c.project_id = ANY(:project_ids)
    ORDER BY eb.event_start, we.pool_id, we.species, i.captured_at
    """


def load_event_groups(
    session,
    project_id: int,
    interval_minutes: int,
    start_date: Optional[datetime],
    end_date: Optional[datetime],
) -> list[dict]:
    """
    One dict per independence-interval group:
        {pool_id, species, event_start, event_end, event_count,
         images: [{image_id, image_uuid, captured_at,
                   deployment_id, camera_id}, ...]}
    With the interval disabled (0 minutes) every image becomes its own
    group, matching how the CamTrap DP export behaves.
    """
    params: dict = {"project_ids": [project_id], "interval": interval_minutes}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date

    rows = session.execute(
        text(build_group_rows_query(start_date is not None, end_date is not None)),
        params,
    ).all()

    groups: dict[tuple, dict] = {}
    for row in rows:
        key = (row.pool_id, row.species, row.event_id)
        group = groups.setdefault(key, {
            "pool_id": row.pool_id,
            "species": row.species,
            "event_start": row.event_start,
            "event_end": row.event_end,
            "event_count": row.event_count,
            "images": [],
        })
        group["images"].append({
            "image_id": row.image_id,
            "image_uuid": row.image_uuid,
            "captured_at": row.captured_at,
            "deployment_id": row.deployment_id,
            "camera_id": row.camera_id,
        })
    return list(groups.values())
```

- [ ] **Step 2: Implement the worker**

Create `services/gundi-sync/worker.py`:

```python
"""
Gundi sync worker (phase 1: backfill jobs).

Consumes gundi-sync-backfill, one message per GundiBackfillJob:
    {"job_uuid": "..."}
For each job: group the project's images with the shared independence
CTE, create one Gundi event per group (idempotent via the gundi_events
ledger), attach blurred thumbnails, and update the job counters that
the frontend polls. See future-plans/gundi-export.md.
"""
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from shared.database import get_db_session
from shared.image_privacy import apply_privacy_blur
from shared.logger import get_logger
from shared.models import (
    Camera,
    Detection,
    GundiAttachment,
    GundiBackfillJob,
    GundiEvent,
    GundiIntegration,
    Image,
    Project,
    ServerSettings,
    SpeciesTaxonomy,
)
from shared.queue import QUEUE_GUNDI_BACKFILL, RedisQueue
from shared.storage import BUCKET_THUMBNAILS, StorageClient

from events import load_event_groups
from gundi_client import GundiClient, GundiRequestError
from mapping import GundiMappingError, build_event_payload, group_key

logger = get_logger("gundi_sync.worker")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _server_tz(session) -> ZoneInfo:
    name = session.execute(select(ServerSettings.timezone).limit(1)).scalar_one_or_none()
    return ZoneInfo(name) if name else ZoneInfo("UTC")


def _taxonomy(session) -> dict:
    rows = session.execute(
        select(SpeciesTaxonomy.common_name, SpeciesTaxonomy.scientific_name)
    ).all()
    return {row.common_name: row.scientific_name for row in rows if row.scientific_name}


def _deployment_location(session, deployment_id: int) -> tuple:
    """(lat, lon, site_name) of a deployment; (None, None, None) if unresolvable."""
    row = session.execute(
        text(
            """
            SELECT ST_Y(d.location::geometry) AS lat,
                   ST_X(d.location::geometry) AS lon,
                   s.name AS site_name
            FROM deployments d
            LEFT JOIN sites s ON d.site_id = s.id
            WHERE d.id = :dep_id
            """
        ),
        {"dep_id": deployment_id},
    ).first()
    if row is None or row.lat is None or row.lon is None:
        return None, None, row.site_name if row else None
    return row.lat, row.lon, row.site_name


def _load_images(session, image_uuids: list) -> list:
    return list(
        session.execute(
            select(Image)
            .options(selectinload(Image.detections).selectinload(Detection.classifications))
            .where(Image.uuid.in_(image_uuids))
        ).scalars()
    )


def _top_confidence(images: list, species: str) -> Optional[float]:
    """Highest matching AI confidence across the group's images."""
    best: Optional[float] = None
    for image in images:
        for detection in image.detections:
            if species in ("person", "vehicle"):
                if detection.category == species:
                    best = max(best or 0.0, detection.confidence)
            else:
                for classification in detection.classifications:
                    if classification.species == species:
                        best = max(best or 0.0, classification.confidence)
    return best


def _send_attachment(session, client, storage, project, ledger, image) -> bool:
    row = session.execute(
        select(GundiAttachment).where(
            GundiAttachment.gundi_event_id == ledger.id,
            GundiAttachment.image_id == image.id,
        )
    ).scalar_one_or_none()
    if row is not None and row.status == "sent":
        return True
    if row is None:
        row = GundiAttachment(gundi_event_id=ledger.id, image_id=image.id, status="pending")
        session.add(row)
        session.commit()

    if not image.thumbnail_path:
        row.status = "failed"
        row.last_error = "image has no thumbnail"
        session.commit()
        return False

    try:
        data = storage.download_fileobj(BUCKET_THUMBNAILS, image.thumbnail_path)
        if project.blur_people_vehicles:
            regions = [
                d.bbox for d in image.detections
                if d.category in ("person", "vehicle")
                and d.confidence >= project.detection_threshold
            ]
            data = apply_privacy_blur(data, regions)
        client.attach_file(ledger.gundi_object_id, f"{image.uuid}.jpg", data)
    except Exception as e:
        row.status = "failed"
        row.last_error = str(e)[:2000]
        session.commit()
        logger.warning(
            "Gundi attachment failed",
            image_uuid=image.uuid,
            gundi_object_id=ledger.gundi_object_id,
            error=str(e),
        )
        return False

    row.status = "sent"
    row.last_error = None
    session.commit()
    return True


def _send_group(session, client, storage, project, group, tz, taxonomy, cameras) -> bool:
    """
    Deliver one group. Returns True when the event and all its
    attachments are in Gundi. Idempotent: 'sent' ledger rows are
    skipped, a ledger row with an object_id but failed attachments
    retries only the attachments.
    """
    key = group_key(group["pool_id"], group["species"], group["event_start"])
    ledger = session.execute(
        select(GundiEvent).where(
            GundiEvent.project_id == project.id,
            GundiEvent.group_key == key,
        )
    ).scalar_one_or_none()
    if ledger is not None and ledger.status == "sent":
        return True

    if ledger is None:
        ledger = GundiEvent(
            project_id=project.id,
            group_key=key,
            species=group["species"],
            event_start=group["event_start"],
            event_end=group["event_end"],
            image_count=len(group["images"]),
            status="pending",
        )
        session.add(ledger)
        session.commit()

    images = _load_images(session, [i["image_uuid"] for i in group["images"]])
    first = group["images"][0]
    lat = lon = site_name = None
    if first["deployment_id"] is not None:
        lat, lon, site_name = _deployment_location(session, first["deployment_id"])
    camera_label = cameras.get(first["camera_id"], str(first["camera_id"]))

    try:
        if ledger.gundi_object_id is None:
            payload = build_event_payload(
                species=group["species"],
                event_start=group["event_start"],
                event_end=group["event_end"],
                event_count=group["event_count"],
                image_count=len(images),
                source=camera_label,
                lat=lat,
                lon=lon,
                site_name=site_name,
                camera_label=camera_label,
                tz=tz,
                scientific_name=taxonomy.get(group["species"]),
                confidence=_top_confidence(images, group["species"]),
                is_verified=bool(images) and all(img.is_verified for img in images),
            )
            ledger.gundi_object_id = client.create_event(payload)
            session.commit()
    except (GundiMappingError, GundiRequestError) as e:
        ledger.status = "failed"
        ledger.retry_count += 1
        ledger.last_error = str(e)[:2000]
        session.commit()
        logger.warning("Gundi event failed", group_key=key, error=str(e))
        return False

    all_attached = True
    for image in images:
        all_attached = _send_attachment(session, client, storage, project, ledger, image) and all_attached

    ledger.status = "sent" if all_attached else "failed"
    ledger.retry_count += 0 if all_attached else 1
    ledger.last_error = None if all_attached else "one or more attachments failed"
    ledger.sent_at = _now() if all_attached else ledger.sent_at
    session.commit()
    return all_attached


def process_backfill_job(job_uuid: str) -> None:
    with get_db_session() as session:
        job = session.execute(
            select(GundiBackfillJob).where(GundiBackfillJob.uuid == job_uuid)
        ).scalar_one_or_none()
        if job is None:
            logger.warning("Gundi backfill job not found", job_uuid=job_uuid)
            return
        if job.status not in ("queued",):
            logger.info("Gundi backfill job not in queued state, skipping",
                        job_uuid=job_uuid, status=job.status)
            return

        integration = session.execute(
            select(GundiIntegration).where(GundiIntegration.project_id == job.project_id)
        ).scalar_one_or_none()
        if integration is None:
            job.status = "failed"
            job.error_message = "Gundi integration is not configured"
            job.finished_at = _now()
            session.commit()
            return

        project = session.get(Project, job.project_id)
        job.status = "processing"
        job.started_at = _now()
        session.commit()

        try:
            groups = load_event_groups(
                session, job.project_id,
                project.independence_interval_minutes,
                job.start_date, job.end_date,
            )
            job.total_events = len(groups)
            session.commit()

            client = GundiClient(integration.endpoint_url, integration.api_key)
            storage = StorageClient()
            tz = _server_tz(session)
            taxonomy = _taxonomy(session)
            cameras = {
                c.id: (c.device_id or f"camera-{c.id}")
                for c in session.execute(
                    select(Camera).where(Camera.project_id == job.project_id)
                ).scalars()
            }

            sent = failed = 0
            for group in groups:
                if _send_group(session, client, storage, project, group, tz, taxonomy, cameras):
                    sent += 1
                else:
                    failed += 1
                job.sent_events = sent
                job.failed_events = failed
                session.commit()

            job.status = "done"
            if failed:
                job.error_message = (
                    f"{failed} of {len(groups)} events failed; "
                    "run the export again to retry them"
                )
            job.finished_at = _now()

            integration.events_sent = integration.events_sent + sent
            integration.last_synced_at = _now()
            integration.last_error = job.error_message
            integration.health_status = "healthy" if not failed else "error"
            session.commit()
        except Exception as e:
            logger.error("Gundi backfill job crashed", job_uuid=job_uuid,
                         error=str(e), exc_info=True)
            job.status = "failed"
            job.error_message = str(e)[:2000]
            job.finished_at = _now()
            integration.last_error = job.error_message
            integration.health_status = "error"
            session.commit()


def _recover_stuck_jobs() -> None:
    """
    Re-publish jobs a container restart left behind. The ledger makes
    reprocessing idempotent, so resetting 'processing' back to 'queued'
    and re-running is safe.
    """
    with get_db_session() as session:
        rows = session.execute(
            select(GundiBackfillJob).where(
                GundiBackfillJob.status.in_(("queued", "processing"))
            )
        ).scalars().all()
        uuids = []
        for job in rows:
            job.status = "queued"
            uuids.append(job.uuid)
        session.commit()
    if not uuids:
        return
    queue = RedisQueue(QUEUE_GUNDI_BACKFILL)
    for job_uuid in uuids:
        logger.info("Recovering gundi backfill job", job_uuid=job_uuid)
        queue.publish({"job_uuid": job_uuid})


def dispatch(message: dict) -> None:
    job_uuid = message.get("job_uuid")
    if not job_uuid:
        logger.error("Malformed gundi-sync message", message=message)
        return
    process_backfill_job(job_uuid)


def main() -> None:
    logger.info("Gundi sync worker starting")
    try:
        _recover_stuck_jobs()
    except Exception as exc:
        logger.error("Stuck-job recovery failed, continuing to queue loop",
                     error=str(exc), exc_info=True)
    queue = RedisQueue(QUEUE_GUNDI_BACKFILL)
    queue.consume_forever(dispatch)


if __name__ == "__main__":
    main()
```

Note: `_recover_stuck_jobs` can double-publish a message for a job whose original message is still queued; `process_backfill_job` ignores anything not in `queued` state after the first run flips it, and the ledger absorbs the rest. Check `shared/database.py` for `get_db_session` semantics before finishing (the bulk-upload worker uses it the same way; if it commits on exit, the explicit commits here are still correct).

- [ ] **Step 3: Dockerfile and requirements**

Create `services/gundi-sync/requirements.txt`:

```
# Shared runtime deps come from the shared package (shared/pyproject.toml).
# Only service-specific deps go here.
requests==2.31.0
Pillow==10.1.0
```

Create `services/gundi-sync/Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir setuptools wheel

# Shared library used by every service.
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Service deps.
COPY services/gundi-sync/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/gundi-sync .

CMD ["python", "worker.py"]
```

- [ ] **Step 4: Compose entry**

In `docker-compose.yml`, after the `bulk-upload` service block (ends around line 208), add:

```yaml
  gundi-sync:
    build:
      context: .
      dockerfile: services/gundi-sync/Dockerfile
    container_name: addaxai-gundi-sync
    restart: unless-stopped
    profiles: [deepfaune, speciesnet]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}
      MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
      LOG_FORMAT: ${LOG_FORMAT:-json}
      ENVIRONMENT: ${ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    networks:
      - addaxai-network
```

- [ ] **Step 5: Verify**

```bash
python -m py_compile services/gundi-sync/events.py services/gundi-sync/worker.py && echo ok
docker compose config -q && echo compose-ok
pytest tests -q
```

Expected: `ok`, `compose-ok`, all tests pass. (If `docker compose` is unavailable in the environment, note that in the task report instead of skipping silently.)

- [ ] **Step 6: Commit**

```bash
git add services/gundi-sync docker-compose.yml
git commit -m "Add gundi-sync worker service for backfill jobs"
```

---

### Task 7: API router

**Files:**
- Create: `services/api/routers/gundi.py`
- Modify: `services/api/main.py` (router imports and the `include_router` list at lines 155-179)
- Test: `tests/api/test_gundi_router_helpers.py`

**Interfaces:**
- Consumes: models and queue name from Task 1, `require_project_admin_access` from `auth.permissions`, `get_async_session` from `shared.database`.
- Produces endpoints (frontend Tasks 8-10 consume these exact paths and shapes):
  - `GET  /api/projects/{project_id}/gundi/config` -> `GundiConfigResponse`
  - `POST /api/projects/{project_id}/gundi/configure` body `{api_key, endpoint_url}` -> `GundiConfigResponse`
  - `DELETE /api/projects/{project_id}/gundi` -> `{"message": ...}`
  - `POST /api/projects/{project_id}/gundi/health` -> `GundiConfigResponse`
  - `POST /api/projects/{project_id}/gundi/backfill` body `{start_date?, end_date?}` -> `GundiBackfillJobResponse` (201)
  - `GET  /api/projects/{project_id}/gundi/backfill` -> `list[GundiBackfillJobResponse]` (10 most recent)
  - `GET  /api/projects/{project_id}/gundi/backfill/{job_uuid}` -> `GundiBackfillJobResponse`

- [ ] **Step 1: Write the failing helper tests**

Create `tests/api/test_gundi_router_helpers.py`. Same pattern as `test_bulk_upload_helpers.py`: copy the two pure helpers so the test does not drag in the FastAPI app. The copies MUST stay in sync with `services/api/routers/gundi.py`.

```python
"""
Unit tests for the gundi router's pure helpers.

Copies _to_naive and _validate_range from services/api/routers/gundi.py
to test them without dragging in the FastAPI app. Same pattern as
test_bulk_upload_helpers.py.
"""
from datetime import datetime, timezone
from typing import Optional

import pytest


class RangeError(Exception):
    pass


# --- copy of _to_naive ---
def _to_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=None)


# --- copy of _validate_range's logic (HTTPException swapped for RangeError) ---
def _validate_range(start: Optional[datetime], end: Optional[datetime]) -> None:
    if start and end and start > end:
        raise RangeError("start_date must be before end_date")


class TestToNaive:
    def test_none(self):
        assert _to_naive(None) is None

    def test_strips_timezone(self):
        aware = datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc)
        assert _to_naive(aware) == datetime(2026, 7, 1, 8, 0)

    def test_naive_passthrough(self):
        naive = datetime(2026, 7, 1, 8, 0)
        assert _to_naive(naive) == naive


class TestValidateRange:
    def test_valid_range(self):
        _validate_range(datetime(2026, 1, 1), datetime(2026, 2, 1))

    def test_open_ended(self):
        _validate_range(None, None)
        _validate_range(datetime(2026, 1, 1), None)
        _validate_range(None, datetime(2026, 1, 1))

    def test_inverted_raises(self):
        with pytest.raises(RangeError):
            _validate_range(datetime(2026, 2, 1), datetime(2026, 1, 1))
```

- [ ] **Step 2: Run tests (they pass as pure copies; that is expected)**

Run: `pytest tests/api/test_gundi_router_helpers.py -q`
Expected: PASS (these lock the helper contract; the router must match them).

- [ ] **Step 3: Implement the router**

Create `services/api/routers/gundi.py`:

```python
"""
Gundi integration endpoints (project-admin only).

Config follows the Telegram pattern (DB row + validate-on-save + health
check) but per project; backfill follows the BulkUploadJob pattern (job
row + Redis publish + polling endpoint). See future-plans/gundi-export.md.
"""
import uuid as uuid_module
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import GundiBackfillJob, GundiIntegration, User
from shared.queue import QUEUE_GUNDI_BACKFILL, RedisQueue
from auth.permissions import require_project_admin_access

router = APIRouter(prefix="/api/projects/{project_id}/gundi", tags=["gundi"])
logger = get_logger("api.gundi")

DEFAULT_ENDPOINT_URL = "https://sensors.api.gundiservice.org"


class GundiConfigResponse(BaseModel):
    """Config as shown to the frontend. Never contains the API key."""
    is_configured: bool
    endpoint_url: Optional[str] = None
    sync_enabled: bool = False
    health_status: Optional[str] = None
    last_health_check: Optional[datetime] = None
    events_sent: int = 0
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None


class GundiConfigureRequest(BaseModel):
    api_key: str
    endpoint_url: str = DEFAULT_ENDPOINT_URL


class GundiBackfillRequest(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class GundiBackfillJobResponse(BaseModel):
    uuid: str
    status: str
    total_events: int
    sent_events: int
    failed_events: int
    error_message: Optional[str]
    start_date: Optional[datetime]
    end_date: Optional[datetime]
    created_at: datetime
    finished_at: Optional[datetime]

    class Config:
        from_attributes = True


def _to_naive(dt: Optional[datetime]) -> Optional[datetime]:
    """Image.captured_at is naive camera-clock time; compare like with like."""
    if dt is None:
        return None
    return dt.replace(tzinfo=None)


def _validate_range(start: Optional[datetime], end: Optional[datetime]) -> None:
    if start and end and start > end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be before end_date",
        )


def _config_response(integration: Optional[GundiIntegration]) -> GundiConfigResponse:
    if integration is None:
        return GundiConfigResponse(is_configured=False)
    return GundiConfigResponse(
        is_configured=True,
        endpoint_url=integration.endpoint_url,
        sync_enabled=integration.sync_enabled,
        health_status=integration.health_status,
        last_health_check=integration.last_health_check,
        events_sent=integration.events_sent,
        last_synced_at=integration.last_synced_at,
        last_error=integration.last_error,
    )


async def _get_integration(db: AsyncSession, project_id: int) -> Optional[GundiIntegration]:
    result = await db.execute(
        select(GundiIntegration).where(GundiIntegration.project_id == project_id)
    )
    return result.scalar_one_or_none()


async def _check_gundi_reachable(endpoint_url: str, api_key: str) -> None:
    """
    Best-effort credential check. Gundi has no documented ping endpoint,
    so GET the events collection: 401/403 means the key is bad, any
    other response means the service is reachable with this key.
    """
    url = f"{endpoint_url.rstrip('/')}/v2/events/"
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers={"apikey": api_key}, timeout=10)
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to Gundi: {e}",
        )
    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gundi rejected the API key. Check the key and try again.",
        )


@router.get("/config", response_model=GundiConfigResponse)
async def get_gundi_config(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Current Gundi configuration for the project (no API key exposure)."""
    return _config_response(await _get_integration(db, project_id))


@router.post("/configure", response_model=GundiConfigResponse,
             status_code=status.HTTP_201_CREATED)
async def configure_gundi(
    project_id: int,
    data: GundiConfigureRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Save (or replace) the project's Gundi connection. The API key comes
    from a Connection created in the Gundi Portal. Validates the key
    against Gundi before saving.
    """
    await _check_gundi_reachable(data.endpoint_url, data.api_key)

    integration = await _get_integration(db, project_id)
    now = datetime.now(timezone.utc)
    if integration:
        integration.endpoint_url = data.endpoint_url
        integration.api_key = data.api_key
        integration.health_status = "healthy"
        integration.last_health_check = now
        integration.last_error = None
    else:
        integration = GundiIntegration(
            project_id=project_id,
            endpoint_url=data.endpoint_url,
            api_key=data.api_key,
            health_status="healthy",
            last_health_check=now,
        )
        db.add(integration)
    await db.commit()
    await db.refresh(integration)
    return _config_response(integration)


@router.delete("", status_code=status.HTTP_200_OK)
async def remove_gundi(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Remove the connection. The gundi_events ledger is kept on purpose:
    it is what prevents duplicate events in EarthRanger if the project
    reconnects and backfills again.
    """
    integration = await _get_integration(db, project_id)
    if integration:
        await db.delete(integration)
        await db.commit()
    return {"message": "Gundi configuration removed"}


@router.post("/health", response_model=GundiConfigResponse)
async def check_gundi_health(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Re-validate the stored key against Gundi and update health fields."""
    integration = await _get_integration(db, project_id)
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gundi is not configured for this project",
        )
    try:
        await _check_gundi_reachable(integration.endpoint_url, integration.api_key)
    except HTTPException as e:
        integration.health_status = "error"
        integration.last_health_check = datetime.now(timezone.utc)
        integration.last_error = e.detail
        await db.commit()
        raise
    integration.health_status = "healthy"
    integration.last_health_check = datetime.now(timezone.utc)
    integration.last_error = None
    await db.commit()
    await db.refresh(integration)
    return _config_response(integration)


@router.post("/backfill", response_model=GundiBackfillJobResponse,
             status_code=status.HTTP_201_CREATED)
async def create_backfill_job(
    project_id: int,
    data: GundiBackfillRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Queue a "send date range to Gundi" job for the gundi-sync worker."""
    integration = await _get_integration(db, project_id)
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Configure Gundi in project settings before exporting",
        )

    start = _to_naive(data.start_date)
    end = _to_naive(data.end_date)
    _validate_range(start, end)

    active = await db.execute(
        select(GundiBackfillJob).where(
            GundiBackfillJob.project_id == project_id,
            GundiBackfillJob.status.in_(("queued", "processing")),
        )
    )
    if active.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A Gundi export is already running for this project",
        )

    job = GundiBackfillJob(
        uuid=str(uuid_module.uuid4()),
        project_id=project_id,
        created_by_user_id=user.id,
        start_date=start,
        end_date=end,
        status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    RedisQueue(QUEUE_GUNDI_BACKFILL).publish({"job_uuid": job.uuid})
    logger.info("Gundi backfill job queued", project_id=project_id, job_uuid=job.uuid)
    return job


@router.get("/backfill", response_model=List[GundiBackfillJobResponse])
async def list_backfill_jobs(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Ten most recent jobs, newest first; the frontend polls this."""
    result = await db.execute(
        select(GundiBackfillJob)
        .where(GundiBackfillJob.project_id == project_id)
        .order_by(GundiBackfillJob.created_at.desc())
        .limit(10)
    )
    return list(result.scalars())


@router.get("/backfill/{job_uuid}", response_model=GundiBackfillJobResponse)
async def get_backfill_job(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    result = await db.execute(
        select(GundiBackfillJob).where(
            GundiBackfillJob.project_id == project_id,
            GundiBackfillJob.uuid == job_uuid,
        )
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gundi export job not found",
        )
    return job
```

- [ ] **Step 4: Register the router**

In `services/api/main.py`: add `gundi` to the existing `from routers import ...` statement (read the file to find its exact form), and after line `app.include_router(export.router)` add:

```python
app.include_router(gundi.router)
```

- [ ] **Step 5: Verify**

```bash
python -m py_compile services/api/routers/gundi.py && echo ok
pytest tests -q
```

Expected: `ok`, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/api/routers/gundi.py services/api/main.py tests/api/test_gundi_router_helpers.py
git commit -m "Add Gundi config and backfill endpoints"
```

---

### Task 8: Frontend API client

**Files:**
- Create: `services/frontend/src/api/gundi.ts`

**Interfaces:**
- Consumes: `apiClient` from `services/frontend/src/api/client.ts`, endpoints from Task 7.
- Produces (Tasks 9-10 consume): `gundiApi` and the `GundiConfig`, `GundiBackfillJob` interfaces exactly as below.

- [ ] **Step 1: Implement**

Create `services/frontend/src/api/gundi.ts`:

```typescript
/**
 * Gundi integration API client (project-admin endpoints).
 */
import apiClient from './client';

export interface GundiConfig {
  is_configured: boolean;
  endpoint_url: string | null;
  sync_enabled: boolean;
  health_status: string | null;
  last_health_check: string | null;
  events_sent: number;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface GundiBackfillJob {
  uuid: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  total_events: number;
  sent_events: number;
  failed_events: number;
  error_message: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  finished_at: string | null;
}

export const gundiApi = {
  getConfig: async (projectId: number): Promise<GundiConfig> => {
    const response = await apiClient.get(`/api/projects/${projectId}/gundi/config`);
    return response.data;
  },

  configure: async (projectId: number, apiKey: string, endpointUrl: string): Promise<GundiConfig> => {
    const response = await apiClient.post(`/api/projects/${projectId}/gundi/configure`, {
      api_key: apiKey,
      endpoint_url: endpointUrl,
    });
    return response.data;
  },

  remove: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/gundi`);
  },

  checkHealth: async (projectId: number): Promise<GundiConfig> => {
    const response = await apiClient.post(`/api/projects/${projectId}/gundi/health`);
    return response.data;
  },

  createBackfill: async (
    projectId: number,
    startDate?: string,
    endDate?: string,
  ): Promise<GundiBackfillJob> => {
    const response = await apiClient.post(`/api/projects/${projectId}/gundi/backfill`, {
      start_date: startDate || null,
      end_date: endDate || null,
    });
    return response.data;
  },

  listBackfills: async (projectId: number): Promise<GundiBackfillJob[]> => {
    const response = await apiClient.get(`/api/projects/${projectId}/gundi/backfill`);
    return response.data;
  },
};
```

- [ ] **Step 2: Verify the build**

Run: `cd services/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add services/frontend/src/api/gundi.ts
git commit -m "Add Gundi frontend API client"
```

---

### Task 9: Gundi card on the project settings page

**Files:**
- Create: `services/frontend/src/components/GundiIntegrationCard.tsx`
- Modify: `services/frontend/src/pages/admin/ProjectSettingsPage.tsx`

**Interfaces:**
- Consumes: `gundiApi`, `GundiConfig` (Task 8); `Card`, `CardContent`, `Button` from `components/ui/`; `@tanstack/react-query` (already used on this page).
- Produces: `<GundiIntegrationCard projectId={number} />`.

- [ ] **Step 1: Implement the card**

Create `services/frontend/src/components/GundiIntegrationCard.tsx`. If TypeScript complains about the plain `<input>` styling classes, match whatever input styling `ProjectSettingsPage.tsx` already uses (read it first).

```tsx
/**
 * Gundi (EarthRanger) integration card for the project settings page.
 *
 * Configure endpoint + API key, test the connection, remove, and show
 * sync status. Phase 1 of future-plans/gundi-export.md: exports run
 * from the exports page; there is no live sync toggle yet.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { gundiApi } from '../api/gundi';

const DEFAULT_ENDPOINT = 'https://sensors.api.gundiservice.org';
const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

interface Props {
  projectId: number;
}

export const GundiIntegrationCard: React.FC<Props> = ({ projectId }) => {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [endpointUrl, setEndpointUrl] = useState(DEFAULT_ENDPOINT);
  const [error, setError] = useState<string | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['gundi-config', projectId],
    queryFn: () => gundiApi.getConfig(projectId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['gundi-config', projectId] });

  const onError = (err: any) =>
    setError(err.response?.data?.detail || 'Gundi request failed');

  const configureMutation = useMutation({
    mutationFn: () => gundiApi.configure(projectId, apiKey, endpointUrl),
    onSuccess: () => {
      setApiKey('');
      setError(null);
      invalidate();
    },
    onError,
  });

  const healthMutation = useMutation({
    mutationFn: () => gundiApi.checkHealth(projectId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: any) => {
      onError(err);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => gundiApi.remove(projectId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });

  if (isLoading) return null;
  const busy =
    configureMutation.isPending || healthMutation.isPending || removeMutation.isPending;

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        <h3 className="text-sm font-medium">Gundi (EarthRanger)</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Send detections to EarthRanger and other platforms through Gundi.
          Create a connection in the Gundi portal and paste its API key here.
        </p>

        {config?.is_configured && (
          <div className="mt-4 text-sm space-y-1">
            <div className="flex items-center gap-2">
              {config.health_status === 'healthy' ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span>
                {config.health_status === 'healthy' ? 'Connected' : 'Connection problem'}
                {' to '}
                {config.endpoint_url}
              </span>
            </div>
            <p className="text-muted-foreground">
              {config.events_sent} events sent
              {config.last_synced_at &&
                `, last export ${new Date(config.last_synced_at).toLocaleString()}`}
            </p>
            {config.last_error && (
              <p className="text-destructive">{config.last_error}</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => healthMutation.mutate()}
              >
                Test connection
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => removeMutation.mutate()}
              >
                Remove
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-sm font-medium">Gundi endpoint</label>
            <input
              className={INPUT_CLASS}
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">API key</label>
            <input
              className={INPUT_CLASS}
              type="password"
              value={apiKey}
              placeholder={config?.is_configured ? 'Enter a new key to replace the saved one' : ''}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={busy || !apiKey || !endpointUrl}
            onClick={() => configureMutation.mutate()}
            className="gap-2"
          >
            {configureMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {config?.is_configured ? 'Update connection' : 'Connect'}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
```

Note: if the project's react-query version uses `isLoading` on mutations instead of `isPending` (v4 vs v5), check `services/frontend/package.json` and match it.

- [ ] **Step 2: Render it on the settings page**

In `services/frontend/src/pages/admin/ProjectSettingsPage.tsx`: import the card (`import { GundiIntegrationCard } from '../../components/GundiIntegrationCard';`), find the end of the page's main content (the last `Card` before the closing container div) and render below it:

```tsx
<GundiIntegrationCard projectId={parseInt(projectId || '0', 10)} />
```

Read the page first: it already derives the project id from `useParams`; reuse whatever parsed variable exists rather than parsing twice.

- [ ] **Step 3: Verify**

Run: `cd services/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/components/GundiIntegrationCard.tsx services/frontend/src/pages/admin/ProjectSettingsPage.tsx
git commit -m "Add Gundi integration card to project settings"
```

---

### Task 10: Send-to-Gundi section on the exports page

**Files:**
- Create: `services/frontend/src/components/GundiBackfillSection.tsx`
- Modify: `services/frontend/src/pages/ExportsPage.tsx`

**Interfaces:**
- Consumes: `gundiApi`, `GundiBackfillJob` (Task 8); `Button`, `Dialog` components; `useProject()` for `canAdminCurrentProject`.
- Produces: `<GundiBackfillSection projectId={number} />`, which renders nothing when Gundi is not configured.

- [ ] **Step 1: Implement the section**

Create `services/frontend/src/components/GundiBackfillSection.tsx`:

```tsx
/**
 * "Send to Gundi" section on the exports page.
 *
 * Renders nothing unless the project has a configured Gundi
 * integration. Creates a backfill job and polls the job list for
 * progress (bulk-upload polling pattern).
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Send } from 'lucide-react';
import { Button } from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import { gundiApi, GundiBackfillJob } from '../api/gundi';

const ACTIVE_STATUSES = new Set(['queued', 'processing']);
const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

interface Props {
  projectId: number;
}

function jobProgress(job: GundiBackfillJob): string {
  if (job.status === 'queued') return 'Waiting to start...';
  if (job.status === 'processing') {
    return `Sending ${job.sent_events + job.failed_events} of ${job.total_events} events...`;
  }
  if (job.status === 'failed') return job.error_message || 'Export failed';
  const failures = job.failed_events ? `, ${job.failed_events} failed` : '';
  return `Sent ${job.sent_events} of ${job.total_events} events${failures}`;
}

export const GundiBackfillSection: React.FC<Props> = ({ projectId }) => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const { data: config } = useQuery({
    queryKey: ['gundi-config', projectId],
    queryFn: () => gundiApi.getConfig(projectId),
  });

  const { data: jobs } = useQuery({
    queryKey: ['gundi-backfills', projectId],
    queryFn: () => gundiApi.listBackfills(projectId),
    enabled: !!config?.is_configured,
    refetchInterval: polling ? 2000 : false,
  });

  useEffect(() => {
    setPolling(!!jobs?.some((job) => ACTIVE_STATUSES.has(job.status)));
  }, [jobs]);

  const createMutation = useMutation({
    mutationFn: () =>
      gundiApi.createBackfill(
        projectId,
        startDate ? `${startDate}T00:00:00` : undefined,
        endDate ? `${endDate}T23:59:59` : undefined,
      ),
    onSuccess: () => {
      setDialogOpen(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['gundi-backfills', projectId] });
    },
    onError: (err: any) =>
      setError(err.response?.data?.detail || 'Failed to start the Gundi export'),
  });

  if (!config?.is_configured) return null;

  const latest = jobs?.[0];
  const active = latest && ACTIVE_STATUSES.has(latest.status);

  return (
    <>
      <div className="border-t my-6" />
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
          <div className="w-full sm:w-1/2 sm:shrink-0">
            <h3 className="text-sm font-medium">Send to Gundi</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Push detections to EarthRanger as events with image attachments.
            </p>
          </div>
          <div className="flex-1 sm:flex sm:justify-end">
            <Button
              type="button"
              disabled={!!active}
              onClick={() => setDialogOpen(true)}
              className="gap-2"
            >
              {active ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send
                </>
              )}
            </Button>
          </div>
        </div>
        {latest && (
          <p className="mt-2 text-sm text-muted-foreground">{jobProgress(latest)}</p>
        )}
        {error && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to Gundi</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Leave the dates empty to send everything. Events already sent in an
            earlier export are skipped automatically.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">From (optional)</label>
              <input
                className={INPUT_CLASS}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">To (optional)</label>
              <input
                className={INPUT_CLASS}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="gap-2"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Start export
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
```

Same react-query version note as Task 9 (`isPending` vs `isLoading`). Check how `Dialog` is used in `ProjectSettingsPage.tsx` and match its open/close API if it differs from `open`/`onOpenChange`.

- [ ] **Step 2: Render it on the exports page**

In `services/frontend/src/pages/ExportsPage.tsx`:
1. Import: `import { GundiBackfillSection } from '../components/GundiBackfillSection';`
2. Get the admin flag from the existing `useProject()` call: `const { selectedProject, canAdminCurrentProject } = useProject();`
3. After the final `ExportRow` (Camtrap DP, before `</CardContent>`), add:

```tsx
{canAdminCurrentProject && <GundiBackfillSection projectId={projectIdNum} />}
```

The section renders its own top divider, so no extra `<div className="border-t my-6" />` is needed.

- [ ] **Step 3: Verify**

Run: `cd services/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/components/GundiBackfillSection.tsx services/frontend/src/pages/ExportsPage.tsx
git commit -m "Add send-to-Gundi export section with job progress"
```

---

### Task 11: Documentation and final verification

**Files:**
- Create: `docs/gundi.md`
- Modify: `mkdocs.yml` (nav), `DEVELOPERS.md` (services list)

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the user documentation**

Create `docs/gundi.md`:

```markdown
# Export to Gundi (EarthRanger)

Connect can push detections to [Gundi](https://www.earthranger.com/),
EarthRanger's data-ingestion gateway. Each independence-interval event
group becomes one Gundi event with the group's blurred thumbnails
attached, so an animal visit shows up on the ranger map as a single
event with its images.

## Set up on the Gundi side first

1. Ask your EarthRanger administrator for access to the Gundi portal.
2. Create a connection for this Connect project and copy its API key.
3. Make sure the destination EarthRanger site has these event types
   defined: `camera_trap_animal`, `camera_trap_person`,
   `camera_trap_vehicle`.

## Connect the project

1. Open project settings as a project admin.
2. In the "Gundi (EarthRanger)" card, keep the default endpoint unless
   your Gundi contact gave you another one, paste the API key, and
   press Connect. Connect validates the key against Gundi before
   saving it.
3. Use "Test connection" any time to re-check the stored key.

## Send data

1. Open the exports page and press Send in the "Send to Gundi" row.
2. Pick a date range, or leave both dates empty to send everything.
3. Progress is shown live. Events that were already sent in an earlier
   export are skipped, so re-running a range never duplicates events
   in EarthRanger.

## What gets sent

- One event per independence-interval group (project settings control
  the interval; with the interval disabled every image is its own
  event).
- Event details: species (common and scientific name), animal count,
  top AI confidence, camera, site, image count, and whether the
  identification is AI or human-verified.
- Attachments: the group's thumbnails. When "blur people and vehicles"
  is enabled for the project, the blur is applied before upload.
- Person and vehicle detections are sent as their own event types.

## Troubleshooting

- "Gundi rejected the API key": the key was revoked or copied wrong.
  Create a new key in the Gundi portal and reconnect.
- Events failed in a finished export: the job report says how many.
  Run the same export again; only the failed events are retried.
- Groups without a deployment location are skipped and counted as
  failed, because Gundi events require coordinates.
```

- [ ] **Step 2: Add it to the docs nav and developer docs**

1. `grep -n "nav" -A 30 mkdocs.yml`, find where pages are listed, and add `- Gundi export: gundi.md` after the exports-related entry (or at the end of the user-facing section if there is none).
2. In `DEVELOPERS.md`, find the services list/table (search for `bulk-upload`) and add one line for `gundi-sync`: "pushes events and image attachments to Gundi (EarthRanger), consumes the gundi-sync-backfill queue".

- [ ] **Step 3: Full verification pass**

```bash
pytest tests -q
cd services/frontend && npm run build && cd ../..
docker compose config -q && echo compose-ok
git log --oneline main..HEAD
```

Expected: all tests pass, frontend builds, compose config valid, and the branch shows one commit per task.

- [ ] **Step 4: Commit**

```bash
git add docs/gundi.md mkdocs.yml DEVELOPERS.md
git commit -m "Document the Gundi export feature"
```

---

## Out of scope (phase 2 and 3, do not build now)

- Continuous sync (live queue, classification hook, `sync_enabled` toggle UI).
- PATCH updates to existing Gundi events (verification corrections).
- Per-integration filters (species/category selection, full-resolution toggle).

## Manual QA notes (after deployment to a dev stack)

- Configure against a real Gundi sandbox connection; the test-connection
  check is best effort (Gundi has no documented ping endpoint), so
  verify a real backfill of a small date range end to end and confirm
  the events and attachments appear in the destination EarthRanger site.
- Verify a re-run of the same range sends zero new events.
- Verify a person detection arrives blurred when the project has
  "blur people and vehicles" enabled.
