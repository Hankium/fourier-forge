import { useEffect, useRef, useState } from 'react';

// Freehand sketch pad. Strokes are kept in a 0–1000 box and handed back as SVG polylines
// (or polygons when a stroke ends near where it started).
const BOX = 1000;
const CLOSE_GAP = 40;

function toSvg(strokes) {
  const body = strokes.map((s) => {
    const [first, last] = [s[0], s[s.length - 1]];
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < CLOSE_GAP;
    const pts = s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return closed ? `<polygon points="${pts}"/>` : `<polyline points="${pts}" fill="none"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}">${body.join('')}</svg>`;
}

export default function DrawPad({ onDone, onClose }) {
  const canvasRef = useRef(null);
  const strokes = useRef([]);
  const drawing = useRef(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const redraw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(rect.width * dpr)) {
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
    }
    const g = cv.getContext('2d');
    const k = (rect.width * dpr) / BOX;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineWidth = 1 / k;
    g.strokeStyle = 'rgba(160, 150, 255, 0.08)';
    for (let i = 100; i < BOX; i += 100) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, BOX);
      g.moveTo(0, i);
      g.lineTo(BOX, i);
      g.stroke();
    }
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const [width, color] of [
      [14, 'rgba(255, 111, 181, 0.18)'],
      [4, '#ff8fc6'],
    ]) {
      g.lineWidth = (width * dpr) / k;
      g.strokeStyle = color;
      for (const s of strokes.current) {
        g.beginPath();
        s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
    }
  };

  useEffect(() => {
    redraw();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', redraw);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', redraw);
    };
  });

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOX, ((e.clientY - r.top) / r.height) * BOX];
  };

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([point(e)]);
    redraw();
  };
  const move = (e) => {
    if (!drawing.current) return;
    const s = strokes.current[strokes.current.length - 1];
    const p = point(e);
    const q = s[s.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 3) return;
    s.push(p);
    redraw();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const s = strokes.current[strokes.current.length - 1];
    if (s.length < 3) strokes.current.pop();
    setCount(strokes.current.length);
    redraw();
  };

  const finish = async () => {
    setBusy(true);
    const ok = await onDone(toSvg(strokes.current));
    if (!ok) setBusy(false);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label="Draw a shape" style={{ '--accent': 'var(--pink)' }}>
        <h2>Draw a shape</h2>
        <p className="modal-hint">One loop works best. Several strokes are fine too; they get stitched together.</p>
        <canvas
          ref={canvasRef}
          className="draw-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!count}
            onClick={() => {
              strokes.current.pop();
              setCount(strokes.current.length);
              redraw();
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!count}
            onClick={() => {
              strokes.current = [];
              setCount(0);
              redraw();
            }}
          >
            Clear
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-pink btn-sm" disabled={!count || busy} onClick={finish}>
            Trace it
          </button>
        </div>
      </div>
    </div>
  );
}
