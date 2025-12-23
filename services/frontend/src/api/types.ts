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
  excluded_species: string[] | null;
  created_at: string;
  updated_at: string | null;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  excluded_species?: string[];
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  excluded_species?: string[];
}

export interface ReprocessRequest {
  project_id: number;
}

export interface ReprocessResponse {
  message: string;
  images_queued: number;
  project_id: number;
}
