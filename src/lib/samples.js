// Test shapes. Kept free of DOM access so scripts/export-samples.mjs can write them to public/samples.

const INK = '#8f7cff';
const wrap = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${INK}">\n  ${body.join('\n  ')}\n</svg>\n`;
const pts = (list) => list.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ');
const STROKE = `fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"`;

function fit(list, lo = 6, hi = 94) {
  const xs = list.map((p) => p[0]);
  const ys = list.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = (hi - lo) / Math.max(maxX - minX, maxY - minY);
  return list.map(([x, y]) => [50 + (x - (minX + maxX) / 2) * k, 50 + (y - (minY + maxY) / 2) * k]);
}

function star(n = 5, R = 47, r = 19, cx = 50, cy = 52) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 ? r : R;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  });
}

function gear(teeth = 12, R = 46, r = 37) {
  const T = (Math.PI * 2) / teeth;
  const out = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * T - Math.PI / 2;
    for (const [u, rad] of [[0, r], [0.22, r], [0.34, R], [0.62, R], [0.74, r]]) {
      out.push([50 + rad * Math.cos(a + u * T), 50 + rad * Math.sin(a + u * T)]);
    }
  }
  return out;
}

function koch(order = 3, R = 44) {
  let p = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    return [50 + R * Math.cos(a), 50 + R * Math.sin(a)];
  });
  const h = Math.sqrt(3) / 2;
  for (let o = 0; o < order; o++) {
    const next = [];
    p.forEach(([ax, ay], i) => {
      const [bx, by] = p[(i + 1) % p.length];
      const dx = (bx - ax) / 3;
      const dy = (by - ay) / 3;
      next.push([ax, ay], [ax + dx, ay + dy], [ax + 1.5 * dx + dy * h, ay + 1.5 * dy - dx * h], [ax + 2 * dx, ay + 2 * dy]);
    });
    p = next;
  }
  return p;
}

// Temple Fay's butterfly curve — it closes on itself after 12π.
function butterfly(steps = 1600) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 12 * Math.PI;
    const e = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.sin(t / 12) ** 5;
    out.push([Math.sin(t) * e, -Math.cos(t) * e]);
  }
  return fit(out);
}

function hilbert(order = 4) {
  const n = 1 << order;
  const out = [];
  for (let d = 0; d < n * n; d++) {
    let x = 0;
    let y = 0;
    let t = d;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t / 2);
      const ry = 1 & (t ^ rx);
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        [x, y] = [y, x];
      }
      x += s * rx;
      y += s * ry;
      t = Math.floor(t / 4);
    }
    out.push([((x + 0.5) * 100) / n, ((y + 0.5) * 100) / n]);
  }
  return out;
}

export const SAMPLES = [
  {
    id: 'heart',
    name: 'Heart',
    svg: wrap('0 0 100 92', [
      '<path d="M50 88 C22 66 4 48 4 28 C4 14 15 4 28 4 C38 4 46 10 50 19 C54 10 62 4 72 4 C85 4 96 14 96 28 C96 48 78 66 50 88 Z"/>',
    ]),
  },
  { id: 'star', name: 'Star', svg: wrap('0 0 100 100', [`<polygon points="${pts(star())}"/>`]) },
  {
    id: 'bolt',
    name: 'Bolt',
    svg: wrap('0 0 100 100', ['<polygon points="62,2 18,56 46,56 34,98 86,38 56,38 76,2"/>']),
  },
  {
    id: 'fish',
    name: 'Fish',
    svg: wrap('0 0 100 100', [
      '<path d="M8 50 C26 22 62 18 82 46 L96 30 C92 44 92 56 96 70 L82 54 C62 82 26 78 8 50 Z"/>',
      '<circle cx="24" cy="45" r="4.5" fill="#100e1c"/>',
      `<path d="M38 36 C44 44 44 56 38 64" ${STROKE}/>`,
    ]),
  },
  {
    id: 'cat',
    name: 'Cat',
    svg: wrap('0 0 100 100', [
      '<path d="M50 94 C26 94 12 82 12 62 C12 52 15 45 19 40 L14 6 L38 26 C42 25 46 24 50 24 C54 24 58 25 62 26 L86 6 L81 40 C85 45 88 52 88 62 C88 82 74 94 50 94 Z"/>',
      '<ellipse cx="36" cy="58" rx="5" ry="7" fill="#100e1c"/>',
      '<ellipse cx="64" cy="58" rx="5" ry="7" fill="#100e1c"/>',
      '<path d="M45 71 L55 71 L50 77 Z" fill="#100e1c"/>',
      `<path d="M2 66 L28 70 M2 78 L28 75 M98 66 L72 70 M98 78 L72 75" ${STROKE}/>`,
    ]),
  },
  {
    id: 'gear',
    name: 'Gear',
    svg: wrap('0 0 100 100', [`<polygon points="${pts(gear())}"/>`, '<circle cx="50" cy="50" r="13" fill="#100e1c"/>']),
  },
  { id: 'snowflake', name: 'Koch', svg: wrap('0 0 100 100', [`<polygon points="${pts(koch())}"/>`]) },
  { id: 'butterfly', name: 'Butterfly', svg: wrap('0 0 100 100', [`<polygon points="${pts(butterfly())}"/>`]) },
  { id: 'hilbert', name: 'Hilbert', svg: wrap('0 0 100 100', [`<polyline points="${pts(hilbert())}" ${STROKE}/>`]) },
];
