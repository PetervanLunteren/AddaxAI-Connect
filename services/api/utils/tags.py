"""Tag normalization shared by the camera and site routers."""
from typing import List, Optional


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
