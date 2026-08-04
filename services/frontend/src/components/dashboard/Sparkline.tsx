/**
 * A trend line small enough to sit inside a stat tile.
 *
 * Plain SVG rather than Chart.js: there are no axes, no tooltip and no
 * interaction, so a chart instance per tile would be pure overhead. The last
 * point gets a dot because that is the value the number above refers to.
 */
import React from 'react';

interface SparklineProps {
  values: number[];
  className?: string;
}

const WIDTH = 100;
const HEIGHT = 24;
const PAD = 2;

export const Sparkline: React.FC<SparklineProps> = ({ values, className = '' }) => {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series would divide by zero, and a straight line is the honest
  // picture of it, so collapse it to the middle of the box.
  const span = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * WIDTH;
    const y = HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT}Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={`block h-6 w-full ${className}`}
      aria-hidden="true"
    >
      <path d={area} fill="rgba(15, 96, 100, 0.13)" />
      <path d={line} fill="none" stroke="#0f6064" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill="#0f6064" />
    </svg>
  );
};
