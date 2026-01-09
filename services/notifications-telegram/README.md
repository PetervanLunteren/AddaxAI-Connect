# Telegram Notifications Worker

Consumes messages from `QUEUE_NOTIFICATION_TELEGRAM` and sends them via Telegram Bot API.

## Features

- Sends text messages with optional photo attachments
- Handles /start command to provide chat IDs to users
- Polls Telegram API for updates (getUpdates)
- Updates notification_logs with sent/failed status
- Privacy-conscious logging (masks chat IDs)

## Setup

### Admin Configuration

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow prompts to name your bot
4. Copy the bot token provided
5. Copy the bot username (e.g., `AddaxAI_bot`)
6. Configure via API: `POST /api/admin/telegram/configure`

### User Configuration

1. Search for your bot in Telegram (e.g., `@AddaxAI_bot`)
2. Send `/start` to the bot
3. Bot replies with your chat ID
4. Copy the chat ID
5. Paste into notification preferences: Project Settings → Notifications → Telegram Chat ID

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `MINIO_ENDPOINT` - MinIO S3 endpoint
- `MINIO_ACCESS_KEY` - MinIO access key
- `MINIO_SECRET_KEY` - MinIO secret key
- `LOG_LEVEL` - Logging level (default: INFO)

## API Usage

### Send Message (called by core notifications service)

Message published to `QUEUE_NOTIFICATION_TELEGRAM`:

```json
{
  "notification_log_id": 123,
  "chat_id": "987654321",
  "message_text": "Wolf (94%) detected at Camera-GK123",
  "attachment_path": "thumbnails/abc-123.jpg"
}
```

### Bot Commands

- `/start` - Get your chat ID for configuration

## Error Handling

- **Bot not configured**: Marks notification as failed, logs error
- **Attachment download fails**: Sends message without image, logs warning
- **Telegram API fails**: Marks notification as failed, crashes for retry
- **Invalid chat ID**: Telegram API returns error, logged and marked failed

## Architecture

```
Redis Queue (notification-telegram)
    ↓
Worker: process_telegram_message()
    ↓
TelegramClient.send_message()
    ↓
Telegram Bot API (HTTPS)
    ↓
User's Telegram app
```

## Dependencies

- `requests` - HTTP client for Telegram Bot API
- `Pillow` - Image processing for attachments
- `shared` - Database, queue, logging, storage utilities
