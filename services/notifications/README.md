# Notifications service

Core notification coordinator that evaluates rules and routes to channel-specific workers.

## Architecture

This service acts as a central dispatcher:
1. Listens to `QUEUE_NOTIFICATION_EVENTS` for events from classification/ingestion workers
2. Evaluates user notification preferences (rule engine)
3. Creates `notification_logs` entries for audit trail
4. Routes messages to channel-specific queues (e.g., `QUEUE_NOTIFICATION_SIGNAL`)

Channel workers (e.g., `notifications-signal`) consume from their queues and handle delivery.

## Event Types

### Species detection
Triggered by classification worker when animal detected.

Event structure:
```python
{
    'type': 'species_detection',
    'image_id': str (UUID),
    'species': str,
    'confidence': float,
    'camera_id': int,
    'camera_name': str,
    'location': {'lat': float, 'lon': float} or None,
    'thumbnail_path': str,  # MinIO path to image thumbnail with bbox
    'timestamp': str (ISO 8601)
}
```

### Low battery
Triggered by ingestion worker when camera battery drops below threshold.

Event structure:
```python
{
    'type': 'low_battery',
    'camera_id': int,
    'camera_name': str,
    'imei': str,
    'battery_percentage': int,
    'location': {'lat': float, 'lon': float} or None,
    'timestamp': str (ISO 8601)
}
```

### System health
Triggered by monitoring systems for operational issues.

Event structure:
```python
{
    'type': 'system_health',
    'alert_type': str,  # e.g., 'service_down', 'queue_backlog'
    'severity': str,  # 'warning', 'error', 'critical'
    'message': str,
    'details': dict,
    'timestamp': str (ISO 8601)
}
```

## Rule Engine

Simple toggle-based rules (MVP):
- **Species detection**: User's `notify_species` is null (all) OR contains species
- **Low battery**: User's `notify_low_battery` is true AND battery <= user's `battery_threshold`
- **System health**: User's `notify_system_health` is true (typically admins only)

All rules require:
- User has notifications enabled (`enabled=true`)
- User has configured contact method (e.g., Signal phone number)
- User is active and verified

## Files

- `worker.py` - Main entry point, listens to events queue
- `rule_engine.py` - Evaluates which users should be notified
- `event_handlers.py` - Formats messages and publishes to channel queues
- `db_operations.py` - Database operations for notification logs
