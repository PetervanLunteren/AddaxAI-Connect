"""
The models this worker holds in memory.

A server's projects can use different models, so the worker keeps one loaded
model per catalog id. At start it loads the models the existing projects
use; a model a new project picked loads on its first image. Nothing is ever
dropped: a load costs a download and a minute of CPU, and the API only lets
a project pick a model that fits next to the loaded ones (see
shared.classification_models.fits_in_memory).

Weights come from the model's HuggingFace repo at the catalog's pinned
commit, into one folder per model under settings.models_dir. The marker
file records which commit the folder holds, so a restart never touches the
network for a model that is already there.

This module imports no ML library, so the routing and the lazy load are
unit-tested without torch. The loaders live in fixed_model.py and
speciesnet_model.py and are imported on first use.
"""
import ctypes
import sys
from pathlib import Path
from typing import Callable, Dict, Iterable, Optional, Protocol

from shared.classification_models import FIXED, ClassificationModel, get_model
from shared.logger import get_logger

from records import Classification, DetectionInfo, ProjectConfig

logger = get_logger("classification.registry")

REVISION_MARKER = ".revision"


class LoadedModel(Protocol):
    def classify(
        self, image_path: str, detections: list[DetectionInfo], project: ProjectConfig
    ) -> list[Classification]: ...


Loader = Callable[[ClassificationModel, Path, str], LoadedModel]


def available_memory_mb() -> int:
    """The host's free memory, MemAvailable from /proc/meminfo. The
    container has no memory limit, so the host figure is the one that
    decides whether another model fits."""
    with open("/proc/meminfo") as meminfo:
        for line in meminfo:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    raise RuntimeError("MemAvailable not found in /proc/meminfo")


def release_freed_memory() -> None:
    """Hand the memory a load freed back to the kernel.

    Loading reads the whole checkpoint into memory and frees it once the
    weights are in the model, but glibc keeps the freed arenas: measured on
    dev, DeepFaune v1.5 sat at 3.0 GB after its load and 1.9 GB after this
    trim, the TorchScript model at 2.2 GB and 1.2 GB. The free memory the
    worker reports, and so which models a new project may pick, depends on
    it. Linux only; macOS has no malloc_trim and no worker runs there.
    """
    if sys.platform.startswith("linux"):
        ctypes.CDLL("libc.so.6").malloc_trim(0)


def download_snapshot(repo_id: str, revision: str, local_dir: str) -> None:
    """One HuggingFace repo at one commit into local_dir. Imported here so
    the registry's routing is testable without huggingface_hub."""
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=repo_id, revision=revision, local_dir=local_dir)


def ensure_downloaded(model: ClassificationModel, models_dir: str) -> Path:
    """The model's folder, downloaded at the pinned commit when it is not
    there yet or holds another commit."""
    model_dir = Path(models_dir) / model.id
    marker = model_dir / REVISION_MARKER
    if marker.exists() and marker.read_text().strip() == model.revision:
        return model_dir
    logger.info("Downloading model", model=model.id, repo=model.hf_repo, revision=model.revision)
    download_snapshot(model.hf_repo, model.revision, str(model_dir))
    marker.write_text(model.revision)
    logger.info("Model downloaded", model=model.id, model_dir=str(model_dir))
    return model_dir


def _default_loaders() -> Dict[str, Loader]:
    import fixed_model
    import speciesnet_model
    return {FIXED: fixed_model.load, "speciesnet": speciesnet_model.load}


class ModelRegistry:
    def __init__(self, device: str, models_dir: str, loaders: Optional[Dict[str, Loader]] = None):
        self.device = device
        self.models_dir = models_dir
        self._loaders = loaders
        self._models: Dict[str, LoadedModel] = {}

    @property
    def loaded(self) -> list[str]:
        return sorted(self._models)

    def get(self, model_id: str) -> LoadedModel:
        """The loaded model, loading it first when this is its first use."""
        if model_id not in self._models:
            model = get_model(model_id)
            if self._loaders is None:
                self._loaders = _default_loaders()
            logger.info("Loading model", model=model.id, device=self.device)
            model_dir = ensure_downloaded(model, self.models_dir)
            self._models[model_id] = self._loaders[model.kind](model, model_dir, self.device)
            release_freed_memory()
            logger.info("Model loaded", model=model.id, loaded=self.loaded)
        return self._models[model_id]

    def load_all(self, model_ids: Iterable[str]) -> None:
        """Load the given models, going on past one that fails: its images
        fail visibly later, and a retry happens on their next image."""
        for model_id in model_ids:
            try:
                self.get(model_id)
            except Exception as e:
                logger.error("Model failed to load", model=model_id, error=str(e), exc_info=True)
