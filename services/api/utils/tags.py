"""Tag normalization shared by the camera and site routers."""
from typing import List, Optional


def rename_tag_in_list(tags: Optional[List[str]], old: str, new: str) -> List[str]:
    """Replace one tag with another in a row's tag list. Renaming onto a tag
    the row already carries merges the two, normalize_tags collapses the
    duplicate and keeps the first position."""
    return normalize_tags([new if t == old else t for t in (tags or [])])


def normalize_tags(tags: Optional[List[str]]) -> List[str]:
    """Normalize tags: lowercase, strip, deduplicate, remove empties and commas."""
    if not tags:
        return []
    seen: set = set()
    result: List[str] = []
    for raw in tags:
        tag = raw.strip().lower().replace(',', '')
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result
