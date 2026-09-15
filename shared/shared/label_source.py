"""
Which labels a statistic counts.

Every statistic that counts animals has two possible sources per image: the
rows a person entered when they verified it, and the AI detections and
classifications above the project's thresholds. The default, "merged", takes
the human rows where an image is verified and the AI rows elsewhere. The two
other sources exist so someone can measure what verification changed, or
compare sites that were verified unevenly on one consistent basis.

This module is the one definition of the three sources and of what each one
means in a query. The SQLAlchemy builders in the API and the raw SQL templates
in the shared independence CTE both read the scope from here, so "verified"
cannot mean one thing on the dashboard and another on an insights page.
"""
from dataclasses import dataclass
from typing import Literal

LabelSource = Literal["merged", "verified", "ai"]
LABEL_SOURCES: tuple = ("merged", "verified", "ai")
DEFAULT_LABEL_SOURCE: LabelSource = "merged"


@dataclass(frozen=True)
class LabelScope:
    """What a query includes for one label source.

    include_verified: count the human observation rows of verified images.
    include_ai: count the AI rows at all.
    ai_all_images: take the AI rows of every image, verified ones too. Only
        the "ai" source sets this; "merged" takes AI rows from unverified
        images only, so nothing is counted twice.
    """
    include_verified: bool
    include_ai: bool
    ai_all_images: bool

    @property
    def verified_sql(self) -> str:
        """Predicate for the human branch, on the images alias ``i``."""
        return "i.is_verified = true" if self.include_verified else "FALSE"

    @property
    def ai_sql(self) -> str:
        """Predicate for the AI branches, on the images alias ``i``."""
        if not self.include_ai:
            return "FALSE"
        return "TRUE" if self.ai_all_images else "i.is_verified = false"


_SCOPES = {
    "merged": LabelScope(include_verified=True, include_ai=True, ai_all_images=False),
    "verified": LabelScope(include_verified=True, include_ai=False, ai_all_images=False),
    "ai": LabelScope(include_verified=False, include_ai=True, ai_all_images=True),
}


def label_scope(source: str) -> LabelScope:
    """The scope for a source. Raises on anything but the three names, so a
    typo in a caller cannot silently fall back to counting everything."""
    try:
        return _SCOPES[source]
    except KeyError:
        raise ValueError(f"Unknown label source {source!r}, expected one of {LABEL_SOURCES}")
