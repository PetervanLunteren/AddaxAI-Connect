"""
SQLAlchemy database models

Defines the database schema for all tables.
All services import models from this file to ensure consistency.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, JSON, Text
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

    # Relationships
    images = relationship("Image", back_populates="camera")


class Detection(Base):
    """Object detection result"""
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False, index=True)
    bbox = Column(JSON, nullable=False)  # {x, y, width, height}
    confidence = Column(Float, nullable=False)
    crop_path = Column(String(512), nullable=False)

    # Relationships
    image = relationship("Image", back_populates="detections")
    classifications = relationship("Classification", back_populates="detection", cascade="all, delete-orphan")


class Classification(Base):
    """Species classification result"""
    __tablename__ = "classifications"

    id = Column(Integer, primary_key=True, index=True)
    detection_id = Column(Integer, ForeignKey("detections.id"), nullable=False, index=True)
    species = Column(String(255), nullable=False, index=True)
    confidence = Column(Float, nullable=False)

    # Relationships
    detection = relationship("Detection", back_populates="classifications")


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
    project_id = Column(Integer, nullable=True)  # Will add FK constraint when projects table exists


class EmailAllowlist(Base):
    """Allowed emails/domains for registration"""
    __tablename__ = "email_allowlist"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=True, unique=True)
    domain = Column(String(255), nullable=True)
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
