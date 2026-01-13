"""
Configuration management using Pydantic Settings

Loads configuration from environment variables with validation.
Crashes if required variables are missing (explicit configuration principle).
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    All settings are required unless explicitly marked Optional.
    System will crash on startup if required settings are missing.
    """

    # Database
    database_url: str

    # Redis
    redis_url: str

    # MinIO
    minio_endpoint: str
    minio_public_endpoint: Optional[str] = None  # Public URL for presigned URLs (e.g., https://dev.addaxai.com/minio)
    minio_access_key: str
    minio_secret_key: str
    minio_secure: bool = False

    # JWT (API only)
    jwt_secret: Optional[str] = None
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24

    # CORS (API only)
    cors_origins: Optional[str] = None

    # ML Models (workers only)
    detection_model_path: Optional[str] = None
    classification_model_path: Optional[str] = None
    use_gpu: bool = False

    # FTPS (ingestion only)
    ftps_upload_dir: Optional[str] = None

    # Email (API only)
    mail_server: Optional[str] = None
    mail_port: Optional[int] = None
    mail_username: Optional[str] = None
    mail_password: Optional[str] = None
    mail_from: Optional[str] = None
    domain_name: Optional[str] = None  # For constructing verification links

    # API (for internal service-to-service communication)
    api_host: Optional[str] = "api:8000"  # Internal API endpoint for workers

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"  # "json" or "text" (text for human-readable dev logs)
    environment: str = "development"

    # Project management
    default_project_name: str = "Wildlife Monitoring"  # Name for auto-created default project

    class Config:
        env_file = ".env"
        case_sensitive = False


def get_settings() -> Settings:
    """
    Get application settings.

    Crashes loudly if required configuration is missing.
    """
    return Settings()
