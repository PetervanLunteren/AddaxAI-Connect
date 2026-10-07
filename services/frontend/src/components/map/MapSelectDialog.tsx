/**
 * Select rows on a map, for any table whose rows have coordinates (sites,
 * cameras). Opens from an icon in the table's header, starts with the
 * table's current selection, and hands the result back when the user
 * confirms.
 *
 * Gestures follow desktop map tools like QGIS: a plain drag pans, Shift plus
 * drag draws a box that adds every dot inside it, and a click on a dot adds
 * or removes it. Touch screens have no Shift key, so there they can only
 * click dots; box selection on touch was dropped on purpose to keep one
 * mode and no toggle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { SquareDashedMousePointer } from 'lucide-react';

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

/** Icon button that opens the dialog, placed in the top right header cell
 * of a table so it reads as part of the table it selects in. One component
 * so the sites and cameras tables cannot drift apart. */
export function MapSelectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Select on map"
      aria-label="Select on map"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <SquareDashedMousePointer className="h-4 w-4" />
    </button>
  );
}

/** Shift plus drag draws a box. Panning stops for that one drag only. */
function ShiftBoxSelect({ onBox }: { onBox: (bounds: L.LatLngBounds) => void }) {
  const map = useMap();
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;

  useEffect(() => {
    const container = map.getContainer();
    let start: L.Point | null = null;
    let rect: L.Rectangle | null = null;

    const finish = () => {
      rect?.remove();
      rect = null;
      start = null;
      map.dragging.enable();
    };
    const onDown = (e: PointerEvent) => {
      if (!e.shiftKey || !e.isPrimary || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.leaflet-control')) return;
      // pointerdown comes before the mousedown Leaflet pans on, so turning
      // dragging off here keeps this one drag from moving the map.
      // preventDefault stops the drag from selecting page text.
      e.preventDefault();
      map.dragging.disable();
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
      if (!start) return;
      // No rectangle means it was a Shift-click; the dot's click handles it.
      if (rect) onBoxRef.current(rect.getBounds());
      finish();
    };

    container.addEventListener('pointerdown', onDown, { capture: true });
    // Window, not the container: the mouse may be released outside the map.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', finish);
    return () => {
      container.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', finish);
      finish();
    };
  }, [map]);

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select {noun}s on the map</DialogTitle>
          <DialogDescription>
            Hold Shift and drag to draw a box around the {noun}s you want. Click a
            dot to add or remove it. A normal drag moves the map.
          </DialogDescription>
        </DialogHeader>

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
            // Shift-drag is ours. Leaflet's box zoom would zoom into the box too.
            boxZoom={false}
            className="rounded-lg border"
          >
            <MapAttribution />
            <BaseLayersControl />
            <FitBounds points={points} />
            <ShiftBoxSelect onBox={addBox} />
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
          <Button
            variant="ghost"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
          >
            Clear selection
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm}>Use selection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
