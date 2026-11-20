/**
 * Whether a CSS media query matches, kept up to date. For layouts that must
 * mount a different tree per width (a map mounted twice and hidden by CSS
 * would load its tiles twice). Plain CSS breakpoints stay the default.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
