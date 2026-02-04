/**
 * Camera map legend component
 * Shows categorical legend for status, battery, or signal coloring
 */
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getLegendItems, type ColorByMetric } from '../../utils/camera-colors';

interface CameraMapLegendProps {
  colorBy: ColorByMetric;
}

const LEGEND_TITLES: Record<ColorByMetric, string> = {
  status: 'Status',
  battery: 'Battery',
  signal: 'Signal',
};

export function CameraMapLegend({ colorBy }: CameraMapLegendProps) {
  const map = useMap();

  useEffect(() => {
    const legend = new L.Control({ position: 'bottomright' });

    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      div.style.backgroundColor = 'white';
      div.style.padding = '10px';
      div.style.borderRadius = '4px';
      div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

      const items = getLegendItems(colorBy);

      div.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">
          ${LEGEND_TITLES[colorBy]}
        </div>
        ${items
          .map(
            (item) => `
          <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <span style="
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: ${item.color};
              border: 1px solid #555555;
              margin-right: 8px;
              flex-shrink: 0;
            "></span>
            <span style="font-size: 11px;">${item.label}</span>
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
  }, [map, colorBy]);

  return null;
}
