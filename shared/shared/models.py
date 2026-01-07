"""
SQLAlchemy database models

Defines the database schema for all tables.
All services import models from this file to ensure consistency.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, Boolean, JSON, Text
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

    # Relationships
    camera = relationship("Camera", back_populates="images")
    detections = relationship("Detection", back_populates="image", cascade="all, delete-orphan")


class Camera(Base):
    """Camera trap device"""
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    location = Column(Geography(geometry_type='POINT', srid=4326), nullable=True)
    installed_at = Column(DateTime(timezone=True), nullable=True)
    config = Column(JSON)

    # Identifiers (from camera management migration)
    serial_number = Column(String(50), nullable=True, index=True, unique=True)
    imei = Column(String(50), nullable=True, index=True, unique=True)
    manufacturer = Column(String(100), nullable=True, index=True)
    model = Column(String(100), nullable=True, index=True)
    hardware_revision = Column(String(50), nullable=True)

    # Inventory tracking
    box = Column(String(100), nullable=True)
    order = Column(String(50), nullable=True)
    scanned_date = Column(Date, nullable=True)

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
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


class User(Base):
    """User account (FastAPI-Users compatible)"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)

    # RBAC and multi-tenancy (schema ready, enforcement later)
    role = Column(String(50), nullable=True)  # admin, analyst, viewer
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)


class EmailAllowlist(Base):
    """
    Allowed emails/domains for registration.

    Determines who can register and whether they become server admins.
    - is_superuser=True: User becomes admin with full control over all projects
    - is_superuser=False: Regular user (will get project-specific roles later)
    """
    __tablename__ = "email_allowlist"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=True, unique=True)
    domain = Column(String(255), nullable=True)
    is_superuser = Column(Boolean, default=False, nullable=False)  # Admin flag
    added_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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


class NotificationPreference(Base):
    """Per-user notification preferences"""
    __tablename__ = "notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    enabled = Column(Boolean, nullable=False, server_default="false")
    signal_phone = Column(String(20), nullable=True)  # E.164 format: +1234567890
    notify_species = Column(JSON, nullable=True)  # null = all species, or list like ["wolf", "bear"]
    notify_low_battery = Column(Boolean, nullable=False, server_default="true")
    battery_threshold = Column(Integer, nullable=False, server_default="30")  # Percentage
    notify_system_health = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)


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


class SignalConfig(Base):
    """System-wide Signal configuration (admin only, single row)"""
    __tablename__ = "signal_config"

    id = Column(Integer, primary_key=True)
    phone_number = Column(String(20), nullable=True)  # E.164 format
    device_name = Column(String(100), nullable=False, server_default="AddaxAI-Connect")
    is_registered = Column(Boolean, nullable=False, server_default="false")
    last_health_check = Column(DateTime(timezone=True), nullable=True)
    health_status = Column(String(50), nullable=True)  # healthy, error, not_configured
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
