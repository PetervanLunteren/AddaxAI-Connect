# Signal notifications worker

Signal channel worker that sends notifications via Signal messenger.

## Architecture

This service:
1. Listens to `QUEUE_NOTIFICATION_SIGNAL` queue
2. Downloads image attachments from MinIO (if present)
3. Sends messages via signal-cli-rest-api
4. Updates `notification_logs` table with delivery status

## Dependencies

- **signal-cli-rest-api** - Dockerized Signal API service (separate container)
- **MinIO** - For downloading image attachments
- **PostgreSQL** - For updating notification status

## Configuration

Signal phone number must be registered via admin UI before notifications can be sent.
The worker will crash early if Signal is not configured.

## Message Format

Messages include:
- Text message (formatted by notifications service)
- Optional image attachment (thumbnail with detection bounding box)

## Error Handling

- Signal not configured → Mark as failed, log error
- Attachment download fails → Send without attachment, log warning
- Signal API fails → Mark as failed, log error, crash (for retry)

## Files

- `worker.py` - Main entry point, consumes Signal queue
- `signal_client.py` - Wrapper for signal-cli-rest-api
- `image_handler.py` - Download attachments from MinIO
- `db_operations.py` - Update notification status
