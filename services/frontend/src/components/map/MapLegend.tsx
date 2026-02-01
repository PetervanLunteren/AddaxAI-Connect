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

      // App gradient from FRONTEND_CONVENTIONS.md: #0f6064 (high) -> #f9f871 (low)
      const gradientColors = [
        '#0f6064',  // Top (highest) - dark teal
        '#f9f871',  // Bottom (zero) - light yellow
      ].join(', ');

      div.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; line-height: 1.3;">
          Detections per<br>100 trap-days
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
            <div>${Math.round(domain.max)}</div>
            <div>${Math.round(middleValue)}</div>
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
