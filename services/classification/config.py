"""
Configuration for classification worker

Loads environment variables and validates required settings.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class ClassificationSettings(BaseSettings):
    """
    Classification worker configuration.

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

    # Model configuration (DeepFaune v1.4)
    classification_model_url: str = "https://huggingface.co/Addax-Data-Science/Deepfaune_v1.4/resolve/main/deepfaune-vit_large_patch14_dinov2.lvd142m.v4.pt?download=true"
    classification_model_path: str = "/models/classification/deepfaune-vit_large_patch14_dinov2.lvd142m.v4.pt"

    # Model parameters
    crop_resolution: int = 182  # DeepFaune uses 182x182 crops
    confidence_threshold: float = 0.0  # Store all predictions

    # Top-N predictions to store (1 = top-1 only)
    top_n_predictions: int = 1

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
