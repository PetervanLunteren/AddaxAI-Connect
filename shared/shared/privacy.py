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
        # A curation removal of a photo with no person or vehicle in it. The
        # admin never said why, so the placeholder does not claim a reason.
        return "This photo was removed. Only the record is kept."
    what = " and ".join(f"a {c}" for c in categories)
    return f"This photo showed {what} and was removed for privacy."


def placeholder_jpeg(width: int, height: int, sentence: str) -> bytes:
    """A plain grey JPEG of the given size with the sentence tiled across it
    as a small watermark, at 45 degrees.

    Tiled on purpose: the placeholder is an ordinary image to the rest of
    the app. The privacy blur still smears the person box on it, a crop can
    be cut from it, a thumbnail is resized from it, and in every case some
    of the text survives, so nothing downstream needs a special case.
    Pillow's built-in font is used, so the images need no font files.
    """
    from PIL import Image, ImageDraw, ImageFont

    canvas = Image.new("RGB", (width, height), (120, 120, 120))

    # One tile: the sentence on a transparent strip, rotated.
    font = ImageFont.load_default(size=max(10, width // 70))
    probe = ImageDraw.Draw(canvas)
    left, top, right, bottom = probe.textbbox((0, 0), sentence, font=font)
    strip = Image.new("RGBA", (right - left + 8, bottom - top + 8), (0, 0, 0, 0))
    ImageDraw.Draw(strip).text((4 - left, 4 - top), sentence, fill=(225, 225, 225, 255), font=font)
    tile = strip.rotate(45, expand=True)

    # The text runs along one diagonal of its tile. Rows step by a third
    # of a tile, so the lines of text sit close together; columns step by
    # a whole tile, so two tiles never print on the same stretch of a line.
    for y in range(-tile.height, height, tile.height // 3):
        for x in range(-tile.width, width, tile.width):
            canvas.paste(tile, (x, y), tile)

    buffer = BytesIO()
    canvas.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


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
