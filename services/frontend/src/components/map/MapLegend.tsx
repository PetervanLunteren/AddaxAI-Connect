/**
 * Map legend component
 * Shows the colour ramp of the map as a continuous gradient, from zero at
 * the bottom to the cap at the top (calculateRateDomain), with a "+" when
 * some sites lie above the cap.
 */
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { rampGradient, type RateRamp, type RateScaleDomain } from '../../lib/heat-color-scale';
import { MARKER_RING_WIDTH } from './marker-style';

interface MapLegendProps {
  domain: RateScaleDomain;
  ramp: RateRamp;
  /** Two-line title, static registry strings (safe for innerHTML). */
  title: [string, string];
  /** Footer label for the hollow marker, null hides the footer. */
  emptyLabel: string | null;
  /** Tick formatter, per metric (Math.round is useless for Shannon's 0-3 range). */
  formatShort: (v: number) => string;
}

export function MapLegend({ domain, ramp, title, emptyLabel, formatShort }: MapLegendProps) {
  const map = useMap();

  useEffect(() => {
    // Create Leaflet control for legend
    const legend = new L.Control({ position: 'bottomright' });

    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      div.style.backgroundColor = 'white';
      div.style.padding = '10px';
      div.style.borderRadius = '4px';
      div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

      // The ramp ends at the cap; a "+" says some sites lie above it.
      const top = `${formatShort(domain.cap)}${domain.max > domain.cap ? '+' : ''}`;
      const middleValue = domain.cap / 2;

      div.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; line-height: 1.3;">
          ${title[0]}<br>${title[1]}
        </div>
        <div style="display: flex; align-items: center;">
          <div style="
            width: 20px;
            height: 150px;
            background: ${rampGradient(ramp, 'to top')};
            border: 1px solid rgba(0,0,0,0.2);
            border-radius: 2px;
            margin-right: 8px;
          "></div>
          <div style="
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: 150px;
            font-size: 11px;
          ">
            <div>${top}</div>
            <div>${formatShort(middleValue)}</div>
            <div>0</div>
          </div>
        </div>
        ${emptyLabel === null ? '' : `
        <div style="
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(0,0,0,0.1);
          display: flex;
          align-items: center;
          font-size: 11px;
        ">
          <div style="
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: ${MARKER_RING_WIDTH}px solid #555555;
            background: transparent;
            margin-right: 8px;
            box-sizing: border-box;
          "></div>
          <div>${emptyLabel}</div>
        </div>
        `}
      `;

      return div;
    };

    legend.addTo(map);

    return () => {
      legend.remove();
    };
  }, [map, domain, ramp, title, emptyLabel, formatShort]);

  return null;
}
