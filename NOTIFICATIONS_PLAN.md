# Notifications System Implementation Plan

**Status:** Backend services complete, API & frontend pending
**Started:** 2025-01-07
**Target:** Production-ready notifications with Signal integration

---

## Overview

Multi-channel notification system for camera trap events (species detections, low battery, system health). Architecture uses core coordinator service + separate channel workers for scalability.

**MVP Channels:** Signal only
**Future Channels:** Email, SMS, EarthRanger

---

## Architecture

```
Classification Worker → QUEUE_NOTIFICATION_EVENTS → Core Notifications Service
Ingestion Worker    →                                      ↓
                                                    Rule Engine
                                                    (evaluate user prefs)
                                                           ↓
                                              QUEUE_NOTIFICATION_SIGNAL
                                                           ↓
                                              Signal Worker Service
                                                           ↓
                                              signal-cli-rest-api
                                                           ↓
                                              User's phone (Signal message)
```

**Services:**
1. **notifications** - Core coordinator, evaluates rules, routes to channels
2. **notifications-signal** - Signal channel worker, sends messages
3. **signal-api** - Third-party container (bbernhard/signal-cli-rest-api)

**Key Principle:** Each channel is an independent, scalable worker service.

---

## Implementation Status

### ✅ Phase 1: Backend Foundation (COMPLETE)

#### Database Schema
**File:** `services/api/alembic/versions/20250107_add_notifications.py`

Three tables created:
1. **notification_preferences** - Per-user settings
   - `user_id` (FK to users, unique)
   - `enabled` (boolean)
   - `signal_phone` (E.164 format)
   - `notify_species` (JSON array or null for all)
   - `notify_low_battery` (boolean)
   - `battery_threshold` (int, percentage)
   - `notify_system_health` (boolean, admins only)

2. **notification_logs** - Audit trail
   - `user_id` (FK to users)
   - `notification_type` (species_detection, low_battery, system_health)
   - `channel` (signal, email, sms, earthranger)
   - `status` (pending, sent, failed)
   - `trigger_data` (JSON, event that triggered notification)
   - `message_content` (text)
   - `error_message` (text, nullable)
   - `sent_at` (timestamp, nullable)

3. **signal_config** - System-wide Signal configuration (single row)
   - `phone_number` (E.164 format)
   - `device_name` (default: "AddaxAI-Connect")
   - `is_registered` (boolean)
   - `last_health_check` (timestamp)
   - `health_status` (healthy, error, not_configured)

**Shared Models:** `shared/shared/models.py` - SQLAlchemy models added
**Queue Constants:** `shared/shared/queue.py` - Added `QUEUE_NOTIFICATION_EVENTS`, `QUEUE_NOTIFICATION_SIGNAL`

#### Core Notifications Service
**Directory:** `services/notifications/`

**Files:**
- `worker.py` - Main entry point, listens to `QUEUE_NOTIFICATION_EVENTS`
- `rule_engine.py` - Evaluates user preferences, returns matching users
- `event_handlers.py` - Formats messages, publishes to channel queues
- `db_operations.py` - Creates notification log entries
- `requirements.txt` - Dependencies
- `Dockerfile` - Container definition
- `README.md` - Service documentation

**Rule Engine Logic (MVP - simple toggles):**
- Species detection: `notify_species` is null (all) OR contains species
- Low battery: `notify_low_battery` is true AND battery <= `battery_threshold`
- System health: `notify_system_health` is true

All rules require: enabled=true, signal_phone configured, user active and verified

**Event Types Supported:**
1. `species_detection` - From classification worker
2. `low_battery` - From ingestion worker
3. `system_health` - From monitoring (future)

#### Signal Worker Service
**Directory:** `services/notifications-signal/`

**Files:**
- `worker.py` - Consumes from `QUEUE_NOTIFICATION_SIGNAL`, sends messages
- `signal_client.py` - Wrapper for signal-cli-rest-api
- `image_handler.py` - Downloads attachments from MinIO
- `db_operations.py` - Updates notification status (sent/failed)
- `requirements.txt` - Dependencies (includes requests, Pillow)
- `Dockerfile` - Container definition
- `README.md` - Service documentation

**Message Format:**
```
Wolf (94%) detected at Camera-GK123
Location: 51.5074, -0.1278
View: https://yourdomain.com/images/{image_id}

[Attached: thumbnail with bounding box]
```

**Error Handling:**
- Signal not configured → Mark as failed, log error (don't crash)
- Attachment download fails → Send without image, log warning
- Signal API fails → Mark as failed, log error, crash (for retry)

#### Docker Integration
**File:** `docker-compose.yml`

Added three services:
1. `notifications` - Core service
2. `notifications-signal` - Signal worker
3. `signal-api` - signal-cli-rest-api container

**signal-api configuration:**
- Image: `bbernhard/signal-cli-rest-api:latest`
- Volume: `./data/signal-cli:/home/.local/share/signal-cli` (persistent)
- Port: `127.0.0.1:8090:8080` (localhost only)
- Internal URL: `http://signal-api:8080`

---

### ⏳ Phase 2: API Endpoints (PENDING)

#### Admin Signal Configuration API
**File:** `services/api/routers/signal_admin.py` (to create)

**Endpoints:**
- `GET /api/admin/signal/status` - Check Signal registration status
- `POST /api/admin/signal/register` - Initiate registration (start registration, get QR)
- `POST /api/admin/signal/verify` - Verify registration code
- `GET /api/admin/signal/health` - Health check (ping signal-api)
- `POST /api/admin/signal/test` - Send test message to admin's phone

**Requirements:**
- All endpoints require `is_superuser=True`
- Create/update single row in `signal_config` table
- Proxy calls to `signal-api` service at `http://signal-api:8080`

**Signal Registration Flow:**
1. Admin enters phone number in UI
2. POST `/register` with phone number → signal-cli sends SMS verification code
3. Admin enters code from SMS
4. POST `/verify` with code → signal-cli confirms registration
5. Update `signal_config.is_registered = true`

#### User Preferences API
**File:** `services/api/routers/notifications.py` (to create)

**Endpoints:**
- `GET /api/notifications/preferences` - Get current user's preferences
- `PUT /api/notifications/preferences` - Update current user's preferences
- `GET /api/notifications/history` - Get notification log for current user (paginated)
- `POST /api/notifications/test` - Send test notification to current user
- `GET /api/notifications/available-species` - List species for selection (from DB)

**Preferences Update Schema:**
```python
{
    "enabled": bool,
    "signal_phone": str,  # E.164 format, validated
    "notify_species": list[str] or null,
    "notify_low_battery": bool,
    "battery_threshold": int,  # 0-100
    "notify_system_health": bool  # Admins only
}
```

**Validation:**
- Phone number: E.164 format regex `^\+[1-9]\d{1,14}$`
- Battery threshold: 0-100
- Species: Must exist in database (dynamic query)

---

### ⏳ Phase 3: Frontend Pages (PENDING)

#### Admin Signal Setup Page
**Path:** Settings → System → Notifications (hamburger menu)
**File:** `services/frontend/src/pages/admin/SignalSetup.tsx` (to create)

**UI Elements:**
1. **Status Section:**
   - Status badge: "Not configured" / "Registered" / "Error"
   - Phone number display (if registered)
   - Last health check timestamp

2. **Registration Wizard (if not registered):**
   - Step 1: Enter phone number (input with E.164 validation)
   - Step 2: Click "Send verification code" → SMS sent
   - Step 3: Enter 6-digit code from SMS
   - Step 4: Click "Verify" → Registration complete
   - Instructions explaining Signal registration process

3. **Actions (if registered):**
   - "Send test message" button → Sends test to admin's configured number
   - "Check health" button → Pings signal-api
   - "Re-register" button → Start registration flow again

**Access:** Superusers only (check `user.is_superuser`)

#### User Profile/Preferences Page
**Path:** Hamburger menu → "Edit profile"
**File:** `services/frontend/src/pages/Profile.tsx` (to create)

**Sections:**

1. **User Info** (read-only):
   - Email
   - Role
   - Created date

2. **Notification Preferences:**
   - Toggle: "Enable notifications"
   - Input: "Signal phone number" (E.164 format, validated)
     - Helper text: "Format: +1234567890"
     - Validation indicator (green checkmark / red X)

   - **Species Notifications:**
     - Checkbox: "Notify for all species"
     - OR Multi-select dropdown: Choose specific species
       - Loaded dynamically from `/api/notifications/available-species`
       - Search/filter capability

   - **Low Battery Warnings:**
     - Toggle: "Low battery notifications"
     - Slider: Battery threshold (0-100%)
       - Shows current value: "Notify when battery below 30%"

   - **System Health** (admins only):
     - Toggle: "System health notifications"
     - Helper text: "Service failures, queue backlogs, etc."

   - **Test Button:**
     - "Send test notification" → Triggers test message to user's phone

   - Save button (primary action)

**Validation:**
- Don't allow save if `enabled=true` but `signal_phone` is empty or invalid
- Show inline errors for phone format
- Disable save button while submitting

**Future Expansion:**
This page will also include email, SMS, and other notification preferences as those channels are added.

---

### ⏳ Phase 4: Event Publishing (PENDING)

#### Classification Worker Updates
**File:** `services/classification/worker.py`

After successful classification (currently line ~200), publish notification event:

```python
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EVENTS

# After updating database with classification results
notification_queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)
notification_queue.publish({
    'type': 'species_detection',
    'image_id': image_uuid,
    'species': predicted_species,
    'confidence': confidence,
    'camera_id': camera_id,
    'camera_name': camera_name,  # Fetch from database
    'location': gps_location,  # From image metadata
    'thumbnail_path': thumbnail_path,  # Path in MinIO
    'timestamp': datetime.utcnow().isoformat()
})
```

**Requirements:**
- Fetch camera name from database (join on camera_id)
- Use thumbnail path (already created by ingestion)
- Only publish if classification successful (not on errors)

#### Ingestion Worker Updates
**File:** `services/ingestion/main.py`

In `process_daily_report()` function (after line ~299 where camera health is updated), check battery threshold:

```python
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EVENTS

# After update_camera_health() call
if health_data.get('battery_percentage') is not None:
    battery = health_data['battery_percentage']

    # Only notify if crossing threshold (avoid spam on every report)
    # Check if previous battery was above lowest user threshold
    if should_notify_battery_change(camera_id, battery):
        notification_queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)
        notification_queue.publish({
            'type': 'low_battery',
            'camera_id': camera_id,
            'camera_name': camera_name,  # From camera record
            'imei': imei,
            'battery_percentage': battery,
            'location': camera_location,  # From camera.location (PostGIS)
            'timestamp': datetime.utcnow().isoformat()
        })
```

**Helper Function Needed:**
```python
def should_notify_battery_change(camera_id: int, current_battery: int) -> bool:
    """
    Check if battery crossed any user's threshold since last report.
    Prevents spam by only notifying on threshold crossing.

    Returns True if:
    - Previous battery was >= min user threshold AND
    - Current battery is < min user threshold

    OR first battery report for this camera
    """
    # Implementation needed
```

---

### ⏳ Phase 5: Testing & Deployment (PENDING)

#### Manual Testing Steps

1. **Database Migration:**
   ```bash
   ssh addaxai-connect-dev
   cd /opt/addaxai-connect
   docker compose run --rm api python -m alembic upgrade head
   ```

2. **Start New Services:**
   ```bash
   docker compose up -d notifications notifications-signal signal-api
   docker compose logs -f notifications notifications-signal
   ```

3. **Admin Signal Setup:**
   - Navigate to Settings → System → Notifications
   - Register Signal phone number
   - Send test message
   - Verify message received

4. **User Preferences:**
   - Navigate to hamburger menu → Edit profile
   - Configure Signal phone number
   - Select species to notify (e.g., "wolf")
   - Set battery threshold (e.g., 30%)
   - Save preferences
   - Click "Send test notification"
   - Verify test message received

5. **End-to-End Flow:**
   ```bash
   # Option 1: Upload real image via FTPS
   # Should trigger: ingestion → detection → classification → notification

   # Option 2: Manually publish event to Redis (for testing)
   docker compose exec redis redis-cli
   > LPUSH notification-events '{"type":"species_detection","image_id":"test-123","species":"wolf","confidence":0.94,"camera_id":1,"camera_name":"Test-Cam","location":{"lat":51.5,"lon":-0.1},"thumbnail_path":"thumbnails/test.jpg","timestamp":"2025-01-07T12:00:00Z"}'
   ```

6. **Verify Notification:**
   - Check `notification_logs` table for entry
   - Check user's phone for Signal message
   - Verify message format and image attachment

#### Validation Checklist

- [ ] Database migration runs without errors
- [ ] New services start successfully
- [ ] Signal registration completes
- [ ] Test message sends successfully
- [ ] User can configure preferences
- [ ] Species list loads dynamically from database
- [ ] Phone number validation works
- [ ] Test notification button works
- [ ] Classification worker publishes events
- [ ] Ingestion worker publishes battery events
- [ ] Core notifications service processes events
- [ ] Rule engine filters users correctly
- [ ] Signal worker sends messages with images
- [ ] Notification logs updated correctly (sent/failed)
- [ ] Error handling works (Signal not configured, attachment fails, etc.)

---

## Future Enhancements

### Additional Channels
When adding email/SMS/EarthRanger:
1. Create new worker service (e.g., `services/notifications-email/`)
2. Add queue constant (e.g., `QUEUE_NOTIFICATION_EMAIL`)
3. Update `event_handlers.py` to publish to new queue
4. Add channel to user preferences (database + API + frontend)
5. No changes needed to core notifications service

### Advanced Rules
Replace simple toggles with rule engine:
- Conditions: "wolf AND confidence > 90% AND nighttime"
- Per-camera rules: "only Camera-123"
- Time-based rules: "only between 18:00-06:00"
- Rate limiting: "max 10 notifications per hour"

**Implementation:** Add `notification_rules` table with expression parser

### Rate Limiting
Prevent notification spam:
- Max X notifications per user per hour
- Cooldown period per camera (e.g., 5 minutes between wolf detections)
- Daily digest option (batch notifications)

**Implementation:** Add rate limit checks to rule engine

### Notification Templates
Make message format configurable:
- Store templates in database
- Variable substitution: `{species}`, `{camera}`, `{confidence}`
- Per-user or per-project templates

**Implementation:** Add `notification_templates` table

---

## Deployment Notes

### Ansible Integration
All infrastructure is defined in docker-compose.yml, so works on all deployments.

**Manual Steps Required:**
1. Signal phone number registration (one-time per deployment)
   - Admin must register via UI
   - Requires SMS verification code
   - signal-cli data persisted in `./data/signal-cli`

**No additional Ansible changes needed** - docker-compose.yml handles everything.

### Environment Variables
All env vars already configured in docker-compose.yml:
- `DATABASE_URL` - Existing
- `REDIS_URL` - Existing
- `MINIO_ENDPOINT` - Existing
- `DOMAIN_NAME` - Existing (used for dashboard links in messages)
- `SIGNAL_API_URL` - New (default: `http://signal-api:8080`)

### Data Persistence
Signal configuration persists in `./data/signal-cli` volume (defined in docker-compose.yml).

**Backup/Restore:**
- Include `./data/signal-cli` in backup scripts
- On restore, Signal registration is preserved

### Monitoring
Add Prometheus metrics (future):
- Notification success/failure rate
- Queue depth
- Signal API latency
- Notifications sent per user per day

---

## Known Limitations (MVP)

1. **No retry logic** - Failed notifications marked as failed, no automatic retry
2. **No dead-letter queue** - Failed jobs not persisted for later retry
3. **No rate limiting** - Users can receive unlimited notifications
4. **No delivery confirmation** - No read receipts from Signal
5. **No attachment optimization** - Images sent as-is (not resized)
6. **No message templates** - Format is hardcoded
7. **No notification grouping** - Each detection is separate message
8. **No quiet hours** - Notifications sent 24/7
9. **Single Signal number** - One system-wide sender (not per-project)

These can be addressed in future iterations based on user feedback.

---

## Timeline Estimate

- [x] Phase 1: Backend foundation (2 days) - COMPLETE
- [ ] Phase 2: API endpoints (1 day)
- [ ] Phase 3: Frontend pages (2 days)
- [ ] Phase 4: Event publishing (0.5 days)
- [ ] Phase 5: Testing & deployment (1 day)

**Total:** ~6-7 days for full MVP

---

## Questions / Decisions Log

**Q:** One Signal number for system, or per-user sending?
**A:** One system number (standard for server notifications). Users provide their number to receive.

**Q:** Always attach image, or make it optional?
**A:** Always attach thumbnail with bbox. Can make configurable later.

**Q:** Where to put user preferences - profile page or separate notifications page?
**A:** Hamburger menu → "Edit profile" - Will expand for email/other settings later.

**Q:** Where to put admin Signal setup?
**A:** Settings → System → Notifications (in hamburger menu).

**Q:** How to handle unknown species from future model updates?
**A:** Load species list dynamically from database. New species default to `notify_species=null` (no notification).

---

## File Tree

```
services/
├── notifications/                 # Core notification coordinator
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── worker.py                 # Main entry point
│   ├── rule_engine.py            # User preference evaluation
│   ├── event_handlers.py         # Message formatting & routing
│   ├── db_operations.py          # Notification logs
│   └── README.md
│
├── notifications-signal/         # Signal channel worker
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── worker.py                 # Main entry point
│   ├── signal_client.py          # signal-cli-rest-api wrapper
│   ├── image_handler.py          # MinIO download
│   ├── db_operations.py          # Status updates
│   └── README.md
│
├── api/
│   ├── alembic/versions/
│   │   └── 20250107_add_notifications.py  # Database migration
│   └── routers/
│       ├── signal_admin.py       # (to create) Admin Signal setup
│       └── notifications.py      # (to create) User preferences
│
└── frontend/
    └── src/
        └── pages/
            ├── admin/
            │   └── SignalSetup.tsx        # (to create)
            └── Profile.tsx                # (to create)

shared/shared/
├── models.py                      # Added NotificationPreference, NotificationLog, SignalConfig
└── queue.py                       # Added QUEUE_NOTIFICATION_EVENTS, QUEUE_NOTIFICATION_SIGNAL

docker-compose.yml                 # Added notifications, notifications-signal, signal-api services
```

---

## References

- [signal-cli-rest-api documentation](https://bbernhard.github.io/signal-cli-rest-api/)
- [Signal API endpoints](https://github.com/bbernhard/signal-cli-rest-api)
- [E.164 phone format](https://en.wikipedia.org/wiki/E.164)
