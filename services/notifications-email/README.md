# Email notifications worker

Worker service that sends email notifications via SMTP.

## Overview

Consumes messages from the `notification-email` Redis queue and delivers emails using the configured SMTP server. Supports both HTML and plain text emails.

## Configuration

Required environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `MAIL_SERVER` | SMTP server hostname | `smtp.gmail.com` |
| `MAIL_PORT` | SMTP port | `587` |
| `MAIL_USERNAME` | SMTP username | `user@example.com` |
| `MAIL_PASSWORD` | SMTP password | `app-password` |
| `MAIL_FROM` | Sender email address | `noreply@example.com` |

## Message format

```json
{
  "notification_log_id": 123,
  "to_email": "user@example.com",
  "subject": "Project - Weekly report",
  "body_text": "Plain text content...",
  "body_html": "<html>HTML content...</html>"
}
```

## How it works

1. Consumes messages from `QUEUE_NOTIFICATION_EMAIL`
2. Sends email via SMTP (auto-detects TLS mode based on port)
3. Updates `notification_logs` table with status (`sent` or `failed`)

## Development

```bash
# Run locally
cd services/notifications-email
pip install -r requirements.txt
python worker.py
```
