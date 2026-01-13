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
        max_width: Not used - we use full resolution like the frontend

    Returns:
        Image bytes (JPEG format)

    Raises:
        Exception: If image generation fails
    """
    try:
        # Load image at full resolution (match frontend: uses naturalWidth/naturalHeight)
        img = Image.open(image_path)

        # Convert to RGB if necessary
        if img.mode != 'RGB':
            img = img.convert('RGB')

        # Use full natural size (no resizing, match frontend behavior)
        natural_width, natural_height = img.size

        # Calculate scale factor based on a reference display size
        # Frontend calculates: downloadCanvas.width / canvasRef.current.width
        # Using a smaller reference size makes annotations larger
        # 300px reference gives much larger, more visible annotations
        display_width = 300
        scale_factor = natural_width / display_width

        logger.debug(
            "Using full resolution for annotation",
            natural_size=f"{natural_width}x{natural_height}",
            scale_factor=scale_factor
        )

        # Create drawing context
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

        # Draw each detection with label
        for detection, classification in detections:
            # Use bbox coordinates directly (they're already in natural image size)
            # Frontend: const x = bbox.x; (line 274)
            bbox = detection.bbox
            x = bbox['x']
            y = bbox['y']
            width = bbox['width']
            height = bbox['height']

            # Add padding around bbox (match frontend line 283: Math.round(8 * scaleFactor))
            bbox_padding = round(8 * scale_factor)
            padded_x = x - bbox_padding
            padded_y = y - bbox_padding
            padded_width = width + (bbox_padding * 2)
            padded_height = height + (bbox_padding * 2)

            # Draw corner brackets instead of full rectangle (match frontend style)
            box_color = '#ef4444'  # Red
            # Make corners wider and longer than frontend default
            line_width = round(6 * scale_factor)  # Increased from 4
            bracket_length = round(20 * scale_factor)  # Increased from 12
            corner_radius = round(6 * scale_factor)  # Increased from 4

            # Draw corner brackets exactly like Canvas API
            # Match the exact Canvas code from lines 297-323

            # Set up for drawing (PIL uses different line cap than Canvas)
            # Top-left corner: moveTo(paddedX, paddedY + bracketLength) -> arcTo -> lineTo(paddedX + bracketLength, paddedY)
            draw.line(
                [(padded_x, padded_y + bracket_length), (padded_x, padded_y + corner_radius)],
                fill=box_color, width=line_width
            )
            draw.arc(
                [padded_x, padded_y, padded_x + corner_radius*2, padded_y + corner_radius*2],
                180, 270, fill=box_color, width=line_width
            )
            draw.line(
                [(padded_x + corner_radius, padded_y), (padded_x + bracket_length, padded_y)],
                fill=box_color, width=line_width
            )

            # Top-right corner: moveTo(paddedX + paddedWidth - bracketLength, paddedY) -> arcTo -> lineTo(paddedX + paddedWidth, paddedY + bracketLength)
            draw.line(
                [(padded_x + padded_width - bracket_length, padded_y), (padded_x + padded_width - corner_radius, padded_y)],
                fill=box_color, width=line_width
            )
            draw.arc(
                [padded_x + padded_width - corner_radius*2, padded_y, padded_x + padded_width, padded_y + corner_radius*2],
                270, 360, fill=box_color, width=line_width
            )
            draw.line(
                [(padded_x + padded_width, padded_y + corner_radius), (padded_x + padded_width, padded_y + bracket_length)],
                fill=box_color, width=line_width
            )

            # Bottom-left corner: moveTo(paddedX + bracketLength, paddedY + paddedHeight) -> arcTo -> lineTo(paddedX, paddedY + paddedHeight - bracketLength)
            draw.line(
                [(padded_x + bracket_length, padded_y + padded_height), (padded_x + corner_radius, padded_y + padded_height)],
                fill=box_color, width=line_width
            )
            draw.arc(
                [padded_x, padded_y + padded_height - corner_radius*2, padded_x + corner_radius*2, padded_y + padded_height],
                90, 180, fill=box_color, width=line_width
            )
            draw.line(
                [(padded_x, padded_y + padded_height - corner_radius), (padded_x, padded_y + padded_height - bracket_length)],
                fill=box_color, width=line_width
            )

            # Bottom-right corner: moveTo(paddedX + paddedWidth, paddedY + paddedHeight - bracketLength) -> arcTo -> lineTo(paddedX + paddedWidth - bracketLength, paddedY + paddedHeight)
            draw.line(
                [(padded_x + padded_width, padded_y + padded_height - bracket_length), (padded_x + padded_width, padded_y + padded_height - corner_radius)],
                fill=box_color, width=line_width
            )
            draw.arc(
                [padded_x + padded_width - corner_radius*2, padded_y + padded_height - corner_radius*2, padded_x + padded_width, padded_y + padded_height],
                0, 90, fill=box_color, width=line_width
            )
            draw.line(
                [(padded_x + padded_width - corner_radius, padded_y + padded_height), (padded_x + padded_width - bracket_length, padded_y + padded_height)],
                fill=box_color, width=line_width
            )

            # Prepare two-line label text (match frontend format)
            # Line 1: detection category + confidence
            detection_label = f"{detection.category} {int(classification.confidence * 100)}%"
            # Line 2: species + confidence
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

            # If cut off at top, place below bbox
            # Frontend line 352-353
            if label_y < margin:
                label_y = min(padded_y + padded_height + margin, natural_height - label_box_height - margin)

            # Ensure doesn't go off right edge
            # Frontend line 355: Math.min(paddedX, downloadCanvas.width - labelBoxWidth - margin)
            label_x = min(padded_x, natural_width - label_box_width - margin)

            # Draw label background with semi-transparent black (match frontend: rgba(0, 0, 0, 0.5))
            # Create a semi-transparent overlay
            overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)

            # Draw rounded rectangle on overlay
            overlay_draw.rounded_rectangle(
                [label_x, label_y, label_x + label_box_width, label_y + label_box_height],
                radius=border_radius,
                fill=(0, 0, 0, 128)  # 128 = 50% opacity
            )

            # Composite the overlay onto the main image
            img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
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
