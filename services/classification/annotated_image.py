"""
Generate annotated images with bounding boxes and species labels

Creates visualization images for notifications by drawing:
- Bounding boxes around detections
- Species labels with confidence scores
"""
from PIL import Image, ImageDraw, ImageFont
from typing import List, Tuple
from io import BytesIO

from shared.logger import get_logger
from shared.storage import StorageClient

logger = get_logger("classification.annotated_image")


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


def generate_annotated_image(
    image_path: str,
    detections: List[Tuple[Detection, Classification]],
    max_width: int = 1920
) -> bytes:
    """
    Generate annotated image with bounding boxes and species labels.
    Uses the same logic as ImageDetailModal's handleDownload function.

    Args:
        image_path: Path to local image file
        detections: List of (detection, classification) tuples
        max_width: Deprecated, not used (images are resized to 1280px internally)

    Returns:
        Image bytes (JPEG format)

    Raises:
        Exception: If image generation fails
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

        # Scale factor matching annotated_image_generator.py (display_width=1000)
        display_width = 1000
        scale_factor = img.width / display_width

        logger.debug(
            "Generating annotated image",
            natural_size=f"{natural_width}x{natural_height}",
            output_size=f"{img.width}x{img.height}",
            scale_factor=scale_factor
        )

        draw = ImageDraw.Draw(img)

        # Try to load a font, fall back to default if not available
        # Frontend uses: Math.round(9 * scaleFactor)
        font_size = round(9 * scale_factor)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except Exception:
            # Fall back to default font
            font = ImageFont.load_default()
            logger.debug("Using default font for annotations")

        for detection, classification in detections:
            bbox = detection.bbox
            x = bbox['x'] * resize_ratio
            y = bbox['y'] * resize_ratio
            width = bbox['width'] * resize_ratio
            height = bbox['height'] * resize_ratio

            bbox_padding = round(8 * scale_factor)
            padded_x = x - bbox_padding
            padded_y = y - bbox_padding
            padded_width = width + (bbox_padding * 2)
            padded_height = height + (bbox_padding * 2)

            # Draw rounded rectangle bounding box
            box_color = '#ef4444'
            line_width = round(4 * scale_factor)
            corner_radius = round(4 * scale_factor)

            draw.rounded_rectangle(
                [padded_x, padded_y, padded_x + padded_width, padded_y + padded_height],
                radius=corner_radius,
                outline=box_color,
                width=line_width
            )

            # Prepare label text
            if detection.category in ('person', 'vehicle'):
                # Single-line label for person/vehicle (no separate classification)
                labels = [f"{detection.category.title()} {int(classification.confidence * 100)}%"]
            else:
                # Two-line label: detection category + species classification
                detection_label = f"{detection.category} {int(classification.confidence * 100)}%"
                species_display = classification.species.replace('_', ' ').title()
                classification_label = f"{species_display} {int(classification.confidence * 100)}%"
                labels = [detection_label, classification_label]

            # Calculate label dimensions (match frontend lines 342-348)
            # Frontend line 342: Math.round(12 * scaleFactor)
            line_height = round(12 * scale_factor)
            # Frontend line 343: Math.round(4 * scaleFactor)
            label_padding_x = round(4 * scale_factor)
            # Frontend line 344: Math.round(3 * scaleFactor)
            label_padding_y = round(3 * scale_factor)
            # Frontend line 348: Math.round(3 * scaleFactor)
            border_radius = round(3 * scale_factor)
            # Frontend line 347: Math.round(4 * scaleFactor)
            margin = round(4 * scale_factor)

            # Measure text widths
            label_widths = []
            for label in labels:
                try:
                    bbox_text = draw.textbbox((0, 0), label, font=font)
                    label_widths.append(bbox_text[2] - bbox_text[0])
                except AttributeError:
                    label_widths.append(draw.textsize(label, font=font)[0])

            max_label_width = max(label_widths)
            label_box_width = max_label_width + (label_padding_x * 2)
            label_box_height = (len(labels) * line_height) + (label_padding_y * 2)

            # Position label - try above bbox first (match frontend lines 351-355)
            # Frontend line 351: Math.max(margin, paddedY - labelBoxHeight - margin)
            label_y = max(margin, padded_y - label_box_height - margin)

            if label_y < margin:
                label_y = min(padded_y + padded_height + margin, img.height - label_box_height - margin)

            label_x = min(padded_x, img.width - label_box_width - margin)

            # Draw semi-transparent label background using a small overlay
            lx, ly = round(label_x), round(label_y)
            lw = round(label_box_width)
            lh = round(label_box_height)
            overlay = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            overlay_draw.rounded_rectangle(
                [0, 0, lw, lh],
                radius=border_radius,
                fill=(0, 0, 0, 128)
            )
            img.paste(
                Image.alpha_composite(
                    img.crop((lx, ly, lx + lw, ly + lh)).convert('RGBA'),
                    overlay
                ).convert('RGB'),
                (lx, ly)
            )
            draw = ImageDraw.Draw(img)

            # Draw label text (white, vertically centered in each line)
            text_color = 'white'
            for idx, label in enumerate(labels):
                # Calculate Y position: center text in each line
                text_y = label_y + label_padding_y + (idx * line_height) + (line_height // 2)

                # Get text height for vertical centering
                try:
                    text_bbox = draw.textbbox((0, 0), label, font=font)
                    text_height = text_bbox[3] - text_bbox[1]
                except AttributeError:
                    text_height = draw.textsize(label, font=font)[1]

                # Adjust Y to vertically center
                text_y = text_y - (text_height // 2)

                draw.text(
                    (label_x + label_padding_x, text_y),
                    label,
                    fill=text_color,
                    font=font
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

    Raises:
        Exception: If upload fails
    """
    try:
        # Use thumbnails bucket with special prefix for annotated images
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
