# Alert Worker

Processes classification events and sends notifications based on configured rules.

## Responsibilities

- Subscribe to `classification-complete` Redis queue
- Load active alert rules from database
- Evaluate rules against new classifications
- Send notifications via:
  - Email (SMTP)
  - Signal
  - WhatsApp
  - EarthRanger API
- Log alerts to `alert_logs` table
- Support both immediate and batched alerts

## Alert Rules

Rules can trigger on:
- Specific species detected (e.g., "wolf", "elephant")
- Camera battery low (from EXIF metadata)
- Camera offline (no images for X hours)
- Confidence below threshold
- Time of day filters

## Configuration

Environment variables:
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `SMTP_HOST`, `SMTP_PORT` - Email configuration
- `SIGNAL_API_KEY` - Signal notification API
- `WHATSAPP_API_KEY` - WhatsApp Business API

## Running Locally

```bash
docker compose up alerts
```
