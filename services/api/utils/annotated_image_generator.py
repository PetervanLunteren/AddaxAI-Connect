"""
Generate annotated images using Playwright headless browser.

Uses the exact same Canvas rendering code as the frontend detection-overlay.ts
to ensure pixel-perfect matching between downloads and API-generated images.
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

        # Create HTML with Canvas rendering code matching detection-overlay.ts
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
        </head>
        <body>
            <canvas id="canvas"></canvas>
            <script>
                // --- Constants (matching detection-overlay.ts) ---
                const BBOX_STROKE_WIDTH = 2;
                const BBOX_OPACITY = 0.5;
                const BBOX_CORNER_RADIUS = 4;
                const DIM_FILL = 'rgba(0, 0, 0, 0.35)';
                const PILL_BG = 'rgba(0, 0, 0, 0.5)';
                const PILL_PAD_X = 6;
                const PILL_PAD_Y = 4;
                const DOT_R = 4;
                const DOT_GAP = 5;
                const LINE_GAP = 2;
                const FONT_SM = 10;
                const FONT_LG = 12;
                const TEXT_START_X = PILL_PAD_X + DOT_R * 2 + DOT_GAP;
                const PILL_CORNER_R_EXTRA = 1;

                const CATEGORY_COLORS = {{
                    animal: '#0f6064',
                    person: '#ff8945',
                    vehicle: '#71b7ba',
                }};
                const DEFAULT_COLOR = '#882000';

                function getCategoryColor(category) {{
                    return CATEGORY_COLORS[category] || DEFAULT_COLOR;
                }}

                function normalizeLabel(label) {{
                    const s = label.replace(/_/g, ' ');
                    return s.charAt(0).toUpperCase() + s.slice(1);
                }}

                function roundedRectPath(ctx, x, y, w, h, r) {{
                    const cr = Math.min(r, w / 2, h / 2);
                    ctx.moveTo(x + cr, y);
                    ctx.lineTo(x + w - cr, y);
                    ctx.arcTo(x + w, y, x + w, y + cr, cr);
                    ctx.lineTo(x + w, y + h - cr);
                    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr);
                    ctx.lineTo(x + cr, y + h);
                    ctx.arcTo(x, y + h, x, y + h - cr, cr);
                    ctx.lineTo(x, y + cr);
                    ctx.arcTo(x, y, x + cr, y, cr);
                    ctx.closePath();
                }}

                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();

                img.onload = function() {{
                    canvas.width = {natural_width};
                    canvas.height = {natural_height};
                    ctx.drawImage(img, 0, 0);

                    const detections = {detections};
                    const scale = canvas.width / 1000;
                    const cornerR = BBOX_CORNER_RADIUS * scale;

                    // Pre-compute rects
                    const rects = detections.map(d => ({{
                        x: d.bbox.x,
                        y: d.bbox.y,
                        w: d.bbox.width,
                        h: d.bbox.height,
                    }}));

                    // 1. Spotlight dim overlay
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(0, 0, canvas.width, canvas.height);
                    for (const r of rects) {{
                        roundedRectPath(ctx, r.x, r.y, r.w, r.h, cornerR);
                    }}
                    ctx.fillStyle = DIM_FILL;
                    ctx.fill('evenodd');
                    ctx.restore();

                    // 2. Bounding box outlines
                    const strokeW = BBOX_STROKE_WIDTH * scale;
                    detections.forEach((detection, i) => {{
                        const r = rects[i];
                        const color = getCategoryColor(detection.category);
                        ctx.save();
                        ctx.globalAlpha = BBOX_OPACITY;
                        ctx.strokeStyle = color;
                        ctx.lineWidth = strokeW;
                        ctx.beginPath();
                        roundedRectPath(ctx, r.x, r.y, r.w, r.h, cornerR);
                        ctx.stroke();
                        ctx.restore();
                    }});

                    // 3. Label pills
                    const fontSm = FONT_SM * scale;
                    const fontLg = FONT_LG * scale;
                    const padX = PILL_PAD_X * scale;
                    const padY = PILL_PAD_Y * scale;
                    const dotR = DOT_R * scale;
                    const dotGap = DOT_GAP * scale;
                    const lineGap = LINE_GAP * scale;
                    const textStartX = TEXT_START_X * scale;
                    const pillCornerR = (BBOX_CORNER_RADIUS + PILL_CORNER_R_EXTRA) * scale;
                    const margin = 4 * scale;

                    detections.forEach((detection, i) => {{
                        const r = rects[i];
                        const color = getCategoryColor(detection.category);

                        const categoryText = normalizeLabel(detection.category) + ' ' + Math.round(detection.confidence * 100) + '%';
                        let speciesText = null;
                        if (detection.classifications && detection.classifications.length > 0) {{
                            const top = detection.classifications[0];
                            speciesText = normalizeLabel(top.species) + ' ' + Math.round(top.confidence * 100) + '%';
                        }}

                        // Measure text
                        ctx.font = fontSm + 'px sans-serif';
                        const catW = ctx.measureText(categoryText).width;
                        ctx.font = 'bold ' + fontLg + 'px sans-serif';
                        const specW = speciesText ? ctx.measureText(speciesText).width : 0;

                        const contentW = Math.max(catW, specW);
                        const pillW = textStartX + contentW + padX;
                        let pillH;
                        if (speciesText) {{
                            pillH = padY + fontSm + lineGap + fontLg + padY;
                        }} else {{
                            pillH = padY + fontLg + padY;
                        }}

                        // Position pill
                        let pillY = r.y - pillH - margin;
                        if (pillY < margin) {{
                            pillY = r.y + r.h + margin;
                            if (pillY + pillH > canvas.height - margin) {{
                                pillY = Math.max(margin, r.y);
                            }}
                        }}
                        let pillX = Math.max(margin, Math.min(r.x, canvas.width - pillW - margin));

                        // Pill background
                        ctx.save();
                        ctx.beginPath();
                        roundedRectPath(ctx, pillX, pillY, pillW, pillH, pillCornerR);
                        ctx.fillStyle = PILL_BG;
                        ctx.fill();
                        ctx.restore();

                        // Color dot
                        const dotCx = pillX + padX + dotR;
                        const dotCy = pillY + pillH / 2;
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
                        ctx.fillStyle = color;
                        ctx.fill();
                        ctx.restore();

                        const textX = pillX + textStartX;

                        if (speciesText) {{
                            // Category (small, dimmed)
                            ctx.save();
                            ctx.font = fontSm + 'px sans-serif';
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                            ctx.textBaseline = 'top';
                            ctx.fillText(categoryText, textX, pillY + padY);
                            ctx.restore();

                            // Species (large, bold, white)
                            ctx.save();
                            ctx.font = 'bold ' + fontLg + 'px sans-serif';
                            ctx.fillStyle = 'white';
                            ctx.textBaseline = 'top';
                            ctx.fillText(speciesText, textX, pillY + padY + fontSm + lineGap);
                            ctx.restore();
                        }} else {{
                            // Single line (large, bold, centered)
                            ctx.save();
                            ctx.font = 'bold ' + fontLg + 'px sans-serif';
                            ctx.fillStyle = 'white';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(categoryText, textX, pillY + pillH / 2);
                            ctx.restore();
                        }}
                    }});

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

            await page.set_content(html_content)
            await page.wait_for_selector('[data-render-complete="true"]', timeout=10000)

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
