import { useEffect, useRef, useState } from 'react';

// Eases a number towards its latest value so readouts count up instead of jumping.
export function useTweened(value, ms = 700) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      current.current = from + (value - from) * eased;
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return shown;
}
