/**
 * TypeScript type definitions for API responses
 * Matches backend Pydantic schemas
 */

export interface Camera {
  id: number;
  name: string;
  location: { lat: number; lon: number } | null;
  battery_percentage: number | null;
  temperature: number | null;
  signal_quality: number | null;
  sd_utilization_percentage: number | null;
  last_report_timestamp: string | null;
  status: 'active' | 'inactive' | 'never_reported';
  total_images?: number;
  sent_images?: number;
}

export interface ImageListItem {
  uuid: string;
  filename: string;
  camera_id: number;
  camera_name: string;
  uploaded_at: string;
  status: string;
  detection_count: number;
  top_species: string | null;
  max_confidence: number | null;
  thumbnail_url: string | null;
  detections: Detection[];
  image_width: number | null;
  image_height: number | null;
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

export interface Project {
  id: number;
  name: string;
  description: string | null;
  included_species: string[] | null;
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
  is_server_admin: boolean;
}

export interface ProjectMembershipInfo {
  project_id: number;
  project_name: string;
  role: string;
}

export interface UserWithMemberships extends User {
  project_memberships: ProjectMembershipInfo[];
}

// Project with user's role
export interface ProjectWithRole {
  id: number;
  name: string;
  description: string | null;
  role: string;
  image_url: string | null;
  thumbnail_url: string | null;
}

// Project user management
export interface ProjectUserInfo {
  user_id: number;
  email: string;
  role: string;
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
