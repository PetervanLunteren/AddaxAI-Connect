"""Tag normalization shared by the camera and site routers."""
from typing import Iterable, List, Optional

# The tag widget's limit (MAX_TAG_LENGTH in TagInput.tsx), enforced here too
# so a direct API call cannot store what the UI would refuse.
MAX_TAG_LENGTH = 50


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


def tag_length_error(
    tags: Optional[List[str]], existing: Optional[Iterable[str]] = None,
) -> Optional[str]:
    """Error message when a new tag is longer than MAX_TAG_LENGTH, else None.

    Tags the row already carries pass, so a long tag stored before this
    check existed cannot block every later edit of that row.
    """
    known = set(existing or [])
    if any(len(t) > MAX_TAG_LENGTH and t not in known for t in normalize_tags(tags)):
        return f"A tag can be at most {MAX_TAG_LENGTH} characters"
    return None
