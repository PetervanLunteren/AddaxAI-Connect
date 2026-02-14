/**
 * TypeScript type definitions for API responses
 * Matches backend Pydantic schemas
 */

export interface Camera {
  id: number;
  name: string;
  // Administrative metadata (admin-only visibility)
  imei?: string;
  serial_number?: string;
  box?: string;
  order?: string;
  scanned_date?: string;  // ISO date string
  firmware?: string;
  remark?: string;
  has_sim?: boolean;
  imsi?: string;
  iccid?: string;
  // Health/operational data (visible to all)
  location: { lat: number; lon: number } | null;
  battery_percentage: number | null;
  temperature: number | null;
  signal_quality: number | null;
  sd_utilization_percentage: number | null;
  last_report_timestamp: string | null;
  last_image_timestamp: string | null;
  status: 'active' | 'inactive' | 'never_reported';
  total_images?: number;
  sent_images?: number;
}

// Camera health history types
export interface HealthReportPoint {
  date: string;  // YYYY-MM-DD
  battery_percent: number | null;
  signal_quality: number | null;
  temperature_c: number | null;
  sd_utilization_percent: number | null;
  total_images: number | null;
  sent_images: number | null;
}

export interface HealthHistoryResponse {
  camera_id: number;
  camera_name: string;
  reports: HealthReportPoint[];
}

export interface HealthHistoryFilters {
  days?: number;
  start_date?: string;  // YYYY-MM-DD
  end_date?: string;    // YYYY-MM-DD
}

export interface ImageListItem {
  uuid: string;
  filename: string;
  camera_id: number;
  camera_name: string;
  uploaded_at: string;
  datetime_captured: string | null;  // EXIF DateTimeOriginal if available
  status: string;
  detection_count: number;
  top_species: string | null;
  max_confidence: number | null;
  thumbnail_url: string | null;
  detections: Detection[];
  image_width: number | null;
  image_height: number | null;
  is_verified: boolean;
  observed_species: string[];  // Human observations for verified images
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Classification {
  id: number;
  species: string;
  confidence: number;
}

export interface Detection {
  id: number;
  category: string;
  bbox: BoundingBox;
  confidence: number;
  crop_path: string;
  classifications: Classification[];
}

// Human verification types
export interface HumanObservation {
  id: number;
  species: string;
  count: number;
  created_at: string;
  created_by_email: string;
  updated_at: string | null;
  updated_by_email: string | null;
}

export interface VerificationInfo {
  is_verified: boolean;
  verified_at: string | null;
  verified_by_email: string | null;
  notes: string | null;
}

export interface HumanObservationInput {
  species: string;
  count: number;
}

export interface SaveVerificationRequest {
  is_verified: boolean;
  notes: string | null;
  observations: HumanObservationInput[];
}

export interface SaveVerificationResponse {
  message: string;
  verification: VerificationInfo;
  human_observations: HumanObservation[];
}

export interface ImageDetail {
  id: number;
  uuid: string;
  filename: string;
  camera_id: number;
  camera_name: string;
  uploaded_at: string;
  storage_path: string;
  status: string;
  image_metadata: Record<string, any>;
  full_image_url: string;
  detections: Detection[];
  verification: VerificationInfo;
  human_observations: HumanObservation[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface StatisticsOverview {
  total_images: number;
  total_cameras: number;
  total_species: number;
  images_today: number;
  first_image_date: string | null;  // YYYY-MM-DD or null if no images
  last_image_date: string | null;  // YYYY-MM-DD or null if no images
}

export interface TimelineDataPoint {
  date: string;
  count: number;
}

export interface SpeciesCount {
  species: string;
  count: number;
}

export interface CameraActivitySummary {
  active: number;
  inactive: number;
  never_reported: number;
}

export interface LastUpdateResponse {
  last_update: string | null;
}

// Detection rate map types (GeoJSON)
export interface DeploymentFeatureProperties {
  camera_id: number;
  camera_name: string;
  deployment_id: number;
  start_date: string;  // YYYY-MM-DD
  end_date: string | null;  // YYYY-MM-DD or null for active
  trap_days: number;
  detection_count: number;
  detection_rate: number;  // detections per trap-day
  detection_rate_per_100: number;  // detections per 100 trap-days
}

export interface DeploymentFeatureGeometry {
  type: 'Point';
  coordinates: [number, number];  // [longitude, latitude]
}

export interface DeploymentFeature {
  type: 'Feature';
  id: string;  // camera_id-deployment_id
  geometry: DeploymentFeatureGeometry;
  properties: DeploymentFeatureProperties;
}

export interface DetectionRateMapResponse {
  type: 'FeatureCollection';
  features: DeploymentFeature[];
}

export interface DetectionRateMapFilters {
  species?: string;
  start_date?: string;  // YYYY-MM-DD
  end_date?: string;  // YYYY-MM-DD
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  included_species: string[] | null;
  detection_threshold: number;
  blur_people_vehicles: boolean;
  created_at: string;
  updated_at: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  included_species?: string[];
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  included_species?: string[];
  blur_people_vehicles?: boolean;
}

export interface ProjectDeleteResponse {
  deleted_cameras: number;
  deleted_images: number;
  deleted_detections: number;
  deleted_classifications: number;
  deleted_minio_files: number;
}

// User types
export interface User {
  id: number;
  email: string;
  is_active: boolean;
  is_verified: boolean;
  is_superuser: boolean;
}

export interface ProjectMembershipInfo {
  project_id: number;
  project_name: string;
  role: string;
}

export interface UserWithMemberships extends User {
  project_memberships: ProjectMembershipInfo[];
  is_pending_invitation?: boolean;  // True if this is a pending invitation, not a registered user
  invitation_expires_at?: string;  // ISO timestamp when invitation expires
}

// Project with user's role
export interface ProjectWithRole {
  id: number;
  name: string;
  description: string | null;
  role: string;
  included_species: string[] | null;
  detection_threshold: number;
  blur_people_vehicles: boolean;
  image_url: string | null;
  thumbnail_url: string | null;
}

// Server-wide settings
export interface ServerSettings {
  timezone: string | null;
}

// Project user management
export interface ProjectUserInfo {
  user_id: number | null;  // null for pending invitations
  email: string;
  role: string;
  is_registered: boolean;  // true for registered users, false for pending invitations
  is_active: boolean;
  is_verified: boolean;
  added_at: string;
}

export interface AddUserToProjectRequest {
  user_id: number;
  role: string;
}

export interface UpdateProjectUserRoleRequest {
  role: string;
}

export interface InviteUserRequest {
  email: string;
  role: string;  // 'server-admin' or 'project-admin'
  project_id?: number;  // Required for project-admin, ignored for server-admin
  send_email?: boolean;  // Whether to send invitation email
}

export interface InvitationResponse {
  email: string;
  role: string;
  project_id?: number;
  project_name?: string;
  email_sent: boolean;  // Whether invitation email was sent
  message: string;
}

export interface AddServerAdminRequest {
  email: string;
}

export interface AddServerAdminResponse {
  email: string;
  was_promoted: boolean;  // True if existing user promoted, False if new invitation created
  message: string;
}

export interface RemoveServerAdminResponse {
  message: string;
  user_id: number;
  email: string;
}

export interface AddProjectUserByEmailRequest {
  email: string;
  role: string;  // 'project-admin' or 'project-viewer'
}

export interface AddProjectUserByEmailResponse {
  email: string;
  role: string;
  was_invited: boolean;  // true if invitation created, false if existing user added
  message: string;
}

// Signal Notifications
export interface SignalConfig {
  phone_number: string | null;
  device_name: string;
  is_registered: boolean;
  last_health_check: string | null;
  health_status: string | null;
}

export interface SignalRegisterRequest {
  phone_number: string;
  device_name?: string;
}

export interface SignalUpdateConfigRequest {
  device_name?: string;
}

// Telegram Notifications
export interface TelegramConfig {
  bot_token: string | null;
  bot_username: string | null;
  is_configured: boolean;
  last_health_check: string | null;
  health_status: string | null;
}

export interface TelegramConfigureRequest {
  bot_token: string;
  bot_username: string;
}

export interface NotificationPreference {
  enabled: boolean;
  signal_phone: string | null;
  notify_species: string[] | null;
  notify_low_battery: boolean;
  battery_threshold: number;
  notify_system_health: boolean;
}

export interface NotificationPreferenceUpdate {
  enabled?: boolean;
  signal_phone?: string;
  notify_species?: string[] | null;
  notify_low_battery?: boolean;
  battery_threshold?: number;
  notify_system_health?: boolean;
}

// ============================================================================
// Dashboard visualization types
// ============================================================================

// Activity pattern (hourly diel activity)
export interface HourlyActivityPoint {
  hour: number;  // 0-23
  count: number;
}

export interface ActivityPatternResponse {
  hours: HourlyActivityPoint[];
  species: string;  // Species name or "all"
  total_detections: number;
}

export interface ActivityPatternFilters {
  species?: string;
  start_date?: string;  // YYYY-MM-DD
  end_date?: string;  // YYYY-MM-DD
}

export interface DateRangeFilters {
  start_date?: string;  // YYYY-MM-DD
  end_date?: string;  // YYYY-MM-DD
}

// Detection trend (daily counts)
export interface DetectionTrendPoint {
  date: string;  // YYYY-MM-DD
  count: number;
}

export interface DetectionTrendFilters {
  species?: string;
  start_date?: string;  // YYYY-MM-DD
  end_date?: string;  // YYYY-MM-DD
}

// Pipeline status
export interface PipelineStatusResponse {
  pending: number;
  classified: number;
  total_images: number;
  person_count: number;
  vehicle_count: number;
  animal_count: number;
  empty_count: number;
}
