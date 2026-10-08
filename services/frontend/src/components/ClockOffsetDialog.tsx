/**
 * Correct a wrong camera clock before a bulk upload.
 *
 * Ported from the "Adjust dates" modal of the desktop AddaxAI, which is
 * field tested. A clock error moves every photo by the same amount, so the
 * user reads the true time from the date stamp printed on one photo (zoom
 * and pan make a small stamp readable), types it, and the offset follows.
 * Quick buttons cover the common cases: 12 hours for an AM/PM mix-up, one
 * hour for a timezone or summer time mistake. Browsing a few photos checks
 * the result. The dialog only returns the offset; the review step applies
 * it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import { Button } from './ui/Button';
import {
  MAX_TIME_OFFSET_SECONDS,
  formatNaive,
  formatOffset,
  naiveMs,
  shiftNaive,
} from '../utils/clock-offset';

export interface ClockOffsetSample {
  file: File;
  /** Naive camera time read from the photo, uncorrected. */
  captured_at: string;
}

const QUICK_FIXES = [
  { label: '-12 hours', seconds: -12 * 3600 },
  { label: '+12 hours', seconds: 12 * 3600 },
  { label: '-1 hour', seconds: -3600 },
  { label: '+1 hour', seconds: 3600 },
];

const MAX_ZOOM = 5;

interface ClockOffsetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Photos in time order. */
  samples: ClockOffsetSample[];
  currentOffsetSeconds: number;
  onApply: (offsetSeconds: number) => void;
}

export function ClockOffsetDialog({
  open,
  onClose,
  samples,
  currentOffsetSeconds,
  onApply,
}: ClockOffsetDialogProps) {
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(currentOffsetSeconds);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Start from the applied correction each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setOffset(currentOffsetSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Opening the dialog or moving to a new photo starts unzoomed.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [open, index]);

  const sample = samples[index];
  const imageUrl = useMemo(() => (sample ? URL.createObjectURL(sample.file) : null), [sample]);
  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  // The corrected time is derived, never stored: typing a date sets the
  // offset, and the field follows the offset on every other photo.
  const corrected = sample ? shiftNaive(sample.captured_at, offset) : '';
  const setCorrected = (value: string) => {
    const from = naiveMs(sample?.captured_at);
    const to = naiveMs(value);
    if (from === null || to === null) return;
    setOffset(Math.round((to - from) / 1000));
  };
  const tooFar = Math.abs(offset) > MAX_TIME_OFFSET_SECONDS;

  // Scroll zooms around the cursor. Attached by hand because React wheel
  // listeners are passive, so preventDefault would not stop the dialog
  // from scrolling. React 19 runs the returned cleanup on unmount.
  const zoomArea = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((old) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, old + (e.deltaY < 0 ? 0.5 : -0.5)));
        const ratio = next / old;
        setPan((p) =>
          next === 1
            ? { x: 0, y: 0 }
            : {
                x: clamp(mx - (mx - p.x) * ratio, el.clientWidth * (1 - next), 0),
                y: clamp(my - (my - p.y) * ratio, el.clientHeight * (1 - next), 0),
              },
        );
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct the camera clock</DialogTitle>
          <DialogDescription>
            A wrong camera clock is off by the same amount on every photo. Scroll
            on the photo to zoom in and read its printed date stamp. If it differs
            from the camera date, set the right date for one photo, browse a few
            more to check, then apply. Photos already in the project keep their
            old date, so delete those first if they need correcting too.
          </DialogDescription>
        </DialogHeader>

        {sample ? (
          <div className="grid gap-6 sm:grid-cols-[1fr_16rem]">
            <div className="space-y-2 min-w-0">
              <div
                ref={zoomArea}
                className="overflow-hidden rounded-md border bg-muted select-none"
                onMouseDown={(e) => {
                  if (zoom <= 1) return;
                  e.preventDefault();
                  setDrag({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
                }}
                onMouseMove={(e) => {
                  if (!drag) return;
                  const el = e.currentTarget;
                  setPan({
                    x: clamp(drag.panX + e.clientX - drag.x, el.clientWidth * (1 - zoom), 0),
                    y: clamp(drag.panY + e.clientY - drag.y, el.clientHeight * (1 - zoom), 0),
                  });
                }}
                onMouseUp={() => setDrag(null)}
                onMouseLeave={() => setDrag(null)}
                onDoubleClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt={sample.file.name}
                    draggable={false}
                    className="w-full"
                    style={{
                      transformOrigin: '0 0',
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transition: drag ? 'none' : 'transform 150ms',
                      cursor: zoom <= 1 ? 'zoom-in' : drag ? 'grabbing' : 'grab',
                    }}
                  />
                )}
              </div>
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIndex((i) => i - 1)}
                  disabled={index === 0}
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {(index + 1).toLocaleString()} of {samples.length.toLocaleString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIndex((i) => i + 1)}
                  disabled={index === samples.length - 1}
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="text-xs font-medium">Date from the camera</div>
                <div className="rounded-md border bg-muted px-3 py-2 text-sm">
                  {formatNaive(sample.captured_at)}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium">Common fixes</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_FIXES.map((q) => (
                    <Button
                      key={q.label}
                      variant="outline"
                      size="sm"
                      onClick={() => setOffset((o) => o + q.seconds)}
                    >
                      {q.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="clock-offset-true-date" className="text-xs font-medium block">
                  What the date really is
                </label>
                <input
                  id="clock-offset-true-date"
                  type="datetime-local"
                  step="1"
                  value={corrected}
                  onChange={(e) => setCorrected(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div
                className={`rounded-md border p-3 ${offset !== 0 ? 'border-primary bg-primary/5' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">All dates will be shifted by</div>
                    <div className="text-sm font-medium">{formatOffset(offset)}</div>
                  </div>
                  {offset !== 0 && (
                    <button
                      type="button"
                      onClick={() => setOffset(0)}
                      title="Clear the correction"
                      aria-label="Clear the correction"
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {tooFar && (
                  <p className="mt-2 text-xs text-destructive">
                    More than 30 years. Check the year you typed.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            None of these photos has a date to correct.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(offset);
              onClose();
            }}
            disabled={!sample || tooFar}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
