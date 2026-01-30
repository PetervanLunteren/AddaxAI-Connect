/**
 * Map legend component
 * Shows color scale for detection rates with continuous gradient
 */
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface MapLegendProps {
  domain: {
    min: number;
    max: number;
    p33: number;
    p66: number;
  };
}

export function MapLegend({ domain }: MapLegendProps) {
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

      // Calculate middle value
      const middleValue = domain.max / 2;

      // ColorBrewer YlGnBu 9-class sequential palette
      const gradientColors = [
        '#081d58',  // Top (highest) - darkest blue
        '#253494',
        '#225ea8',
        '#1d91c0',
        '#41b6c4',
        '#7fcdbb',
        '#c7e9b4',
        '#edf8b1',
        '#ffffd9',  // Bottom (zero) - lightest yellow
      ].join(', ');

      div.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">
          Detections per 100 trap-days
        </div>
        <div style="display: flex; align-items: center;">
          <div style="
            width: 20px;
            height: 150px;
            background: linear-gradient(to bottom, ${gradientColors});
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
            <div>${domain.max.toFixed(1)}</div>
            <div>${middleValue.toFixed(1)}</div>
            <div>0</div>
          </div>
        </div>
      `;

      return div;
    };

    legend.addTo(map);

    return () => {
      legend.remove();
    };
  }, [map, domain]);

  return null;
}
