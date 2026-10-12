"""
Privacy removal: replace a photo of a person or a vehicle with a placeholder.

A project can ask (Project.delete_people, Project.delete_vehicles) that the
photo of a detected person or vehicle is not kept. The image row, its
detections and its timestamps stay, so alerts, the theft watch, camera
liveness, bulk job progress and every statistic keep working. Only the
pixels go: the raw object and the thumbnail are replaced by a plain grey
image that says what the photo showed. Every reader in the app keeps
finding an object at the same key, so nothing else has to know. The row is
stamped (Image.privacy_removed_at) by the caller once this has succeeded.

Pillow is imported inside the drawing functions. It is pinned in every
service that calls them (both classifiers, the API) and deliberately not a
dependency of the shared package, which lighter workers install too.
"""
from io import BytesIO
from typing import Iterable

from .storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS

# Fixed order, so the sentence always reads "a person and a vehicle".
PRIVACY_CATEGORIES = ("person", "vehicle")
# Used when the row carries no dimensions (metadata without width/height).
FALLBACK_SIZE = (1600, 1200)
# Same width ingestion gives a thumbnail (services/ingestion/storage_operations.py).
THUMBNAIL_WIDTH = 300


def shown_categories(detections: Iterable, threshold: float) -> list[str]:
    """The person/vehicle categories the image shows at or above the threshold.

    The same rule as the blur. Works on anything with .category and
    .confidence (the workers' DetectionInfo, the ORM Detection).
    """
    present = {d.category for d in detections if d.confidence >= threshold}
    return [c for c in PRIVACY_CATEGORIES if c in present]


def removed_categories(detections: Iterable, project) -> list[str]:
    """Categories this project removes that the image shows above its threshold.

    An empty list means the photo is kept.
    """
    wanted = project.delete_categories()
    return [
        c for c in shown_categories(detections, project.detection_threshold) if c in wanted
    ]


def removal_sentence(categories: list[str]) -> str:
    """The sentence drawn on the placeholder."""
    if not categories:
        return "This photo was removed for privacy."
    what = " and ".join(f"a {c}" for c in categories)
    return f"This photo showed {what} and was removed for privacy."


def placeholder_jpeg(width: int, height: int, sentence: str) -> bytes:
    """A plain grey JPEG of the given size with the sentence centred on it.

    Pillow's built-in font is used, so the images need no font files.
    """
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (width, height), (120, 120, 120))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=max(12, width // 28))
    lines = _wrap(sentence, draw, font, max_width=int(width * 0.8))

    line_height = draw.textbbox((0, 0), "Ag", font=font)[3]
    gap = line_height // 2
    total = len(lines) * line_height + (len(lines) - 1) * gap
    y = (height - total) // 2
    for line in lines:
        x = (width - draw.textlength(line, font=font)) / 2
        draw.text((x, y), line, fill=(245, 245, 245), font=font)
        y += line_height + gap

    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _wrap(text: str, draw, font, max_width: int) -> list[str]:
    """Greedy word wrap so no line is wider than max_width."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if not line or draw.textlength(candidate, font=font) <= max_width:
            line = candidate
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def replace_with_placeholder(storage: StorageClient, image, categories: list[str]) -> None:
    """Replace the raw photo and its thumbnail with the placeholder.

    Raw first, every version: the raw bucket is versioned, so an overwrite
    alone would keep the old bytes as a previous version. Then the
    placeholder is written at the same key, and a small one at the
    thumbnail key (that bucket is not versioned, so the overwrite is final).
    Raises on any failure, so the caller never stamps a row whose bytes are
    still there.
    """
    metadata = image.image_metadata or {}
    width = int(metadata.get("width") or 0) or FALLBACK_SIZE[0]
    height = int(metadata.get("height") or 0) or FALLBACK_SIZE[1]
    sentence = removal_sentence(categories)

    storage.delete_object_versions(BUCKET_RAW_IMAGES, image.storage_path)
    storage.upload_fileobj(
        BytesIO(placeholder_jpeg(width, height, sentence)),
        BUCKET_RAW_IMAGES,
        image.storage_path,
    )
    if image.thumbnail_path:
        thumb_height = max(1, round(height * THUMBNAIL_WIDTH / width))
        storage.upload_fileobj(
            BytesIO(placeholder_jpeg(THUMBNAIL_WIDTH, thumb_height, sentence)),
            BUCKET_THUMBNAILS,
            image.thumbnail_path,
        )
