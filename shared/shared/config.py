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
    minio_access_key: str
    minio_secret_key: str
    minio_secure: bool = False

    # JWT (API only)
    jwt_secret: Optional[str] = None
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24

    # ML Models (workers only)
    model_detection_path: Optional[str] = None
    model_classification_path: Optional[str] = None
    use_gpu: bool = False

    # FTPS (ingestion only)
    ftps_upload_dir: Optional[str] = None

    # Logging
    log_level: str = "INFO"
    environment: str = "development"

    class Config:
        env_file = ".env"
        case_sensitive = False


def get_settings() -> Settings:
    """
    Get application settings.

    Crashes loudly if required configuration is missing.
    """
    return Settings()
