# Logging Guide for AddaxAI Connect

This guide explains how to use the structured logging system in AddaxAI Connect.

## Overview

AddaxAI Connect uses **structured JSON logging** with correlation IDs for easy debugging and tracing across all services:

- **Backend:** Python `structlog` library → JSON format → Loki
- **Frontend:** TypeScript logger → `/api/logs` endpoint → Loki
- **Monitoring:** Loki for log aggregation, Prometheus for metrics
- **Correlation IDs:**
  - `request_id` - Unique ID per API request (auto-generated)
  - `image_id` - Business identifier for tracking images through pipeline
  - `user_id` - User identifier (if authenticated)

---

## Backend Logging (Python)

### Basic Usage

```python
from shared.logger import get_logger

logger = get_logger("my-service")

# Simple logging
logger.info("Processing started")
logger.error("Processing failed", error=str(e))

# With context
logger.info("Image processed", image_id="abc-123", duration_ms=450)
```

### Log Levels

- **DEBUG:** Detailed diagnostic information (set `LOG_LEVEL=DEBUG`)
- **INFO:** General informational messages (default)
- **WARNING:** Warning messages for potential issues
- **ERROR:** Error messages for failures
- **CRITICAL:** Critical errors requiring immediate attention

### Adding Correlation IDs

The logging middleware automatically injects `request_id` for API requests. For workers:

```python
from shared.logger import set_request_id, set_image_id, clear_context
import uuid

# At start of task
request_id = str(uuid.uuid4())
set_request_id(request_id)
set_image_id(message['image_id'])

# All subsequent logs will include these IDs
logger.info("Starting detection", model="yolov5")

# Clear context when done
clear_context()
```

### Example: Worker Service

```python
from shared.logger import get_logger, set_request_id, set_image_id
from shared.queue import RedisQueue
import uuid

logger = get_logger("detection")

def process_message(message):
    # Set correlation IDs
    set_request_id(str(uuid.uuid4()))
    set_image_id(message['image_id'])

    try:
        logger.info("Processing image", filename=message['filename'])

        # ... do work ...

        logger.info("Detection complete", detections=3, duration_ms=1250)
    except Exception as e:
        logger.error("Detection failed", error=str(e), exc_info=True)
    finally:
        clear_context()

queue = RedisQueue("image-ingested")
queue.consume_forever(process_message)
```

---

## Frontend Logging (TypeScript)

### Basic Usage

```typescript
import { logger } from '@/utils/logger';

// Simple logging
logger.info('Component mounted');
logger.error('API call failed');

// With context
logger.error('Failed to load data', {
  component: 'Dashboard',
  api_endpoint: '/api/images',
  status_code: 500,
});
```

### Automatic Logging

The frontend automatically logs:
- **Unhandled errors** (via `window.onerror`)
- **Unhandled promise rejections** (via `window.onunhandledrejection`)
- **API failures** (status >= 400, via axios interceptor)
- **React component errors** (via `ErrorBoundary`)

### Example: API Error Handling

```typescript
import { logger } from '@/utils/logger';
import apiClient from '@/api/client';

async function fetchData() {
  try {
    const response = await apiClient.get('/api/data');
    return response.data;
  } catch (error) {
    // Error is automatically logged by axios interceptor
    // But you can add custom context:
    logger.error('Custom error handling', {
      operation: 'fetchData',
      user_action: 'refresh_button_clicked',
    });
    throw error;
  }
}
```

---

## Querying Logs in Loki

Access Loki at: `https://dev.addaxai.com/loki/` (requires HTTP basic auth)

### Common Queries

**All errors across all services:**
```logql
{} | json | level="ERROR"
```

**Errors from specific service:**
```logql
{service="api"} | json | level="ERROR"
```

**Trace a single image through the pipeline:**
```logql
{} | json | image_id="abc-123"
```

**Trace a single API request:**
```logql
{service="api"} | json | request_id="xyz-789"
```

**All actions by a specific user:**
```logql
{} | json | user_id="42"
```

**Critical errors only:**
```logql
{} | json | level="CRITICAL"
```

**Frontend errors:**
```logql
{service="frontend"} | json | level="ERROR"
```

**Authentication events:**
```logql
{service="api.auth"} | json | event=~".*registration.*|.*login.*|.*password_reset.*"
```

**Detection worker errors:**
```logql
{service="detection"} | json | level="ERROR"
```

**Logs with specific error message:**
```logql
{service="api"} | json | message =~ ".*database.*connection.*"
```

**Performance: Slow API requests (> 1 second):**
```logql
{service="api.middleware"} | json | duration_ms > 1000
```

---

## Log Format

All logs are in JSON format:

```json
{
  "timestamp": "2025-12-15T10:30:00.123Z",
  "level": "INFO",
  "service": "api",
  "logger": "api.auth",
  "message": "User registered, verification email requested",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "42",
  "email": "user@example.com",
  "event": "user_registration"
}
```

**Standard Fields:**
- `timestamp` - ISO 8601 timestamp
- `level` - Log level (INFO, ERROR, etc.)
- `service` - Service name (api, detection, frontend, etc.)
- `logger` - Specific logger name
- `message` - Human-readable message

**Correlation Fields (optional):**
- `request_id` - Unique per API request
- `image_id` - Unique per image
- `user_id` - User ID (if authenticated)

**Custom Fields:** Any additional context you provide

---

## Environment Variables

Control logging behavior via environment variables in `docker-compose.yml` or `.env`:

```bash
LOG_LEVEL=INFO         # DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_FORMAT=json        # "json" or "text" (text for human-readable dev logs)
ENVIRONMENT=development  # "development" or "production"
```

### Development vs Production

**Development (`LOG_FORMAT=text`):**
```
2025-12-15 10:30:00 | INFO     | api.auth | User registered
```

**Production (`LOG_FORMAT=json`):**
```json
{"timestamp":"2025-12-15T10:30:00Z","level":"INFO","service":"api.auth","message":"User registered"}
```

---

## Prometheus Alerts

Alert rules are defined in `monitoring/prometheus-alerts.yml`. Alerts trigger on:

- **HighErrorRate:** > 5 errors/min for 5 minutes
- **CriticalError:** Any CRITICAL level log
- **ServiceNotLogging:** Service hasn't logged for 10 minutes (possible crash)
- **HighFrontendErrorRate:** > 10 frontend errors/min
- **HighAuthenticationFailureRate:** > 5 auth failures/min
- **DatabaseConnectionErrors:** Multiple DB errors
- **DetectionWorkerHighFailureRate:** > 2 detection failures/min
- **ModelLoadingFailure:** ML model failed to load

View alerts: `https://dev.addaxai.com/prometheus/alerts`

---

## Best Practices

### 1. **Use Structured Logging**

❌ **Don't:**
```python
logger.info(f"Processing image {image_id} took {duration}ms")
```

✅ **Do:**
```python
logger.info("Processing image complete", image_id=image_id, duration_ms=duration)
```

**Why:** Structured logs are queryable. You can filter by `image_id` or `duration_ms`.

### 2. **Include Context**

❌ **Don't:**
```python
logger.error("Failed to connect")
```

✅ **Do:**
```python
logger.error("Failed to connect to database",
             host="localhost", port=5432, error=str(e), exc_info=True)
```

**Why:** Context helps diagnose issues faster.

### 3. **Use Correlation IDs**

```python
# Worker processing pipeline
set_request_id(str(uuid.uuid4()))  # Technical correlation
set_image_id(message['image_id'])  # Business correlation

logger.info("Starting detection")
# ... process ...
logger.info("Detection complete")

clear_context()
```

**Why:** Trace a single image through the entire pipeline.

### 4. **Log Errors with Stack Traces**

```python
try:
    # ... code ...
except Exception as e:
    logger.error("Operation failed", error=str(e), exc_info=True)
```

**Why:** `exc_info=True` includes the full stack trace in logs.

### 5. **Use Appropriate Log Levels**

- **DEBUG:** Function entry/exit, variable values
- **INFO:** Normal operations (started, completed, metrics)
- **WARNING:** Degraded performance, deprecated features
- **ERROR:** Failures that don't stop the service
- **CRITICAL:** Failures that require immediate action

### 6. **Don't Log Sensitive Data**

❌ **Don't log:**
- Passwords
- JWT tokens
- Full credit card numbers
- Social security numbers

✅ **Do log:**
- User IDs
- Redacted emails (`u***@example.com`)
- Request IDs
- Error types

---

## Debugging Workflow

### Problem: User reports "image not appearing in dashboard"

**Step 1:** Find the image in Loki
```logql
{} | json | image_id="abc-123"
```

**Step 2:** Check for errors
```logql
{} | json | image_id="abc-123" | level="ERROR"
```

**Step 3:** Trace the pipeline
```logql
{} | json | image_id="abc-123" | line_format "{{.service}} | {{.message}}"
```

You'll see:
```
ingestion | Image uploaded successfully
detection | Starting detection
detection | Detection complete, 3 animals found
classification | Starting classification
classification | ERROR: Model file not found  ← Problem found!
```

**Step 4:** Check logs around that time
```logql
{service="classification"} | json | level="ERROR"
```

**Step 5:** Fix the issue, verify
```logql
{service="classification"} | json | message =~ ".*model.*"
```

---

## Performance Considerations

### Log Volume

- **INFO level:** ~100-1000 logs/min per service
- **DEBUG level:** ~1000-10000 logs/min per service

**Recommendation:** Use INFO in production, DEBUG only when debugging specific issues.

### Frontend Batching

The frontend logger batches logs to reduce API calls:
- **Max batch size:** 10 logs
- **Max batch interval:** 1 second
- **Errors:** Sent immediately (not batched)

### Loki Retention

- **Current retention:** 7 days
- **Storage:** Local filesystem
- **Rotation:** Automatic

---

## Troubleshooting

### Logs not appearing in Loki

1. Check Promtail is running:
   ```bash
   docker ps | grep promtail
   ```

2. Check Promtail logs:
   ```bash
   docker logs addaxai-promtail
   ```

3. Verify JSON format:
   ```bash
   docker logs addaxai-api --tail 10
   ```
   Should see JSON like: `{"timestamp":"...","level":"INFO",...}`

### Frontend logs not appearing

1. Check `/api/logs` endpoint is registered:
   ```bash
   curl -X POST https://dev.addaxai.com/api/logs \
     -H "Content-Type: application/json" \
     -d '{"level":"info","message":"test"}'
   ```

2. Check browser console for errors
3. Check API logs for rate limiting (429 errors)

### Can't query by image_id or request_id

Verify Promtail is parsing JSON correctly:
```bash
# Check Promtail config has pipeline_stages with json parser
cat monitoring/promtail-config.yml
```

---

## Additional Resources

- **Loki Documentation:** https://grafana.com/docs/loki/
- **LogQL Query Language:** https://grafana.com/docs/loki/latest/logql/
- **Prometheus Alerts:** https://prometheus.io/docs/alerting/latest/
- **structlog Documentation:** https://www.structlog.org/

---

## Support

If you encounter issues with logging:
1. Check this documentation
2. Review logs in Loki
3. Check Prometheus alerts
4. Ask in team chat with relevant log queries
