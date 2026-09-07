"""
Display names of the classification models a server can run.

Read by the API for the About page and by the notifications coordinator
for the classifier field in outbound observations, so both say the same
name and version.
"""
from typing import Dict, Optional

CLASSIFICATION_MODELS: Dict[str, Dict[str, str]] = {
    "deepfaune": {
        "name": "DeepFaune v1.4",
        "url": "https://www.deepfaune.cnrs.fr/en/",
        "description": "a species classification model",
    },
    "speciesnet": {
        "name": "SpeciesNet v4.0.1",
        "url": "https://github.com/google/cameratrapai",
        "description": "a species classification model",
    },
}


def model_info(key: Optional[str]) -> Dict[str, str]:
    """The server's classifier by its CLASSIFICATION_MODEL key. Unset or
    unknown falls back to deepfaune, the rule the About page always had."""
    return CLASSIFICATION_MODELS.get(key or "deepfaune", CLASSIFICATION_MODELS["deepfaune"])
