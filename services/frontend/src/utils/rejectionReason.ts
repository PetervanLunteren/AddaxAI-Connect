/**
 * Labels for rejection reasons.
 *
 * One list for the Live feed, File management and the camera slide-out, so a
 * reason reads the same everywhere. The keys are the reason strings ingestion
 * writes (services/ingestion/main.py). Plain, natural caps, no colons.
 */
const REASON_LABELS: Record<string, string> = {
  missing_gps: 'Missing GPS',
  invalid_gps: 'Invalid GPS',
  missing_datetime: 'Missing date',
  missing_device_id: 'Missing camera ID',
  unknown_camera: 'Unknown camera',
  unsupported_camera: 'Unsupported camera',
  no_camera_exif: 'No camera info',
  exif_extraction_failed: 'No metadata',
  validation_failed: 'Invalid file',
  parse_failed: 'Bad report',
  unsupported_file_type: 'Unsupported file',
};

export function rejectionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Rejected';
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}
