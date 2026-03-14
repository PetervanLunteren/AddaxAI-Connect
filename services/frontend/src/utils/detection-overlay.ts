/**
 * Shared detection overlay drawing for Canvas contexts.
 *
 * Renders spotlight dim overlay, rounded-rect bboxes with category colors,
 * and label pills with a color dot + two-line text layout.
 */
import type { Detection } from '../api/types';
import { normalizeLabel } from './labels';

// --- Constants (matching WebUI detection-overlay.ts) ---

const BBOX_STROKE_WIDTH = 3;
const BBOX_OPACITY = 0.8;
const BBOX_CORNER_RADIUS = 4;
const DIM_FILL = 'rgba(0, 0, 0, 0.55)';
const PILL_BG = 'rgba(0, 0, 0, 0.5)';
const PILL_PAD_X = 6;
const PILL_PAD_Y = 4;
const DOT_R = 4;
const DOT_GAP = 5;
const LINE_GAP = 2;
const FONT_SM = 10;
const FONT_LG = 12;
const TEXT_START_X = PILL_PAD_X + DOT_R * 2 + DOT_GAP; // 19

// --- Category colors ---

const CATEGORY_COLORS: Record<string, string> = {
  animal: '#0f6064',
  person: '#ff8945',
  vehicle: '#71b7ba',
};
const DEFAULT_COLOR = '#882000';

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? DEFAULT_COLOR;
}

// --- Canvas helpers ---

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
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
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  bold: boolean,
): number {
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
  return ctx.measureText(text).width;
}

// --- Pill layout ---

interface PillLayout {
  categoryText: string;
  speciesText: string | null;
  hasSpecies: boolean;
  width: number;
  height: number;
  color: string;
  x: number;
  y: number;
}

function computePillLayout(
  ctx: CanvasRenderingContext2D,
  detection: Detection,
  bboxX: number,
  bboxY: number,
  bboxH: number,
  scale: number,
  canvasW: number,
  canvasH: number,
): PillLayout {
  const color = getCategoryColor(detection.category);
  const categoryText = `${normalizeLabel(detection.category)} ${Math.round(detection.confidence * 100)}%`;

  let speciesText: string | null = null;
  if (detection.classifications.length > 0) {
    const top = detection.classifications[0];
    speciesText = `${normalizeLabel(top.species)} ${Math.round(top.confidence * 100)}%`;
  }

  const fontSm = FONT_SM * scale;
  const fontLg = FONT_LG * scale;
  const padX = PILL_PAD_X * scale;
  const padY = PILL_PAD_Y * scale;
  const textStartX = TEXT_START_X * scale;
  const lineGap = LINE_GAP * scale;

  // Measure text widths
  const catW = measureTextWidth(ctx, categoryText, fontSm, false);
  const specW = speciesText ? measureTextWidth(ctx, speciesText, fontLg, true) : 0;

  const contentWidth = Math.max(catW, specW);
  const pillWidth = textStartX + contentWidth + padX;

  let pillHeight: number;
  if (speciesText) {
    pillHeight = padY + fontSm + lineGap + fontLg + padY;
  } else {
    pillHeight = padY + fontLg + padY;
  }

  // Position pill above bbox, fall back below if clipped
  const margin = 4 * scale;
  let pillY = bboxY - pillHeight - margin;
  if (pillY < margin) {
    pillY = bboxY + bboxH + margin;
    if (pillY + pillHeight > canvasH - margin) {
      pillY = Math.max(margin, bboxY);
    }
  }
  let pillX = Math.max(margin, Math.min(bboxX, canvasW - pillWidth - margin));

  return {
    categoryText,
    speciesText,
    hasSpecies: !!speciesText,
    width: pillWidth,
    height: pillHeight,
    color,
    x: pillX,
    y: pillY,
  };
}

// --- Main draw function ---

export interface DrawOverlayOptions {
  showLabels?: boolean;
  /** Original image width (natural or database-stored). Used to map bbox coords. */
  imageWidth: number;
  /** Original image height (natural or database-stored). Used to map bbox coords. */
  imageHeight: number;
}

export function drawDetectionOverlay(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  canvasW: number,
  canvasH: number,
  options: DrawOverlayOptions,
) {
  const { showLabels = true, imageWidth, imageHeight } = options;

  // Scale from original image coords to canvas coords
  const scaleX = canvasW / imageWidth;
  const scaleY = canvasH / imageHeight;

  // UI scale factor (for stroke widths, fonts, paddings)
  // Reference display width = 1000
  const scale = canvasW / 1000;

  // Pre-compute all bbox rects in canvas coords
  const rects = detections.map((d) => {
    const x = d.bbox.x * scaleX;
    const y = d.bbox.y * scaleY;
    const w = d.bbox.width * scaleX;
    const h = d.bbox.height * scaleY;
    return { x, y, w, h };
  });

  // 1. Spotlight dim overlay with cutouts
  ctx.save();
  ctx.beginPath();
  // Outer rect (full canvas)
  ctx.rect(0, 0, canvasW, canvasH);
  // Cutout each detection area
  const cornerR = BBOX_CORNER_RADIUS * scale;
  for (const r of rects) {
    roundedRectPath(ctx, r.x, r.y, r.w, r.h, cornerR);
  }
  ctx.fillStyle = DIM_FILL;
  ctx.fill('evenodd');
  ctx.restore();

  // 2. Bounding box outlines
  const strokeW = BBOX_STROKE_WIDTH * scale;
  detections.forEach((detection, i) => {
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
  });

  // 3. Label pills
  if (!showLabels) return;

  const fontSm = FONT_SM * scale;
  const fontLg = FONT_LG * scale;
  const padX = PILL_PAD_X * scale;
  const padY = PILL_PAD_Y * scale;
  const dotR = DOT_R * scale;
  const dotGap = DOT_GAP * scale;
  const lineGap = LINE_GAP * scale;
  const textStartX = TEXT_START_X * scale;
  const pillCornerR = (BBOX_CORNER_RADIUS + 1) * scale;

  detections.forEach((detection, i) => {
    const r = rects[i];
    const pill = computePillLayout(ctx, detection, r.x, r.y, r.h, scale, canvasW, canvasH);

    // Pill background
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, pill.x, pill.y, pill.width, pill.height, pillCornerR);
    ctx.fillStyle = PILL_BG;
    ctx.fill();
    ctx.restore();

    // Color dot (centered vertically)
    const dotCx = pill.x + padX + dotR;
    const dotCy = pill.y + pill.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = pill.color;
    ctx.fill();
    ctx.restore();

    const textX = pill.x + textStartX;

    if (pill.hasSpecies && pill.speciesText) {
      // Two-line layout: category (small, dimmed) + species (large, bold)
      // Category line
      ctx.save();
      ctx.font = `${fontSm}px sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.textBaseline = 'top';
      ctx.fillText(pill.categoryText, textX, pill.y + padY);
      ctx.restore();

      // Species line
      ctx.save();
      ctx.font = `bold ${fontLg}px sans-serif`;
      ctx.fillStyle = 'white';
      ctx.textBaseline = 'top';
      ctx.fillText(pill.speciesText, textX, pill.y + padY + fontSm + lineGap);
      ctx.restore();
    } else {
      // Single-line (person/vehicle): large bold white
      ctx.save();
      ctx.font = `bold ${fontLg}px sans-serif`;
      ctx.fillStyle = 'white';
      ctx.textBaseline = 'middle';
      ctx.fillText(pill.categoryText, textX, pill.y + pill.height / 2);
      ctx.restore();
    }
  });
}
