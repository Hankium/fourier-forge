// Hand-built series for the equation playground: each term is one circle
// { r: radius, f: turns per lap (integer), p: starting angle in degrees }.
import { SAMPLE_COUNT } from './svgSampler.js';

export const MAX_TERMS = 12;
export const F_RANGE = 30;

let nextId = 1;
const withIds = (list) => list.map(([r, f, p]) => ({ id: nextId++, r, f, p }));

export const PRESETS = [
  { name: 'Circle', terms: [[50, 1, 0]] },
  { name: 'Ellipse', terms: [[50, 1, 0], [20, -1, 0]] },
  { name: 'Flower', terms: [[45, 1, 0], [22, -4, 0]] },
  { name: 'Star', terms: [[50, 1, 90], [20, -4, 270]] },
  { name: 'Spiro', terms: [[50, 1, 0], [30, -7, 0], [12, 9, 90]] },
  { name: 'Loops', terms: [[40, 1, 0], [18, 8, 0], [6, -15, 45]] },
].map((p) => ({ ...p, make: () => withIds(p.terms) }));

export const defaultTerms = () => PRESETS[2].make();

export const blankTerm = (terms) => {
  const used = new Set(terms.map((t) => t.f));
  let f = 2;
  while (used.has(f) || used.has(-f)) f++;
  return { id: nextId++, r: 10, f: -f, p: 0 };
};

export function randomTerms() {
  const n = 3 + Math.floor(Math.random() * 3);
  const used = new Set([0]);
  const list = [];
  let r = 50;
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (i) {
      do f = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 12));
      while (used.has(f));
    }
    used.add(f);
    list.push([Math.round(r * 2) / 2, f, 15 * Math.floor(Math.random() * 24)]);
    r *= 0.35 + Math.random() * 0.35;
  }
  return withIds(list);
}

// The biggest circles of an analysed shape, rescaled so the largest radius is 50.
export function termsFromAnalysis(an, count = 8) {
  const n = Math.min(count, an.count);
  const scale = 50 / (an.amp[0] || 1);
  const list = [];
  for (let j = 0; j < n; j++) {
    const r = Math.round(an.amp[j] * scale * 2) / 2;
    if (r <= 0) continue;
    const p = Math.round(((((an.phase[j] * 180) / Math.PI) % 360) + 360) % 360);
    list.push([r, an.freq[j], p]);
  }
  return withIds(list);
}

// Samples the series like a traced outline so it can go through the normal analysis.
export function seriesSamples(terms, count = SAMPLE_COUNT) {
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (const { r, f, p } of terms) {
    if (!r) continue;
    const phase = (p * Math.PI) / 180;
    for (let n = 0; n < count; n++) {
      const a = (2 * Math.PI * f * n) / count + phase;
      xs[n] += r * Math.cos(a);
      ys[n] += r * Math.sin(a);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let n = 0; n < count; n++) {
    minX = Math.min(minX, xs[n]);
    maxX = Math.max(maxX, xs[n]);
    minY = Math.min(minY, ys[n]);
    maxY = Math.max(maxY, ys[n]);
  }
  if (maxX - minX < 1e-6 && maxY - minY < 1e-6) return null; // nothing moves: no shape to draw
  return { xs, ys, bbox: { minX, minY, maxX, maxY }, contours: 1 };
}

const fmt = (v) => String(Math.round(v * 100) / 100);

function angleTex(f) {
  if (f === 0) return '';
  if (f === 1) return '2\\pi t';
  if (f === -1) return '-2\\pi t';
  return `${f < 0 ? '-' : ''}2\\pi{\\cdot}${Math.abs(f)}\\,t`;
}

// The user's equation exactly as entered, in their order, with φ in degrees.
export function termsTex(terms) {
  const parts = terms
    .filter((t) => t.r)
    .map(({ r, f, p }) => {
      const ang = angleTex(f);
      const ph = p ? `${ang ? ' + ' : ''}${fmt(p)}^\\circ` : '';
      const exp = ang || ph ? `\\,e^{\\,i(${ang}${ph})}` : '';
      return `${fmt(r)}${exp}`;
    });
  return `z(t) = ${parts.length ? parts.join(' + ') : '0'}`;
}
