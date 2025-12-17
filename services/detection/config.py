"""
Configuration for detection worker

Loads environment variables and validates required settings.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class DetectionSettings(BaseSettings):
    """
    Detection worker configuration.

    All required settings must be provided via environment variables.
    Missing required settings will cause the worker to crash on startup.
    """

    # Database
    database_url: str

    # Redis
    redis_url: str

    # MinIO
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str

    # Model configuration
    detection_model_url: str = "https://github.com/agentmorris/MegaDetector/releases/download/v1000.0/md_v1000.0.0-redwood.pt"
    detection_model_path: str = "/models/detection/md_v1000.0.0-redwood.pt"
    confidence_threshold: float = 0.1

    # GPU configuration (auto-detect if not set)
    use_gpu: Optional[bool] = None

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"

    class Config:
        env_file = ".env"
        case_sensitive = False


def get_settings() -> DetectionSettings:
    """Get validated settings instance"""
    return DetectionSettings()
