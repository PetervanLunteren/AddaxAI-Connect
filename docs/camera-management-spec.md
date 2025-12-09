# Camera Management Module - Implementation Specification

**Document Version:** 1.0
**Date:** December 9, 2025
**Status:** Planning Complete - Ready for Implementation

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Integration](#architecture-integration)
3. [Data Model](#data-model)
4. [Data Flow](#data-flow)
5. [API Specifications](#api-specifications)
6. [Implementation Phases](#implementation-phases)
7. [Testing Strategy](#testing-strategy)
8. [Deployment Considerations](#deployment-considerations)

---

## Overview

### Purpose

The Camera Management Module extends AddaxAI Connect with complete field operations capabilities for managing the physical camera trap infrastructure lifecycle. This module enables:

- **Planning:** Define camera placements with location, bearing, and coverage visualization
- **Provisioning:** Manage camera inventory, SIM cards, settings profiles, and firmware releases
- **Deployment:** Guided onboarding for field technicians via barcode scanning
- **Operation:** Automatic health monitoring from daily reports and image EXIF data
- **Maintenance:** Automated task generation from health thresholds with technician workflow
- **Optimization:** Compare planned vs actual placements and suggest repositioning

### Key Design Decisions

**1. Offline-First Approach**
- Settings and firmware updates delivered via SD card downloads (no OTA required)
- Field technician can download files during onboarding, copy to SD card on-site
- Reduces complexity and infrastructure requirements for V1

**2. Project-Based Multi-Tenancy**
- Each VM instance serves one organization with multiple projects
- All data scoped by `project_id` for isolation
- Users, cameras, SIMs, settings, firmware all project-scoped

**3. Identifier Strategy**
- **Primary identifier:** `cameras.serial_number` (equals IMEI from camera hardware)
- Found in EXIF `Serial Number` field for images
- Found in daily report `IMEI:` field
- No separate "printed camera ID" field needed (simplified vs original spec)

**4. Health Monitoring via Ingestion**
- Camera health auto-updated from daily reports (battery, SD, temperature, signal)
- Camera location auto-updated from image EXIF GPS and daily report GPS
- Unknown devices queued for admin claiming before becoming active

**5. Threshold-Based Maintenance**
- Project-level thresholds (battery low %, SD high %, silence hours)
- Background monitor generates tasks automatically
- Cooldown logic prevents duplicate tasks (24-hour window)

---

## Architecture Integration

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                     AddaxAI Connect Platform                    │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │  ML Pipeline     │         │  Camera Management Module    │ │
│  │  (Original)      │◄───────►│  (New)                       │ │
│  │                  │         │                              │ │
│  │ - Ingestion      │         │ - Camera Registry            │ │
│  │ - Detection      │         │ - SIM Inventory              │ │
│  │ - Classification │         │ - Placement Planning         │ │
│  │ - Alerts         │         │ - Maintenance Tasks          │ │
│  └──────────────────┘         │ - Settings/Firmware Library  │ │
│                               │ - Unknown Device Queue       │ │
│                               │ - Field Onboarding           │ │
│                               └──────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Shared Infrastructure                          │  │
│  │  PostgreSQL + PostGIS | Redis | MinIO | Prometheus      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Integration Points

**1. Enhanced Ingestion Service**
- **Original:** Watches FTPS, validates images, queues for detection
- **Enhanced:** Also processes daily reports, updates camera health, handles unknown devices
- **Changes:** Add file type detection, daily report parser, camera identifier matching

**2. Database Schema**
- **Original:** cameras, images, detections, classifications, users, alert_rules, alert_logs
- **New Tables:** projects, sims, camera_sim_assignments, settings_profiles, firmware_releases, placement_plans, maintenance_tasks, unknown_devices
- **Extended Tables:** Add project_id to cameras, users, images; add health/timestamp fields to cameras

**3. API Backend**
- **Original:** Image gallery, camera locations, statistics
- **New Endpoints:** 40+ endpoints for camera CRUD, SIM management, placement plans, maintenance tasks, onboarding

**4. Frontend**
- **Original:** Image gallery, map view, statistics dashboard
- **New Pages:** Camera registry, camera detail, placement planning map, maintenance list, SIM inventory, settings/firmware libraries, unknown devices queue, onboarding

---

## Data Model

### Entity Relationship Diagram

```
┌─────────────┐
│  Projects   │
│             │◄────────────────────┐
│ - name      │                     │
│ - defaults  │                     │
│ - thresholds│                     │
└──────┬──────┘                     │
       │                            │
       │ 1:N                        │
       │                            │
       ▼                            │
┌─────────────┐     1:N      ┌─────────────┐
│  Cameras    │◄─────────────│   Images    │
│             │              │             │
│ - serial_#  │              │ - uuid      │
│ - project_id│              │ - status    │
│ - status    │              │ - metadata  │
│ - battery_% │              └─────────────┘
│ - sd_used   │
│ - location  │
└──────┬──────┘
       │
       │ 1:N
       │
       ▼
┌─────────────┐     N:M      ┌─────────────┐
│  SIMs       │◄────────────►│ Camera-SIM  │
│             │              │ Assignments │
│ - iccid     │              │             │
│ - provider  │              │ - is_active │
│ - sub_dates │              └─────────────┘
└─────────────┘

┌─────────────┐     1:1      ┌─────────────┐
│  Cameras    │◄─────────────│ Placement   │
│             │              │ Plans       │
└─────────────┘              │             │
                             │ - planned   │
                             │ - actual    │
                             └─────────────┘

┌─────────────┐     1:N      ┌─────────────┐
│  Cameras    │◄─────────────│ Maintenance │
│             │              │ Tasks       │
└─────────────┘              │             │
                             │ - type      │
                             │ - priority  │
                             │ - status    │
                             └─────────────┘

┌─────────────┐     1:N      ┌─────────────┐
│  Projects   │◄─────────────│ Settings    │
│             │              │ Profiles    │
└─────────────┘              │             │
                             │ - file_path │
                             │ - status    │
                             └─────────────┘

┌─────────────┐     1:N      ┌─────────────┐
│  Projects   │◄─────────────│ Firmware    │
│             │              │ Releases    │
└─────────────┘              │             │
                             │ - version   │
                             │ - checksum  │
                             └─────────────┘
```

### Key Tables

#### Projects (New)
```sql
projects:
  id                              PRIMARY KEY
  name                            VARCHAR(255) NOT NULL
  description                     TEXT
  default_settings_profile_id     FK → settings_profiles.id
  default_firmware_id             FK → firmware_releases.id
  default_placement_fov           INTEGER (degrees)
  default_placement_range         INTEGER (meters)
  battery_low_threshold           INTEGER (%) DEFAULT 20
  sd_high_threshold               INTEGER (%) DEFAULT 80
  silence_threshold_hours         INTEGER DEFAULT 48
  is_active                       BOOLEAN
  created_at                      TIMESTAMP
```

#### Cameras (Extended)
```sql
cameras:
  # Original fields
  id                              PRIMARY KEY
  name                            VARCHAR(255) NOT NULL
  location                        GEOGRAPHY(POINT, 4326)
  installed_at                    TIMESTAMP
  config                          JSON

  # NEW: Identifiers
  serial_number                   VARCHAR(50) UNIQUE NOT NULL  ← Primary identifier (IMEI)
  imei                            VARCHAR(50) UNIQUE
  manufacturer                    VARCHAR(100)
  model                           VARCHAR(100)
  hardware_revision               VARCHAR(50)

  # NEW: Assignment
  project_id                      FK → projects.id
  status                          VARCHAR(50)  # inventory/assigned/deployed/suspended/retired

  # NEW: Health metrics (from daily reports)
  battery_percent                 INTEGER (0-100)
  sd_used_mb                      INTEGER
  sd_total_mb                     INTEGER
  temperature_c                   INTEGER
  signal_quality                  INTEGER (0-31)

  # NEW: Timestamps
  last_seen                       TIMESTAMP
  last_daily_report_at            TIMESTAMP
  last_image_at                   TIMESTAMP
  last_maintenance_at             TIMESTAMP

  # NEW: Metadata
  tags                            JSON (array of strings)
  notes                           TEXT
  created_at                      TIMESTAMP
  updated_at                      TIMESTAMP
```

#### Daily Report Data Structure
```python
# Parsed from TXT file: {IMEI}-{DDMMYYYY}{HHMMSS}-dr.txt
# Example: 861943070068027-05122025154647-dr.txt

DailyReport:
  imei: str                       # "861943070068027"
  csq: int                        # Signal quality 0-31
  temp: int                       # Temperature in °C
  date: datetime                  # "05/12/2025 15:46:47"
  battery: int                    # Battery % (0-100)
  sd_used_mb: int                 # 59405
  sd_total_mb: int                # 59628
  total_images: int               # Total captured
  images_sent: int                # Successfully transmitted
  gps_lat: float                  # 52.098737
  gps_lon: float                  # 5.125504
```

#### Image EXIF Data Structure
```python
# Extracted from JPEG EXIF metadata

ImageEXIF:
  serial_number: str              # "861943070068027" ← Primary identifier
  make: str                       # "Willfine"
  model: str                      # "4.0T CG Regular lens"
  datetime_original: datetime     # "2025:12:05 15:46:07"
  gps_latitude: float             # 52.098737 (from "52 deg 5' 55.56" N")
  gps_longitude: float            # 5.125504 (from "5 deg 7' 31.23" E")
  software: str                   # "R1.0"

  # Note: NO battery or SD utilization in image EXIF (only in daily reports)
```

---

## Data Flow

### 1. Daily Report Ingestion

```
FTPS Upload: 861943070068027-05122025154647-dr.txt
         ↓
Ingestion Service detects file (*.dr.txt pattern)
         ↓
Parse TXT file → extract key:value pairs
         ↓
{
  IMEI: "861943070068027",
  Battery: "60%",
  SD: "59405M/59628M",
  GPS: "52.098737,5.125504",
  ...
}
         ↓
Match camera by serial_number == IMEI
         ↓
┌─────────────────┬─────────────────────┐
│ FOUND           │ NOT FOUND           │
│ ↓               │ ↓                   │
│ Update camera:  │ Insert into         │
│ - battery_pct   │ unknown_devices:    │
│ - sd_used/total │ - serial_number     │
│ - temp, signal  │ - first_contact_at  │
│ - location (GPS)│ - gps_location      │
│ - last_daily_   │ - contact_count     │
│   report_at     │                     │
│ - last_seen     │ Alert admin         │
│ ↓               │                     │
│ Update          │                     │
│ placement_plan  │                     │
│ actual_location │                     │
│ ↓               │                     │
│ Trigger         │                     │
│ maintenance     │                     │
│ threshold check │                     │
└─────────────────┴─────────────────────┘
```

### 2. Image Ingestion with EXIF

```
FTPS Upload: E1000159.JPG
         ↓
Ingestion Service detects image
         ↓
Extract EXIF data
         ↓
{
  Serial Number: "861943070068027",
  GPS Position: "52.098737, 5.125504",
  Make: "Willfine",
  Model: "4.0T CG Regular lens",
  Date/Time Original: "2025:12:05 15:46:07"
}
         ↓
Match camera by serial_number
         ↓
┌─────────────────┬─────────────────────┐
│ FOUND           │ NOT FOUND           │
│ ↓               │ ↓                   │
│ Generate UUID   │ Add to              │
│ ↓               │ unknown_devices     │
│ Upload to MinIO │ (with EXIF data)    │
│ (raw-images)    │                     │
│ ↓               │ Alert admin         │
│ Create image    │                     │
│ record:         │                     │
│ - uuid          │                     │
│ - camera_id     │                     │
│ - project_id    │                     │
│ - status:pending│                     │
│ - metadata(EXIF)│                     │
│ ↓               │                     │
│ Update camera:  │                     │
│ - last_image_at │                     │
│ - last_seen     │                     │
│ - location (GPS)│                     │
│ ↓               │                     │
│ Update          │                     │
│ placement_plan  │                     │
│ actual_location │                     │
│ ↓               │                     │
│ Queue for       │                     │
│ detection       │                     │
│ (Redis LPUSH)   │                     │
└─────────────────┴─────────────────────┘
```

### 3. Maintenance Task Auto-Generation

```
Maintenance Monitor (runs every 15 minutes)
         ↓
Query all cameras (last_seen within 7 days)
         ↓
For each camera:
         ↓
┌─────────────────────────────────────────┐
│ Check battery_percent                   │
│ If < project.battery_low_threshold:     │
│   → Create task: battery_replacement    │
│      Priority: high if <10%, med if <20%│
│      Reason: "Battery at X%"            │
│                                         │
│ Check SD utilization                    │
│ If (sd_used/sd_total)*100 > sd_high_thr:│
│   → Create task: sd_swap                │
│      Priority: high if >95%, med if >80%│
│      Reason: "SD at X% full"            │
│                                         │
│ Check last_daily_report_at              │
│ If hours_since > silence_threshold:     │
│   → Create task: connectivity_investigation│
│      Priority: high if >72h, med if >48h│
│      Reason: "No report for X hours"    │
└─────────────────────────────────────────┘
         ↓
Before creating each task:
         ↓
Check if similar task exists
(same camera, same type, status=open/planned/in_progress, created within 24h)
         ↓
┌──────────────┬──────────────┐
│ EXISTS       │ NOT EXISTS   │
│ Skip         │ Create task  │
└──────────────┴──────────────┘
```

### 4. Field Onboarding Workflow

```
Field Technician uses mobile/tablet
         ↓
Scan barcode → Extract serial_number
         ↓
POST /api/onboarding/lookup-camera
  Body: { serial_number: "861943070068027" }
         ↓
Query cameras table
         ↓
┌───────────────────┬───────────────────┐
│ FOUND             │ NOT FOUND         │
│ ↓                 │ ↓                 │
│ Return camera +   │ Return error:     │
│ onboarding        │ "Not registered"  │
│ checklist:        │                   │
│                   │ Option: Create    │
│ ✓ Project assigned│ camera manually   │
│ ✗ SIM missing     │                   │
│ ✓ Settings selected│                  │
│ ✓ Firmware selected│                  │
│ ✓ Placement exists│                   │
│ ↓                 │                   │
│ Show downloads:   │                   │
│ - Settings file   │                   │
│ - Firmware file   │                   │
│ - Instructions    │                   │
│ ↓                 │                   │
│ Technician:       │                   │
│ 1. Assigns SIM    │                   │
│ 2. Downloads files│                   │
│ 3. Copies to SD   │                   │
│ 4. Installs camera│                   │
│ ↓                 │                   │
│ Mark as Deployed: │                   │
│ POST /api/onboard/│                   │
│   mark-deployed   │                   │
│ ↓                 │                   │
│ Update:           │                   │
│ - status=deployed │                   │
│ - installer, notes│                   │
└───────────────────┴───────────────────┘
```

---

## API Specifications

### Authentication

All API endpoints require JWT authentication (FastAPI-Users).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Role-Based Access:**
- `user`: Can view cameras, create tasks, use onboarding
- `admin` (is_superuser=true): Full access including delete, unknown devices, project management

### Project-Scoped Filtering

Most endpoints automatically filter by user's `project_id`:
```python
# In API endpoint
current_user_project_id = request.user.project_id
cameras = db.query(Camera).filter(Camera.project_id == current_user_project_id).all()
```

Admin users can query across projects with `?project_id=X` parameter.

### Example Endpoints

#### Camera Lookup (Onboarding)
```
POST /api/onboarding/lookup-camera
Request:
{
  "serial_number": "861943070068027"
}

Response (Success):
{
  "camera": {
    "id": 42,
    "serial_number": "861943070068027",
    "name": "Camera North Gate",
    "project_id": 5,
    "status": "assigned",
    "battery_percent": 75,
    "last_seen": "2025-12-09T10:30:00Z"
  },
  "onboarding_checklist": {
    "project_assigned": true,
    "sim_assigned": false,
    "settings_selected": true,
    "firmware_selected": true,
    "placement_plan_exists": true
  },
  "warnings": [
    "No SIM assigned"
  ],
  "placement_plan": {
    "planned_location": {"lat": 52.0987, "lon": 5.1255},
    "planned_bearing": 270,
    "planned_range": 20,
    "planned_fov": 60
  },
  "settings_profile": {
    "id": 10,
    "name": "Standard Day/Night",
    "version": "v1.2",
    "download_url": "/api/settings-profiles/10/download"
  },
  "firmware_release": {
    "id": 3,
    "version": "R1.5",
    "download_url": "/api/firmware-releases/3/download",
    "checksum_sha256": "abc123..."
  }
}

Response (Not Found):
{
  "error": "Camera not registered",
  "serial_number": "861943070068027"
}
```

#### Create Maintenance Task
```
POST /api/maintenance-tasks
Request:
{
  "camera_id": 42,
  "task_type": "battery_replacement",
  "priority": "high",
  "reason": "Battery at 15% (threshold: 20%)",
  "due_date": "2025-12-15",
  "assigned_to_user_id": null
}

Response:
{
  "id": 123,
  "camera_id": 42,
  "project_id": 5,
  "task_type": "battery_replacement",
  "priority": "high",
  "origin": "manual",
  "reason": "Battery at 15% (threshold: 20%)",
  "due_date": "2025-12-15",
  "status": "open",
  "created_at": "2025-12-09T12:00:00Z",
  "created_by_user_id": 7
}
```

#### Get Placement Plan Deviation
```
GET /api/placement-plans/99/deviation

Response:
{
  "placement_plan_id": 99,
  "camera_id": 42,
  "planned_location": {"lat": 52.0987, "lon": 5.1255},
  "actual_location": {"lat": 52.0989, "lon": 5.1258},
  "distance_meters": 28.3,
  "planned_bearing": 270,
  "actual_bearing": 285,
  "bearing_difference_degrees": 15
}
```

---

## Implementation Phases

### Phase 1: Database Migration (2-3 days)
**Goal:** Complete schema ready for camera management

**Tasks:**
1. Run Alembic migration: `alembic upgrade head`
2. Verify all tables created in PostgreSQL
3. Update `shared/shared/models.py` with SQLAlchemy model classes
4. Write unit tests for model relationships
5. Seed test data (projects, cameras, SIMs)

**Deliverable:** Database schema with camera management tables

---

### Phase 2: Enhanced Ingestion (4-5 days)
**Goal:** Process daily reports and handle unknown devices

**Tasks:**
1. Implement file type detection (*.jpg vs *-dr.txt)
2. Build daily report parser (key:value TXT format)
3. Build EXIF parser (use exiftool or Pillow)
4. Implement camera identifier matching logic
5. Implement unknown device handler
6. Update camera health from daily reports
7. Update camera location from EXIF GPS
8. Write unit tests with sample files from test-ftps-files/

**Deliverable:** Ingestion service handles images + daily reports

---

### Phase 3: Maintenance Engine (3-4 days)
**Goal:** Auto-generate tasks from thresholds

**Tasks:**
1. Build background scheduler (runs every 15 min)
2. Implement battery threshold check
3. Implement SD threshold check
4. Implement silence threshold check
5. Implement cooldown logic (prevent duplicates)
6. Expose Prometheus metrics
7. Write unit tests with mock camera data

**Deliverable:** Automated maintenance task generation

---

### Phase 4: Camera Management API (8-10 days)
**Goal:** REST API for all camera management operations

**Tasks:**
1. Implement Projects API (CRUD + list)
2. Implement Cameras API (extended with filters, bulk import)
3. Implement SIMs API (CRUD + assignment)
4. Implement Settings Profiles API (with file upload/download)
5. Implement Firmware Releases API (with file upload/download, checksum)
6. Implement Placement Plans API (CRUD + deviation calculation)
7. Implement Maintenance Tasks API (CRUD + status transitions)
8. Implement Unknown Devices API (list + claim)
9. Implement Onboarding API (lookup + mark deployed)
10. Write API tests (pytest with test database)

**Deliverable:** 40+ API endpoints documented and tested

---

### Phase 5: Camera Management Frontend (15-20 days)
**Goal:** Complete field operations UI

**Tasks:**
1. Camera Registry page (searchable table, filters, bulk actions)
2. Camera Detail page (all sections: identifiers, health, location, SIM, settings/firmware, placement, tasks, history)
3. Placement Planning Map (Leaflet with planned/actual markers)
4. Maintenance List page (filterable table, summary cards, task actions)
5. SIM Inventory page (table with filters, assign/unassign)
6. Settings Profiles Library (list, upload, download, instructions)
7. Firmware Releases Library (list, upload, download, checksum verification)
8. Unknown Devices Queue (list, claim workflow)
9. Camera Onboarding page (barcode scan, checklist, downloads, mark deployed)
10. Integrate all pages with API endpoints
11. Add WebSocket real-time updates (optional)

**Deliverable:** Complete camera management UI

---

### Phase 6: Testing & Refinement (4-5 days)
**Goal:** Comprehensive testing and bug fixes

**Tasks:**
1. Integration tests (end-to-end workflows)
2. E2E tests with Playwright (barcode onboarding, task creation)
3. Load tests (100+ cameras, maintenance monitor, map rendering)
4. User acceptance testing with field technicians
5. Bug fixes and UI polish

**Deliverable:** Production-ready camera management module

---

## Testing Strategy

### Unit Tests

**Ingestion Service:**
```python
def test_parse_daily_report():
    """Test daily report parsing"""
    content = """
    IMEI:861943070068027
    Battery:60%
    SD:59405M/59628M
    GPS:52.098737,5.125504
    """
    result = parse_daily_report(content)
    assert result['battery_percent'] == 60
    assert result['sd_used_mb'] == 59405

def test_extract_exif():
    """Test EXIF extraction"""
    exif = extract_exif('test-ftps-files/E1000159.JPG')
    assert exif['serial_number'] == '861943070068027'
    assert exif['gps_latitude'] == 52.098737

def test_match_camera_found():
    """Test camera matching when found"""
    camera = match_camera('861943070068027')
    assert camera is not None
    assert camera.serial_number == '861943070068027'

def test_match_camera_not_found():
    """Test unknown device handling"""
    camera = match_camera('unknown_serial')
    assert camera is None
    # Check unknown_devices table
    unknown = db.query(UnknownDevice).filter_by(serial_number='unknown_serial').first()
    assert unknown is not None
```

**Maintenance Engine:**
```python
def test_battery_threshold_creates_task():
    """Test low battery creates task"""
    camera = create_camera(battery_percent=15, project_id=1)
    check_maintenance_thresholds(camera)

    task = db.query(MaintenanceTask).filter_by(
        camera_id=camera.id,
        task_type='battery_replacement'
    ).first()

    assert task is not None
    assert task.priority == 'high'  # <10% = high

def test_cooldown_prevents_duplicate():
    """Test cooldown logic"""
    camera = create_camera(battery_percent=15)

    # First check creates task
    check_maintenance_thresholds(camera)
    tasks1 = db.query(MaintenanceTask).filter_by(camera_id=camera.id).count()

    # Second check within 24h should not create duplicate
    check_maintenance_thresholds(camera)
    tasks2 = db.query(MaintenanceTask).filter_by(camera_id=camera.id).count()

    assert tasks1 == tasks2  # Same count
```

### Integration Tests

```python
def test_daily_report_ingestion_end_to_end():
    """Test full daily report flow"""
    # Upload daily report via FTPS mock
    upload_file('test-ftps-files/861943070068027-05122025154647-dr.txt')

    # Wait for ingestion
    time.sleep(2)

    # Check camera updated
    camera = db.query(Camera).filter_by(serial_number='861943070068027').first()
    assert camera.battery_percent == 60
    assert camera.sd_used_mb == 59405
    assert camera.last_daily_report_at is not None

def test_unknown_device_claim_workflow():
    """Test unknown device claiming"""
    # Trigger unknown device
    upload_file_with_serial('unknown_serial_123')

    # Check queued
    unknown = db.query(UnknownDevice).filter_by(serial_number='unknown_serial_123').first()
    assert unknown is not None
    assert unknown.claimed == False

    # Admin claims
    response = client.post(f'/api/unknown-devices/{unknown.id}/claim', json={
        'project_id': 1,
        'camera_name': 'New Camera'
    })
    assert response.status_code == 200

    # Check camera created
    camera = db.query(Camera).filter_by(serial_number='unknown_serial_123').first()
    assert camera is not None
    assert camera.name == 'New Camera'

    # Check claimed flag
    unknown.refresh()
    assert unknown.claimed == True
```

### E2E Tests (Playwright)

```javascript
test('field technician onboarding workflow', async ({ page }) => {
  // Navigate to onboarding
  await page.goto('/onboarding');

  // Enter serial number (mock barcode scan)
  await page.fill('[data-testid="serial-input"]', '861943070068027');
  await page.click('[data-testid="lookup-btn"]');

  // Wait for camera details
  await page.waitForSelector('[data-testid="camera-detail"]');

  // Check checklist items
  expect(await page.locator('[data-testid="project-check"]')).toBeVisible();
  expect(await page.locator('[data-testid="sim-warning"]')).toBeVisible();

  // Assign SIM
  await page.click('[data-testid="assign-sim-btn"]');
  await page.selectOption('[data-testid="sim-select"]', 'SIM123');
  await page.click('[data-testid="assign-confirm"]');

  // Download settings file
  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-testid="download-settings"]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('settings');

  // Mark as deployed
  await page.click('[data-testid="mark-deployed"]');
  await page.fill('[data-testid="installer-name"]', 'John Doe');
  await page.fill('[data-testid="notes"]', 'Installed north of watering hole');
  await page.click('[data-testid="confirm-deploy"]');

  // Check success message
  await expect(page.locator('[data-testid="success-msg"]')).toContainText('deployed successfully');
});
```

---

## Deployment Considerations

### Database Migration

**Running on production VM:**
```bash
# SSH to VM
ssh ubuntu@your_vm_ip

# Navigate to app directory
cd /opt/addaxai-connect

# Pull latest code
git pull origin main

# Run migration
docker compose exec api alembic upgrade head

# Verify tables created
docker compose exec postgres psql -U addaxai -d addaxai -c "\dt"
```

**Rollback plan:**
```bash
# If migration fails, rollback
docker compose exec api alembic downgrade -1

# Or rollback to specific revision
docker compose exec api alembic downgrade 77a6213767be
```

### File Storage

**MinIO buckets for camera management:**
```
settings-profiles/       # Settings files (.conf, .ini, etc.)
firmware-releases/       # Firmware files (.bin, .hex, etc.)
deployment-photos/       # Photos taken during deployment (optional)
```

**Bucket lifecycle policies (future):**
- Retain deployment photos for 90 days, then delete
- Retain deprecated settings/firmware for 1 year, then archive to S3 Glacier

### Performance Optimization

**Database indexes (already in migration):**
- `cameras.serial_number` (unique, for fast lookups)
- `cameras.project_id` (for filtering)
- `cameras.status` (for filtering)
- `cameras.last_seen` (for maintenance monitor queries)
- `maintenance_tasks.status` (for open tasks queries)
- `unknown_devices.claimed` (for admin queue)

**Query optimization tips:**
- Use `JOIN` to fetch camera + SIM + placement plan in single query
- Paginate large lists (limit 50-100 per page)
- Cache project defaults in Redis (reduce DB queries)
- Use PostGIS spatial indexes for location queries (auto-created)

### Monitoring

**Prometheus metrics to add:**
```python
# In ingestion service
daily_reports_processed = Counter('daily_reports_processed_total')
unknown_devices_detected = Counter('unknown_devices_detected_total')
camera_health_updates = Counter('camera_health_updates_total')

# In maintenance monitor
maintenance_tasks_created = Counter('maintenance_tasks_created_total', ['task_type'])
cameras_checked = Counter('cameras_checked_total')
```

**Alert rules:**
```yaml
# prometheus-alerts.yml
groups:
  - name: camera_management
    rules:
      - alert: HighUnknownDeviceCount
        expr: unknown_devices_detected_total > 10
        for: 1h
        annotations:
          summary: "Many unknown devices detected"

      - alert: MaintenanceMonitorDown
        expr: up{job="maintenance-monitor"} == 0
        for: 5m
        annotations:
          summary: "Maintenance monitor is down"
```

### Security Checklist

- [ ] Admin-only endpoints protected (check `is_superuser`)
- [ ] Project-scoped queries enforced (filter by user's project_id)
- [ ] File uploads validated (max size, allowed extensions)
- [ ] Presigned URLs expire after 1 hour
- [ ] RBAC audit logging (track who changed what)
- [ ] SQL injection prevention (use SQLAlchemy ORM, no raw queries)
- [ ] XSS prevention (sanitize user input, use React escaping)

---

## Success Criteria

### Functional Criteria

✅ **Camera Health Monitoring**
- Daily reports update camera battery, SD, temperature, signal within 5 minutes
- Image EXIF GPS updates camera location automatically
- Unknown devices appear in admin queue within 5 minutes of first contact

✅ **Maintenance Automation**
- Tasks auto-created when battery <20%, SD >80%, silence >48h
- No duplicate tasks created within 24-hour cooldown window
- Task priority correctly set based on severity

✅ **Field Onboarding**
- Barcode scan extracts serial number correctly
- Onboarding checklist shows accurate status (project, SIM, settings, firmware, placement)
- Downloads work on mobile devices (iOS Safari, Android Chrome)
- Mark as deployed updates camera status and records metadata

✅ **Data Integrity**
- Serial number uniqueness enforced
- SIM can only be assigned to one camera at a time
- Placement plan deviation calculation accurate (<1m error)
- Firmware checksum matches on client and server

### Performance Criteria

✅ **Responsiveness**
- Camera registry search returns results in <1s for 1000 cameras
- Placement planning map renders 200+ markers in <3s
- Maintenance list filters apply in <500ms
- API endpoints respond in <200ms (p95)

✅ **Scalability**
- Maintenance monitor processes 1000 cameras in <5 minutes
- Daily report ingestion handles 100 reports/hour without backlog
- Database queries remain fast with 10,000 cameras (proper indexes)

✅ **Reliability**
- No data loss on ingestion failures (failed files moved to `/uploads/failed/`)
- Maintenance tasks never duplicated (cooldown logic)
- File downloads retry on network errors (client-side)

---

## Next Steps

1. **Review this specification** with the team
2. **Run database migration** on dev environment
3. **Implement Phase 2: Enhanced Ingestion** (start with daily report parser)
4. **Build Phase 3: Maintenance Engine** (threshold checks)
5. **Develop Phase 4: Camera Management API** (prioritize onboarding endpoints)
6. **Create Phase 5: Frontend** (start with Camera Registry and Onboarding)
7. **Test Phase 6** (integration tests, E2E tests, load tests)
8. **Deploy to production** (run migration, monitor metrics)

---

**Document Status:** ✅ Ready for Implementation
**Estimated Timeline:** 36-47 developer days (7-9 weeks)
**Risk Level:** Low (well-defined requirements, clear integration points)
