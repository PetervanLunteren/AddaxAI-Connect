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
 * Camera-clock hours treated as daylight, so probably in colour rather than
 * infrared.
 *
 * 07:00 to 19:00 covers most of the year. It was 09:00 to 16:00, which is
 * daylight even in midwinter but threw away most of the colour photographs a
 * project has: on this data it called only 14% of red deer daylight against
 * 33% for this window, and 23% of roe deer against 41%.
 *
 * The cost is winter. In December the sun here rises around 08:45 and sets
 * around 16:40, so an early or late frame in those months is infrared and gets
 * treated as colour. That is bounded rather than fatal, because losing the
 * penalty only lets a photo compete on how much of the frame the animal fills,
 * it does not put it in front.
 *
 * Knowing for certain would mean decoding pixels to measure saturation, which
 * is far slower than the feature is worth. Doing it properly means real
 * sunrise and sunset per date, which sun_time.py already computes, and moving
 * this ranking to the backend where the coordinates are.
 */
const DAYLIGHT_FROM_HOUR = 7;
const DAYLIGHT_TO_HOUR = 19;

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
 * True when the frame holds several recorded species and no box is labelled
 * with the one being asked for, so there is no way to tell which animal is
 * which.
 *
 * A verification records species, counts and sex, but no coordinates. The
 * boxes come from the detector and carry its own labels. Usually that is
 * enough: with a single species recorded, every animal box is that species by
 * elimination, whatever the model called it. It breaks when a person records
 * two species on one frame, or adds one the detector never boxed. Bats and
 * micromammals are the usual causes, small and fast enough that the detector
 * either misses them or boxes something else.
 *
 * Cropping then shows a confident close-up of the wrong animal, which is worse
 * than showing nothing in particular.
 */
export function cannotTellWhichAnimal(image: ImageListItem, species?: string): boolean {
  if (!species) return false;
  if (image.observed_species.length <= 1) return false;
  return !image.detections.some((d) => d.classifications.some((c) => c.species === species));
}

/**
 * How much of the frame the animal fills, 0 to 1, on the box that will
 * actually be shown. Zero when the image has no usable box or no dimensions,
 * which drops it below every scorable photo rather than crashing.
 */
export function subjectShare(image: ImageListItem, species?: string): number {
  const detection = pickDetection(image.detections, species);
  if (!detection || !image.image_width || !image.image_height) return 0;
  return (
    (detection.bbox.width * detection.bbox.height) /
    (image.image_width * image.image_height)
  );
}

/**
 * What an unframeable photo is worth against one we can crop.
 *
 * Not zero. These are real sightings and sometimes the only photo a species
 * has, so they stay eligible and simply lose to anything we can frame.
 */
const AMBIGUOUS_FACTOR = 0.4;

/** Bigger is better looking, colour beats infrared, and a frame we can read
 *  beats one where the animal cannot be located. */
export function photoAppeal(image: ImageListItem, species?: string): number {
  const light = isDaylight(image.captured_at) ? 1 : NIGHT_FACTOR;
  const certain = cannotTellWhichAnimal(image, species) ? AMBIGUOUS_FACTOR : 1;
  return subjectShare(image, species) * light * certain;
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
export function rankByAppeal(
  images: ImageListItem[],
  count: number,
  species?: string,
): ImageListItem[] {
  const sorted = [...images].sort((a, b) => photoAppeal(b, species) - photoAppeal(a, species));
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
