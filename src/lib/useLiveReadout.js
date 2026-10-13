import { useEffect, useRef } from 'react';
import { formatZ } from './equationTex.js';

// Subscribes two text nodes (t and z(t)) to the per-frame feed without re-rendering React.
// `live` is a ref holding a Set of listeners that the stage calls every frame.
export function useLiveReadout(live) {
  const tRef = useRef(null);
  const zRef = useRef(null);
  useEffect(() => {
    const listener = (t, tip) => {
      if (tRef.current) tRef.current.textContent = t.toFixed(3);
      if (zRef.current) zRef.current.textContent = formatZ(tip);
    };
    const listeners = live.current;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [live]);
  return { tRef, zRef };
}
