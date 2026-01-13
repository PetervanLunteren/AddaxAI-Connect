"""
Generate annotated images using Playwright headless browser.

Uses the exact same Canvas rendering code as the frontend ImageDetailModal
to ensure pixel-perfect matching between downloads and Telegram notifications.
"""
import asyncio
import base64
from typing import List, Dict, Any
from io import BytesIO

from playwright.async_api import async_playwright
from shared.logger import get_logger
from shared.storage import StorageClient

logger = get_logger("api.annotated_image_generator")


async def generate_annotated_image(
    image_bytes: bytes,
    detections: List[Dict[str, Any]],
    natural_width: int,
    natural_height: int
) -> bytes:
    """
    Generate annotated image with bounding boxes and labels using Playwright.

    Uses headless browser to render Canvas annotations exactly like the frontend.

    Args:
        image_bytes: Raw image data
        detections: List of detection objects with bbox, category, confidence, and classifications
        natural_width: Original image width
        natural_height: Original image height

    Returns:
        Annotated image bytes (JPEG format)
    """
    try:
        # Log detection data for debugging
        import json as json_module
        logger.info(
            "Generating annotated image with detection data",
            num_detections=len(detections),
            detections_json=json_module.dumps(detections),
            image_dimensions=f"{natural_width}x{natural_height}"
        )

        # Convert image to base64 data URL
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')
        image_data_url = f"data:image/jpeg;base64,{image_b64}"

        # Create HTML with Canvas rendering code (copied from ImageDetailModal download logic)
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
        </head>
        <body>
            <canvas id="canvas"></canvas>
            <script>
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();

                img.onload = function() {{
                    // Set canvas to natural image size
                    canvas.width = {natural_width};
                    canvas.height = {natural_height};

                    // Draw the image
                    ctx.drawImage(img, 0, 0);

                    // Draw bounding boxes
                    const detections = {detections};
                    document.title = `Detections: ${{detections.length}}, First bbox: ${{JSON.stringify(detections[0]?.bbox || 'none')}}`;
                    const scaleFactor = canvas.width / 1000;  // Reference display width

                    detections.forEach((detection, idx) => {{
                        console.log(`Drawing detection ${{idx}}:`, detection.bbox);
                        const bbox = detection.bbox;
                        const x = bbox.x;
                        const y = bbox.y;
                        const width = bbox.width;
                        const height = bbox.height;

                        const bboxPadding = Math.round(8 * scaleFactor);
                        const paddedX = x - bboxPadding;
                        const paddedY = y - bboxPadding;
                        const paddedWidth = width + (bboxPadding * 2);
                        const paddedHeight = height + (bboxPadding * 2);

                        // Draw corner brackets
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = Math.round(4 * scaleFactor);
                        ctx.lineCap = 'round';

                        const bracketLength = Math.round(12 * scaleFactor);
                        const cornerRadius = Math.round(4 * scaleFactor);

                        // Top-left
                        ctx.beginPath();
                        ctx.moveTo(paddedX, paddedY + bracketLength);
                        ctx.arcTo(paddedX, paddedY, paddedX + bracketLength, paddedY, cornerRadius);
                        ctx.lineTo(paddedX + bracketLength, paddedY);
                        ctx.stroke();

                        // Top-right
                        ctx.beginPath();
                        ctx.moveTo(paddedX + paddedWidth - bracketLength, paddedY);
                        ctx.arcTo(paddedX + paddedWidth, paddedY, paddedX + paddedWidth, paddedY + bracketLength, cornerRadius);
                        ctx.lineTo(paddedX + paddedWidth, paddedY + bracketLength);
                        ctx.stroke();

                        // Bottom-left
                        ctx.beginPath();
                        ctx.moveTo(paddedX + bracketLength, paddedY + paddedHeight);
                        ctx.arcTo(paddedX, paddedY + paddedHeight, paddedX, paddedY + paddedHeight - bracketLength, cornerRadius);
                        ctx.lineTo(paddedX, paddedY + paddedHeight - bracketLength);
                        ctx.stroke();

                        // Bottom-right
                        ctx.beginPath();
                        ctx.moveTo(paddedX + paddedWidth, paddedY + paddedHeight - bracketLength);
                        ctx.arcTo(paddedX + paddedWidth, paddedY + paddedHeight, paddedX + paddedWidth - bracketLength, paddedY + paddedHeight, cornerRadius);
                        ctx.lineTo(paddedX + paddedWidth - bracketLength, paddedY + paddedHeight);
                        ctx.stroke();

                        // Draw labels
                        // Capitalize first letter of category
                        const categoryName = detection.category.charAt(0).toUpperCase() + detection.category.slice(1);
                        const detectionLabel = `${{categoryName}} ${{Math.round(detection.confidence * 100)}}%`;
                        let labels = [detectionLabel];

                        if (detection.classifications.length > 0) {{
                            const topClassification = detection.classifications[0];
                            // Normalize species name: replace underscores with spaces and capitalize first letter
                            const speciesName = topClassification.species.replace(/_/g, ' ').charAt(0).toUpperCase() + topClassification.species.replace(/_/g, ' ').slice(1);
                            const classificationLabel = `${{speciesName}} ${{Math.round(topClassification.confidence * 100)}}%`;
                            labels.push(classificationLabel);
                        }}

                        const fontSize = Math.round(9 * scaleFactor);
                        ctx.font = `bold ${{fontSize}}px sans-serif`;

                        const labelWidths = labels.map(label => ctx.measureText(label).width);
                        const maxLabelWidth = Math.max(...labelWidths);
                        const lineHeight = Math.round(12 * scaleFactor);
                        const labelPaddingX = Math.round(4 * scaleFactor);
                        const labelPaddingY = Math.round(3 * scaleFactor);
                        const labelBoxWidth = maxLabelWidth + (labelPaddingX * 2);
                        const labelBoxHeight = (labels.length * lineHeight) + (labelPaddingY * 2);
                        const margin = Math.round(4 * scaleFactor);
                        const borderRadius = Math.round(3 * scaleFactor);

                        let labelY = Math.max(margin, paddedY - labelBoxHeight - margin);
                        if (labelY < margin) {{
                            labelY = Math.min(paddedY + paddedHeight + margin, canvas.height - labelBoxHeight - margin);
                        }}
                        const labelX = Math.min(paddedX, canvas.width - labelBoxWidth - margin);

                        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                        ctx.beginPath();
                        ctx.roundRect(labelX, labelY, labelBoxWidth, labelBoxHeight, borderRadius);
                        ctx.fill();

                        ctx.fillStyle = 'white';
                        ctx.textBaseline = 'middle';
                        labels.forEach((label, idx) => {{
                            const textY = labelY + labelPaddingY + (idx + 0.5) * lineHeight;
                            ctx.fillText(label, labelX + labelPaddingX, textY);
                        }});
                    }});

                    // Mark as complete
                    document.body.setAttribute('data-render-complete', 'true');
                }};

                img.src = '{image_data_url}';
            </script>
        </body>
        </html>
        """

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            # Set content and wait for rendering
            await page.set_content(html_content)
            await page.wait_for_selector('[data-render-complete="true"]', timeout=10000)

            # Get canvas as PNG
            canvas = await page.query_selector('#canvas')
            screenshot_bytes = await canvas.screenshot(type='jpeg', quality=95)

            await browser.close()

            logger.info(
                "Generated annotated image",
                num_detections=len(detections),
                output_size_kb=len(screenshot_bytes) // 1024
            )

            return screenshot_bytes

    except Exception as e:
        logger.error(
            "Failed to generate annotated image",
            error=str(e),
            exc_info=True
        )
        raise
