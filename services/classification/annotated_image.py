"""
Generate annotated images with bounding boxes and species labels

Creates visualization images for notifications by drawing:
- Spotlight dim overlay with detection cutouts
- Rounded-rect bounding boxes with category-specific colors
- Label pills with color dot + two-line text layout
"""
from PIL import Image, ImageDraw, ImageFont
from typing import List, Tuple
from io import BytesIO

from shared.logger import get_logger
from shared.storage import StorageClient

logger = get_logger("classification.annotated_image")

# --- Constants (matching frontend detection-overlay.ts / WebUI) ---

BBOX_STROKE_WIDTH = 2
BBOX_CORNER_RADIUS = 4
DIM_OPACITY = 89          # 0.35 * 255 ≈ 89
PILL_BG_OPACITY = 128     # 0.5 * 255 ≈ 128
PILL_PAD_X = 6
PILL_PAD_Y = 4
DOT_R = 4
DOT_GAP = 5
LINE_GAP = 2
FONT_SM = 10
FONT_LG = 12
TEXT_START_X = PILL_PAD_X + DOT_R * 2 + DOT_GAP  # 19
PILL_CORNER_RADIUS = 5    # BBOX_CORNER_RADIUS + 1

CATEGORY_COLORS = {
    'animal': '#0f6064',
    'person': '#ff8945',
    'vehicle': '#71b7ba',
}
DEFAULT_COLOR = '#882000'


def get_category_color(category: str) -> str:
    return CATEGORY_COLORS.get(category, DEFAULT_COLOR)


def hex_to_rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


class Detection:
    """Detection with bbox coordinates"""
    def __init__(self, bbox: dict, category: str):
        self.bbox = bbox  # {x, y, width, height} in pixels
        self.category = category


class Classification:
    """Classification result with species and confidence"""
    def __init__(self, species: str, confidence: float):
        self.species = species
        self.confidence = confidence


def _normalize_label(label: str) -> str:
    """Normalize label: underscores to spaces, capitalize first letter."""
    s = label.replace('_', ' ')
    return s[0].upper() + s[1:] if s else s


def generate_annotated_image(
    image_path: str,
    detections: List[Tuple[Detection, Classification]],
    max_width: int = 1920
) -> bytes:
    """
    Generate annotated image with bounding boxes and species labels.

    Args:
        image_path: Path to local image file
        detections: List of (detection, classification) tuples
        max_width: Deprecated, not used (images are resized to 1280px internally)

    Returns:
        Image bytes (JPEG format)
    """
    try:
        MAX_WIDTH = 1280

        img = Image.open(image_path)
        if img.mode != 'RGB':
            img = img.convert('RGB')

        natural_width, natural_height = img.size

        # Resize for Telegram — reduces compression artifacts and speeds up upload
        resize_ratio = 1.0
        if natural_width > MAX_WIDTH:
            resize_ratio = MAX_WIDTH / natural_width
            new_height = round(natural_height * resize_ratio)
            img = img.resize((MAX_WIDTH, new_height), Image.LANCZOS)

        # Scale factor for annotation sizes (reference display width = 1000)
        scale = img.width / 1000

        logger.debug(
            "Generating annotated image",
            natural_size=f"{natural_width}x{natural_height}",
            output_size=f"{img.width}x{img.height}",
            scale_factor=scale
        )

        # Load fonts
        font_sm_size = max(1, round(FONT_SM * scale))
        font_lg_size = max(1, round(FONT_LG * scale))
        try:
            font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_sm_size)
            font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_lg_size)
        except Exception:
            font_sm = ImageFont.load_default()
            font_lg = font_sm
            logger.debug("Using default font for annotations")

        # Pre-compute all bbox rects in image coords
        rects = []
        for detection, classification in detections:
            bbox = detection.bbox
            x = bbox['x'] * resize_ratio
            y = bbox['y'] * resize_ratio
            w = bbox['width'] * resize_ratio
            h = bbox['height'] * resize_ratio
            rects.append((x, y, w, h))

        # --- 1. Spotlight dim overlay with detection cutouts ---
        corner_r = round(BBOX_CORNER_RADIUS * scale)
        overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        # Fill entire overlay with dim
        overlay_draw.rectangle([0, 0, img.width, img.height], fill=(0, 0, 0, DIM_OPACITY))
        # Cut out detection areas (draw transparent rounded rects)
        for (x, y, w, h) in rects:
            overlay_draw.rounded_rectangle(
                [round(x), round(y), round(x + w), round(y + h)],
                radius=corner_r,
                fill=(0, 0, 0, 0)
            )
        # Composite spotlight onto image
        img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')

        # --- 2. Bounding box outlines ---
        draw = ImageDraw.Draw(img)
        stroke_w = max(1, round(BBOX_STROKE_WIDTH * scale))

        for i, (detection, classification) in enumerate(detections):
            x, y, w, h = rects[i]
            color = get_category_color(detection.category)
            # Draw with reduced opacity by using an overlay for the bbox stroke
            bbox_overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
            bbox_draw = ImageDraw.Draw(bbox_overlay)
            rgb = hex_to_rgb(color)
            bbox_draw.rounded_rectangle(
                [round(x), round(y), round(x + w), round(y + h)],
                radius=corner_r,
                outline=(*rgb, 128),  # 50% opacity
                width=stroke_w
            )
            img = Image.alpha_composite(img.convert('RGBA'), bbox_overlay).convert('RGB')

        # --- 3. Label pills ---
        draw = ImageDraw.Draw(img)

        for i, (detection, classification) in enumerate(detections):
            x, y, w, h = rects[i]
            color = get_category_color(detection.category)
            color_rgb = hex_to_rgb(color)

            # Build label text
            category_text = f"{_normalize_label(detection.category)} {int(classification.confidence * 100)}%"
            if detection.category not in ('person', 'vehicle') and classification.species:
                species_display = classification.species.replace('_', ' ')
                species_display = species_display[0].upper() + species_display[1:] if species_display else species_display
                species_text = f"{species_display} {int(classification.confidence * 100)}%"
            else:
                species_text = None

            # Measure text widths
            pad_x = round(PILL_PAD_X * scale)
            pad_y = round(PILL_PAD_Y * scale)
            text_start_x = round(TEXT_START_X * scale)
            dot_r = round(DOT_R * scale)
            line_gap = round(LINE_GAP * scale)
            pill_corner_r = round(PILL_CORNER_RADIUS * scale)

            def _text_width(text, font):
                try:
                    bb = draw.textbbox((0, 0), text, font=font)
                    return bb[2] - bb[0]
                except AttributeError:
                    return draw.textsize(text, font=font)[0]

            def _text_height(text, font):
                try:
                    bb = draw.textbbox((0, 0), text, font=font)
                    return bb[3] - bb[1]
                except AttributeError:
                    return draw.textsize(text, font=font)[1]

            cat_w = _text_width(category_text, font_sm)
            spec_w = _text_width(species_text, font_lg) if species_text else 0

            content_w = max(cat_w, spec_w)
            pill_w = text_start_x + content_w + pad_x

            if species_text:
                pill_h = pad_y + font_sm_size + line_gap + font_lg_size + pad_y
            else:
                pill_h = pad_y + font_lg_size + pad_y

            # Position pill above bbox
            margin = round(4 * scale)
            pill_y = y - pill_h - margin
            if pill_y < margin:
                pill_y = y + h + margin
                if pill_y + pill_h > img.height - margin:
                    pill_y = max(margin, y)
            pill_x = max(margin, min(x, img.width - pill_w - margin))

            # Draw pill background (semi-transparent)
            px, py = round(pill_x), round(pill_y)
            pw, ph = round(pill_w), round(pill_h)

            pill_overlay = Image.new('RGBA', (pw, ph), (0, 0, 0, 0))
            pill_draw = ImageDraw.Draw(pill_overlay)
            pill_draw.rounded_rectangle(
                [0, 0, pw, ph],
                radius=pill_corner_r,
                fill=(0, 0, 0, PILL_BG_OPACITY)
            )
            img = Image.alpha_composite(
                img.convert('RGBA'),
                _paste_overlay(pill_overlay, px, py, img.size)
            ).convert('RGB')
            draw = ImageDraw.Draw(img)

            # Color dot (centered vertically in pill)
            dot_cx = px + pad_x + dot_r
            dot_cy = py + ph // 2
            draw.ellipse(
                [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
                fill=color
            )

            # Text
            text_x = px + text_start_x

            if species_text:
                # Category line (small, dimmed)
                draw.text(
                    (text_x, py + pad_y),
                    category_text,
                    fill=(200, 200, 200),
                    font=font_sm
                )
                # Species line (large, bold, white)
                draw.text(
                    (text_x, py + pad_y + font_sm_size + line_gap),
                    species_text,
                    fill='white',
                    font=font_lg
                )
            else:
                # Single line (large, bold, white, vertically centered)
                th = _text_height(category_text, font_lg)
                text_y = py + (ph - th) // 2
                draw.text(
                    (text_x, text_y),
                    category_text,
                    fill='white',
                    font=font_lg
                )

        # Save to bytes
        output = BytesIO()
        img.save(output, format='JPEG', quality=90, optimize=True)
        output_bytes = output.getvalue()

        logger.debug(
            "Generated annotated image",
            num_annotations=len(detections),
            output_size_kb=len(output_bytes) // 1024
        )

        return output_bytes

    except Exception as e:
        logger.error(
            "Failed to generate annotated image",
            image_path=image_path,
            error=str(e),
            exc_info=True
        )
        raise


def _paste_overlay(overlay: Image.Image, x: int, y: int, canvas_size: tuple) -> Image.Image:
    """Create a full-canvas-size RGBA image with the overlay pasted at (x, y)."""
    full = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
    full.paste(overlay, (x, y))
    return full


def upload_annotated_image_to_minio(
    image_bytes: bytes,
    image_uuid: str
) -> str:
    """
    Upload annotated image to MinIO thumbnails bucket.

    Args:
        image_bytes: Image data (JPEG)
        image_uuid: UUID of source image

    Returns:
        Storage path in MinIO
    """
    try:
        object_path = f"annotated/{image_uuid}.jpg"

        storage = StorageClient()
        buffer = BytesIO(image_bytes)
        storage.upload_fileobj(
            file_obj=buffer,
            bucket='thumbnails',
            object_name=object_path
        )

        logger.debug(
            "Uploaded annotated image to MinIO",
            image_uuid=image_uuid,
            storage_path=object_path
        )

        return object_path

    except Exception as e:
        logger.error(
            "Failed to upload annotated image",
            image_uuid=image_uuid,
            error=str(e),
            exc_info=True
        )
        raise
