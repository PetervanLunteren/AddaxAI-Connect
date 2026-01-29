/**
 * Map legend component
 * Shows color scale for detection rates
 */
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { generateLegendItems } from '../../utils/color-scale';

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

      const legendItems = generateLegendItems(domain);

      div.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">
          detections per 100 trap-days
        </div>
        ${legendItems
          .map(
            (item) => `
          <div style="display: flex; align-items: center; margin-bottom: 4px; font-size: 11px;">
            <span style="
              display: inline-block;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background-color: ${item.color};
              margin-right: 6px;
              border: 1px solid rgba(0,0,0,0.2);
              ${item.label === '0' ? 'opacity: 0.3;' : ''}
            "></span>
            <span>${item.label}</span>
          </div>
        `
          )
          .join('')}
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
