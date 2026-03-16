"""
Configuration for SpeciesNet classification worker

Loads environment variables and validates required settings.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class ClassificationSettings(BaseSettings):
    """
    SpeciesNet classification worker configuration.

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

    # SpeciesNet model configuration
    speciesnet_model_dir: str = "/models/classification-speciesnet"
    speciesnet_hf_repo: str = "Addax-Data-Science/SPECIESNET-v4-0-1-A-v1"

    # Model parameters
    confidence_threshold: float = 0.0  # Store all predictions

    # Top-N predictions to store (1 = top-1 only)
    top_n_predictions: int = 1

    # Geofencing (enables SpeciesNet ensemble for geographic filtering)
    speciesnet_country_code: Optional[str] = None    # ISO 3166-1 alpha-3
    speciesnet_admin1_region: Optional[str] = None   # ISO 3166-2 (US states)

    # GPU configuration (auto-detect if not set)
    use_gpu: Optional[bool] = None

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"

    class Config:
        env_file = ".env"
        case_sensitive = False


def get_settings() -> ClassificationSettings:
    """Get validated settings instance"""
    return ClassificationSettings()
