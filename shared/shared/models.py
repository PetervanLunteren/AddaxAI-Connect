"""
SQLAlchemy database models

Defines the database schema for all tables.
All services import models from this file to ensure consistency.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, Boolean, JSON, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from geoalchemy2 import Geography
from datetime import datetime

from .database import Base


class Image(Base):
    """Camera trap image"""
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False, index=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    storage_path = Column(String(512), nullable=False)
    thumbnail_path = Column(String(512), nullable=True)  # Path to thumbnail in MinIO
    status = Column(String(50), nullable=False, default="pending", index=True)
    image_metadata = Column(JSON)  # Renamed from 'metadata' to avoid SQLAlchemy reserved name

    # Human verification fields
    is_verified = Column(Boolean, nullable=False, default=False, index=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    verified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verification_notes = Column(Text, nullable=True)

    # Relationships
    camera = relationship("Camera", back_populates="images")
    detections = relationship("Detection", back_populates="image", cascade="all, delete-orphan")
    human_observations = relationship("HumanObservation", back_populates="image", cascade="all, delete-orphan")
    verified_by = relationship("User", foreign_keys=[verified_by_user_id])


class Camera(Base):
    """Camera trap device"""
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    location = Column(Geography(geometry_type='POINT', srid=4326), nullable=True)
    installed_at = Column(DateTime(timezone=True), nullable=True)
    config = Column(JSON)

    # Identifiers
    imei = Column(String(50), nullable=True, index=True, unique=True)
    manufacturer = Column(String(100), nullable=True, index=True)
    model = Column(String(100), nullable=True, index=True)
    hardware_revision = Column(String(50), nullable=True)

    # Flexible key-value metadata (replaces fixed serial_number, box, order, etc.)
    metadata = Column(JSON, nullable=True)

    # Project assignment
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True, index=True)
    status = Column(String(50), nullable=False, server_default='inventory', index=True)

    # Health metrics (from daily reports)
    battery_percent = Column(Integer, nullable=True)
    sd_used_mb = Column(Integer, nullable=True)
    sd_total_mb = Column(Integer, nullable=True)
    temperature_c = Column(Integer, nullable=True)
    signal_quality = Column(Integer, nullable=True)

    # Timestamps
    last_seen = Column(DateTime(timezone=True), nullable=True, index=True)
    last_daily_report_at = Column(DateTime(timezone=True), nullable=True)
    last_image_at = Column(DateTime(timezone=True), nullable=True)
    last_maintenance_at = Column(DateTime(timezone=True), nullable=True)

    # Metadata
    tags = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    # Relationships
    images = relationship("Image", back_populates="camera")


class CameraDeploymentPeriod(Base):
    """
    Camera deployment period - tracks when/where a camera was deployed.

    A new deployment is created when:
    - Camera GPS moves >100m from previous location
    - First image/report received for a camera

    Used for:
    - Effort-corrected detection rate calculations (trap-days)
    - CamtrapDP export (future)
    - Camera relocation history
    """
    __tablename__ = "camera_deployment_periods"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    deployment_id = Column(Integer, nullable=False)  # Sequence number per camera (1, 2, 3...)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)  # NULL = currently active deployment
    location = Column(Geography(geometry_type='POINT', srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class CameraHealthReport(Base):
    """
    Historical camera health reports from daily status messages.

    Each daily report is stored as a separate row, enabling time-series
    analysis of battery, signal, temperature, SD utilization, and image counts.

    Used for:
    - Debugging camera issues over time
    - Visualizing health trends in charts
    - Identifying patterns (e.g., battery drain, signal loss)
    """
    __tablename__ = "camera_health_reports"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    report_date = Column(Date, nullable=False, index=True)  # Date of the daily report

    # Health metrics
    battery_percent = Column(Integer, nullable=True)  # 0-100
    signal_quality = Column(Integer, nullable=True)   # CSQ value (0-31)
    temperature_c = Column(Integer, nullable=True)    # Celsius
    sd_utilization_percent = Column(Float, nullable=True)  # 0-100

    # Image counts from SD card
    total_images = Column(Integer, nullable=True)     # Images on SD card
    sent_images = Column(Integer, nullable=True)      # Images already transmitted

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Unique constraint: one report per camera per day
    __table_args__ = (
        UniqueConstraint('camera_id', 'report_date', name='uq_camera_report_date'),
    )


class Detection(Base):
    """Object detection result"""
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False, index=True)
    category = Column(String(50), nullable=True, index=True)  # animal, person, vehicle
    bbox = Column(JSON, nullable=False)  # {x, y, width, height}
    confidence = Column(Float, nullable=False)

    # Relationships
    image = relationship("Image", back_populates="detections")
    classifications = relationship("Classification", back_populates="detection", cascade="all, delete-orphan")


class Classification(Base):
    """Species classification result"""
    __tablename__ = "classifications"

    id = Column(Integer, primary_key=True, index=True)
    detection_id = Column(Integer, ForeignKey("detections.id"), nullable=False, index=True)
    species = Column(String(255), nullable=False, index=True)  # Top-1 species
    confidence = Column(Float, nullable=False)  # Top-1 confidence

    # Relationships
    detection = relationship("Detection", back_populates="classifications")


class HumanObservation(Base):
    """Human-entered species observation for an image (image-level, not detection-level)"""
    __tablename__ = "human_observations"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id", ondelete="CASCADE"), nullable=False, index=True)
    species = Column(String(255), nullable=False, index=True)
    count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    image = relationship("Image", back_populates="human_observations")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])


class Project(Base):
    """Project/study area with species configuration"""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    location = Column(Geography(geometry_type='POLYGON', srid=4326), nullable=True)
    included_species = Column(JSON, nullable=True)  # List of species names that ARE present in project area (null = all species)
    image_path = Column(String(512), nullable=True)  # MinIO path to original project image
    thumbnail_path = Column(String(512), nullable=True)  # MinIO path to thumbnail (256x256)
    detection_threshold = Column(Float, nullable=False, server_default='0.5')  # Minimum confidence for detections to be visible (0.0-1.0)
    blur_people_vehicles = Column(Boolean, nullable=False, server_default='true')  # Blur detected people and vehicles in all images for privacy
    independence_interval_minutes = Column(Integer, nullable=False, server_default='0')  # Group same-species detections within N minutes as one event (0 = disabled)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class ProjectMembership(Base):
    """
    User membership in projects with role assignment.

    Maps users to projects with specific roles (project-admin or project-viewer).
    Server admins (is_server_admin=True) have implicit access to all projects
    and do not need entries in this table.

    A user can have different roles in different projects:
    - Alice: project-admin in Project A, project-viewer in Project B
    - Bob: project-admin in Project A, no access to Project B
    """
    __tablename__ = "project_memberships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False, index=True)  # 'project-admin' or 'project-viewer'
    added_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Unique constraint: user can only have one role per project
    __table_args__ = (
        UniqueConstraint('user_id', 'project_id', name='uq_user_project'),
    )


class User(Base):
    """User account (FastAPI-Users compatible)"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)  # Server admin flag (FastAPI-Users compatible)
    is_verified = Column(Boolean, default=False, nullable=False)

    # Note: role and project_id removed - now handled via ProjectMembership table


class AlertRule(Base):
    """Alert notification rule"""
    __tablename__ = "alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    rule_type = Column(String(50), nullable=False)  # species, battery, offline
    condition = Column(JSON, nullable=False)
    notification_method = Column(String(50), nullable=False)  # email, signal, whatsapp
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AlertLog(Base):
    """Alert notification history"""
    __tablename__ = "alert_logs"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("alert_rules.id"), nullable=False)
    triggered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    details = Column(JSON)
    status = Column(String(50), nullable=False)  # sent, failed


class ProjectNotificationPreference(Base):
    """Per-user per-project notification preferences"""
    __tablename__ = "project_notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, server_default="false")
    telegram_chat_id = Column(String(50), nullable=True)  # Telegram chat ID
    report_email = Column(String(255), nullable=True)  # Custom email for reports (defaults to user email if null)
    notify_species = Column(JSON, nullable=True)  # DEPRECATED: Use notification_channels instead
    notify_low_battery = Column(Boolean, nullable=False, server_default="true")  # DEPRECATED: Use notification_channels instead
    battery_threshold = Column(Integer, nullable=False, server_default="30")  # DEPRECATED: Use notification_channels instead
    notify_system_health = Column(Boolean, nullable=False, server_default="false")  # DEPRECATED: Use notification_channels instead
    notification_channels = Column(JSON, nullable=True)  # Per-notification-type channel configuration
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    # Unique constraint: one preference per user per project
    __table_args__ = (
        UniqueConstraint('user_id', 'project_id', name='uq_user_project_notification'),
    )


class NotificationLog(Base):
    """Audit trail for all sent notifications"""
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    notification_type = Column(String(50), nullable=False, index=True)  # species_detection, low_battery, system_health
    channel = Column(String(50), nullable=False, index=True)  # signal, email, sms, earthranger
    status = Column(String(50), nullable=False, index=True)  # pending, sent, failed
    trigger_data = Column(JSON, nullable=False)  # Event that triggered notification
    message_content = Column(Text, nullable=False)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class TelegramConfig(Base):
    """System-wide Telegram bot configuration (admin only, single row)"""
    __tablename__ = "telegram_config"

    id = Column(Integer, primary_key=True)
    bot_token = Column(String(100), nullable=True)  # From @BotFather
    bot_username = Column(String(100), nullable=True)  # e.g., "AddaxAI_bot"
    is_configured = Column(Boolean, nullable=False, server_default="false")
    last_health_check = Column(DateTime(timezone=True), nullable=True)
    health_status = Column(String(50), nullable=True)  # healthy, error, not_configured
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class ServerSettings(Base):
    """Server-wide settings (single row)"""
    __tablename__ = "server_settings"

    id = Column(Integer, primary_key=True)
    timezone = Column(String(50), nullable=True)  # NULL = not configured yet
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class TelegramLinkingToken(Base):
    """Temporary tokens for automated Telegram account linking via deep links"""
    __tablename__ = "telegram_linking_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used = Column(Boolean, nullable=False, server_default="false")


class ProjectDocument(Base):
    """Project document/file uploaded by admin"""
    __tablename__ = "project_documents"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    storage_path = Column(String(512), nullable=False)
    file_size = Column(Integer, nullable=False)
    content_type = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    uploaded_by = relationship("User", foreign_keys=[uploaded_by_user_id])


class SpeciesTaxonomy(Base):
    """
    Maps common species names (from classification models) to scientific names.

    Global lookup table used for CamTrap DP export and other biodiversity standards.
    Pre-populated for DeepFaune v1.4. Future models (e.g., SpeciesNet) add their own entries.
    """
    __tablename__ = "species_taxonomy"

    id = Column(Integer, primary_key=True, index=True)
    common_name = Column(String(255), unique=True, nullable=False, index=True)
    scientific_name = Column(String(255), nullable=True)  # null = unmapped (e.g., "micromammal")
    taxon_rank = Column(String(50), nullable=False, server_default='species')  # species, genus, family, order, class
    model_source = Column(String(100), nullable=False, server_default='deepfaune')
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class UserInvitation(Base):
    """
    Pending user invitations.

    Tracks emails that have been invited but haven't registered yet.
    When user registers, their pre-assigned project memberships are automatically applied.

    For project-level invitations (project-admin, project-viewer):
    - project_id and role are set

    For server-admin invitations:
    - project_id is NULL (server admins have access to all projects)
    - role is 'server-admin'

    Security: Uses secure tokens for invitation links. Token proves email ownership.
    """
    __tablename__ = "user_invitations"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    invited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)  # NULL for server-admin
    role = Column(String(50), nullable=False, index=True)  # 'server-admin', 'project-admin', or 'project-viewer'
    token = Column(String(64), unique=True, nullable=True, index=True)  # Secure URL-safe token for invite link
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)  # Expiry date (default 7 days)
    used = Column(Boolean, nullable=False, server_default="false", index=True)  # Whether invitation has been accepted
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
