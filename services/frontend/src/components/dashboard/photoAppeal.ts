/**
 * Ranking photographs for the dashboard wall, on how good they look.
 *
 * Confidence answers "is the model sure", not "is this worth looking at". A
 * blurred nose against the lens can score 99%. So confidence is used as a
 * gate, the endpoint returns the most confident candidates, and these rules
 * choose between them.
 *
 * Two signals, both free. Everything here comes out of the image list response
 * that is already being fetched, so nothing extra is downloaded and no image
 * is decoded.
 */
import type { ImageListItem } from '../../api/types';
import { pickDetection } from './DetectionCrop';

/**
 * Camera-clock hours treated as daylight. Deliberately narrow: this window is
 * daylight all year at Belgian latitudes, so a photo inside it is in colour.
 *
 * The error runs one way on purpose. A bright June evening at 19:00 counts as
 * night here and needs a larger animal to win, which costs us a good photo now
 * and then. The opposite mistake would promote an infrared frame to the top of
 * the wall, which is the thing this ranking exists to prevent.
 *
 * Knowing for certain would mean decoding pixels to measure saturation, and
 * decoding two dozen thumbnails to choose four is slower than the feature is
 * worth.
 */
const DAYLIGHT_FROM_HOUR = 9;
const DAYLIGHT_TO_HOUR = 16;

/** What a night photo's area is worth against a daylight one. */
const NIGHT_FACTOR = 0.6;

/**
 * Hour on the camera clock, read from the string rather than through Date.
 *
 * captured_at is a naive camera-clock timestamp. Parsing it into a Date makes
 * the browser apply its own timezone, so the same photo would score
 * differently in Brussels and in Sydney. The characters are the camera's own
 * reading and need no interpretation.
 */
function cameraHour(capturedAt: string): number | null {
  const hour = Number(capturedAt.slice(11, 13));
  return Number.isFinite(hour) ? hour : null;
}

function isDaylight(capturedAt: string): boolean {
  const hour = cameraHour(capturedAt);
  if (hour === null) return false;
  return hour >= DAYLIGHT_FROM_HOUR && hour < DAYLIGHT_TO_HOUR;
}

/**
 * How much of the frame the animal fills, 0 to 1, on the box that will
 * actually be shown. Zero when the image has no usable box or no dimensions,
 * which drops it below every scorable photo rather than crashing.
 */
export function subjectShare(image: ImageListItem): number {
  const detection = pickDetection(image.detections);
  if (!detection || !image.image_width || !image.image_height) return 0;
  return (
    (detection.bbox.width * detection.bbox.height) /
    (image.image_width * image.image_height)
  );
}

/** Bigger is better looking, and colour beats infrared. That is the whole rule. */
export function photoAppeal(image: ImageListItem): number {
  return subjectShare(image) * (isDaylight(image.captured_at) ? 1 : NIGHT_FACTOR);
}

/**
 * Photos from one camera closer together than this count as the same visit.
 *
 * A camera trap fires a burst, so the frames either side of the best one look
 * almost as good and show the same animal in the same pose. Roughly the length
 * of one visit, and in the same range as a typical independence interval,
 * which is the project's own definition of when a sighting becomes a new one.
 */
const SAME_VISIT_MINUTES = 30;

/** Absolute gap in minutes. Both strings are parsed alike, so the difference
 *  is right whatever the browser's timezone does to the absolute values. */
function minutesApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 60000;
}

/**
 * The best-looking `count` images, most appealing first, at most one per visit.
 *
 * Without the spacing rule a burst sweeps the board: for wolf, three of the
 * four came from 23:55, 23:56 and 23:57 on one night. Four photographs of one
 * animal in one pose is a worse wall than four decent ones from four nights,
 * even when the burst frames score higher.
 *
 * Same camera only. Two sites photographing the same species at the same
 * moment are genuinely different sightings and both deserve a place.
 *
 * Anything skipped comes back at the end, so a species with only one visit on
 * record still fills the wall rather than showing a gap.
 */
export function rankByAppeal(images: ImageListItem[], count: number): ImageListItem[] {
  const sorted = [...images].sort((a, b) => photoAppeal(b) - photoAppeal(a));
  const chosen: ImageListItem[] = [];
  const sameVisit: ImageListItem[] = [];

  for (const image of sorted) {
    if (chosen.length === count) break;
    const alreadyHaveThisVisit = chosen.some(
      (picked) =>
        picked.camera_id === image.camera_id &&
        minutesApart(picked.captured_at, image.captured_at) < SAME_VISIT_MINUTES,
    );
    if (alreadyHaveThisVisit) sameVisit.push(image);
    else chosen.push(image);
  }

  for (const image of sameVisit) {
    if (chosen.length === count) break;
    chosen.push(image);
  }
  return chosen;
}
