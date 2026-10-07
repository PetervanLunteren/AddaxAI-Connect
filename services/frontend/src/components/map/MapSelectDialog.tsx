/**
 * Select rows on a map, for any table whose rows have coordinates (sites,
 * cameras). Opens from the table's toolbar, starts with the table's current
 * selection, and hands the result back when the user confirms.
 *
 * Two modes, switched by a segmented control. "Draw box" (the default)
 * disables panning, and a plain drag with mouse or finger draws a box that
 * adds every dot inside it. "Move map" pans and zooms as usual. Clicking a
 * dot adds or removes it in both modes. Leaflet's own box selection needs
 * the Shift key and a mouse, which nobody finds and no phone has.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from './BaseLayersControl';
import { FitBounds } from './FitBounds';
import { cn } from '../../lib/utils';
import 'leaflet/dist/leaflet.css';

const PRIMARY = '#0f6064';
// A drag shorter than this many pixels is a click, not a box.
const MIN_BOX_PX = 5;

export interface MapSelectItem {
  id: number;
  label: string;
  latitude: number | null;
  longitude: number | null;
}

interface MapSelectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Singular noun for the rows, e.g. "site" or "camera". */
  noun: string;
  items: MapSelectItem[];
  initialSelected: Set<number>;
  /** selected: ids to turn on. unselected: shown ids to turn off. Rows that
   * are not on the map (no location) are in neither list, so the table
   * keeps their selection as it was. */
  onConfirm: (selected: number[], unselected: number[]) => void;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Draw-a-box gesture. Active only in box mode; panning is off meanwhile. */
function DragSelect({
  active,
  onBox,
}: {
  active: boolean;
  onBox: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMap();
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;

  useEffect(() => {
    if (!active) return;
    const container = map.getContainer();
    map.dragging.disable();
    container.style.cursor = 'crosshair';
    // Leaflet drops its touch-action rule along with dragging; without this
    // a finger drag would scroll the page instead of drawing the box.
    container.style.touchAction = 'none';

    let start: L.Point | null = null;
    let rect: L.Rectangle | null = null;

    const reset = () => {
      rect?.remove();
      rect = null;
      start = null;
    };
    const onDown = (e: PointerEvent) => {
      // One finger or the left mouse button, and never on a map control.
      if (!e.isPrimary || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.leaflet-control')) return;
      start = map.mouseEventToContainerPoint(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || !e.isPrimary) return;
      const here = map.mouseEventToContainerPoint(e);
      if (!rect && start.distanceTo(here) < MIN_BOX_PX) return;
      const bounds = L.latLngBounds(
        map.containerPointToLatLng(start),
        map.containerPointToLatLng(here),
      );
      if (rect) {
        rect.setBounds(bounds);
      } else {
        rect = L.rectangle(bounds, {
          color: PRIMARY,
          weight: 1,
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(map);
      }
    };
    const onUp = () => {
      // No rectangle means it was a click; the dot's own click handles it.
      if (rect) onBoxRef.current(rect.getBounds());
      reset();
    };
    // A second finger means a pinch, not a box.
    const onSecondPointer = (e: PointerEvent) => {
      if (!e.isPrimary) reset();
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointerdown', onSecondPointer);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', reset);
    return () => {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerdown', onSecondPointer);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', reset);
      reset();
      map.dragging.enable();
      container.style.cursor = '';
      container.style.touchAction = '';
    };
  }, [active, map]);

  return null;
}

export function MapSelectDialog({
  open,
  onClose,
  noun,
  items,
  initialSelected,
  onConfirm,
}: MapSelectDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [boxMode, setBoxMode] = useState(true);

  const located = useMemo(
    () =>
      items.filter(
        (i): i is MapSelectItem & { latitude: number; longitude: number } =>
          i.latitude != null && i.longitude != null,
      ),
    [items],
  );
  const missing = items.length - located.length;
  const points = useMemo<[number, number][]>(
    () => located.map((i) => [i.latitude, i.longitude]),
    [located],
  );

  // Start from the table's selection, limited to what the map can show.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(located.filter((i) => initialSelected.has(i.id)).map((i) => i.id)));
    setBoxMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addBox = (bounds: L.LatLngBounds) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of located) {
        if (bounds.contains([i.latitude, i.longitude])) next.add(i.id);
      }
      return next;
    });

  const confirm = () => {
    onConfirm(
      Array.from(selected),
      located.filter((i) => !selected.has(i.id)).map((i) => i.id),
    );
    onClose();
  };

  const modeButton = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-sm transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
      )}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select {noun}s on the map</DialogTitle>
          <DialogDescription>
            {boxMode
              ? `Drag to draw a box around the ${noun}s you want. Click a dot to add or remove it.`
              : `Move and zoom the map. Click a dot to add or remove it.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-md border divide-x overflow-hidden">
            {modeButton(boxMode, 'Draw box', () => setBoxMode(true))}
            {modeButton(!boxMode, 'Move map', () => setBoxMode(false))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
          >
            Clear
          </Button>
        </div>

        {located.length === 0 ? (
          <div className="flex items-center justify-center h-[50vh] rounded-lg border bg-muted/30">
            <p className="text-sm text-muted-foreground">
              None of these {noun}s has a location yet.
            </p>
          </div>
        ) : (
          <MapContainer
            center={points[0]}
            zoom={12}
            maxZoom={MAP_MAX_ZOOM}
            style={{ height: '55vh', width: '100%', zIndex: 0 }}
            attributionControl={false}
            className="rounded-lg border"
          >
            <MapAttribution />
            <BaseLayersControl />
            <FitBounds points={points} />
            <DragSelect active={boxMode} onBox={addBox} />
            {located.map((i) => {
              const on = selected.has(i.id);
              return (
                <CircleMarker
                  key={i.id}
                  center={[i.latitude, i.longitude]}
                  radius={8}
                  pathOptions={{
                    color: PRIMARY,
                    weight: 2,
                    fillColor: on ? PRIMARY : '#ffffff',
                    fillOpacity: 1,
                  }}
                  eventHandlers={{ click: () => toggle(i.id) }}
                >
                  <Tooltip direction="top" offset={[0, -8]}>
                    {i.label}
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        )}

        {missing > 0 && (
          <p className="text-xs text-muted-foreground">
            {plural(missing, noun)} without a location {missing === 1 ? 'is' : 'are'} not
            on the map. Their selection in the table stays as it was.
          </p>
        )}

        <DialogFooter className="items-center gap-2">
          <span className="text-sm text-muted-foreground sm:mr-auto">
            {plural(selected.size, noun)} selected
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm}>Use selection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
