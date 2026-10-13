import { useEffect, useRef, useState } from 'react';

const H = 120;

// Amplitude of every frequency from −range to +range (log scale). Lit bars are the circles in play.
export default function Spectrum({ analysis, k, range }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !analysis || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, H);

    const { N, rank, amp } = analysis;
    const peak = amp[0] || 1;
    const bins = 2 * range + 1;
    const cols = Math.max(1, Math.min(bins, Math.floor(width / 3)));
    const per = bins / cols;
    const colW = width / cols;
    const base = H - 18;

    g.strokeStyle = 'rgba(160, 150, 255, 0.18)';
    g.beginPath();
    g.moveTo(0, base + 0.5);
    g.lineTo(width, base + 0.5);
    g.stroke();

    for (let c = 0; c < cols; c++) {
      const f0 = Math.floor(-range + c * per);
      const f1 = Math.max(f0, Math.floor(-range + (c + 1) * per) - 1);
      let best = 0;
      let on = false;
      for (let f = f0; f <= f1; f++) {
        if (f === 0 || f < -N / 2 || f >= N / 2) continue;
        const r = rank[f + N / 2];
        if (amp[r] > best) best = amp[r];
        if (r < k) on = true;
      }
      if (!best) continue;
      const level = Math.max(0.02, (Math.log10(best / peak) + 3.6) / 3.6);
      const bh = level * (base - 6);
      const x = c * colW;
      if (on) {
        g.shadowColor = `hsla(${190 + (150 * c) / cols}, 100%, 65%, 0.9)`;
        g.shadowBlur = 8;
        g.fillStyle = `hsl(${190 + (150 * c) / cols}, 100%, 68%)`;
      } else {
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(170, 160, 225, 0.17)';
      }
      g.beginPath();
      g.roundRect(x + 0.5, base - bh, Math.max(1, colW - 1), bh, 1.5);
      g.fill();
    }
    g.shadowBlur = 0;

    g.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    g.fillStyle = 'rgba(200, 192, 240, 0.55)';
    g.textBaseline = 'bottom';
    g.textAlign = 'left';
    g.fillText(`−${range}`, 0, H);
    g.textAlign = 'center';
    g.fillText('0', width / 2, H);
    g.textAlign = 'right';
    g.fillText(`+${range}`, width, H);
  }, [analysis, k, range, width]);

  return <canvas ref={ref} className="spectrum" aria-label="Frequency spectrum of the shape" role="img" />;
}
