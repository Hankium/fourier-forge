// Raster → outlines. Text and bitmap images are turned into a scalar field, contoured with
// marching squares and emitted as SVG polygons, so they go through exactly the same
// pipeline as an uploaded SVG.

const MAX_LOOPS = 80;

export async function textToSvg(text) {
  const size = 180;
  const height = 260;
  const font = `900 ${size}px Nunito, "Segoe UI", system-ui, sans-serif`;
  try {
    await document.fonts.load(font, text);
  } catch {
    // fall back to whatever font the browser has
  }
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const width = Math.ceil(probe.measureText(text).width) + 40;
  const g = canvas2d(width, height);
  g.font = font;
  g.textBaseline = 'middle';
  g.fillText(text, 20, height / 2);
  const { data } = g.getImageData(0, 0, width, height);
  const field = new Float32Array(width * height);
  for (let i = 0; i < field.length; i++) field[i] = data[i * 4 + 3] / 255;
  return fieldToSvg(field, width, height, 0.5);
}

// Silhouettes and logos: transparent images trace their alpha; opaque ones trace the darker
// side of an automatic (Otsu) threshold, flipped if the background turns out to be the dark part.
export async function imageToSvg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 420 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(8, Math.round(bitmap.width * scale));
  const h = Math.max(8, Math.round(bitmap.height * scale));
  const g = canvas2d(w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const { data } = g.getImageData(0, 0, w, h);

  const n = w * h;
  const alpha = new Float32Array(n);
  const dark = new Float32Array(n);
  let seeThrough = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const lum = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    alpha[i] = a;
    dark[i] = a * (1 - lum);
    if (a < 0.9) seeThrough++;
  }
  if (seeThrough > n * 0.02) return fieldToSvg(blur(alpha, w, h), w, h, 0.5);

  const field = blur(dark, w, h);
  let threshold = otsu(field);
  let border = 0;
  for (let x = 0; x < w; x++) border += field[x] + field[(h - 1) * w + x];
  for (let y = 0; y < h; y++) border += field[y * w] + field[y * w + w - 1];
  if (border / (2 * (w + h)) > threshold) {
    for (let i = 0; i < n; i++) field[i] = 1 - field[i];
    threshold = 1 - threshold;
  }
  return fieldToSvg(field, w, h, threshold);
}

function canvas2d(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv.getContext('2d', { willReadFrequently: true });
}

function blur(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += src[yy * w + xx];
          cnt++;
        }
      }
      out[y * w + x] = sum / cnt;
    }
  }
  return out;
}

function otsu(field) {
  const hist = new Float64Array(256);
  for (const v of field) hist[Math.min(255, Math.max(0, Math.round(v * 255)))]++;
  const total = field.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let pick = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      pick = i;
    }
  }
  return (pick + 0.5) / 255;
}

export function fieldToSvg(field, w, h, threshold) {
  const loops = marchingSquares(field, w, h, threshold)
    .filter((l) => l.length >= 8)
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_LOOPS)
    .map((l) => simplify(l, 0.35));
  if (!loops.length) throw new Error('Nothing to trace. The image looks empty.');
  const polys = loops.map((l) => `<polygon points="${l.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${polys.join('')}</svg>`;
}

// Contours of field = threshold. Cells outside the image count as empty, so every loop closes.
function marchingSquares(field, w, h, thr) {
  const W2 = w + 2;
  const val = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : field[y * w + x]);
  const frac = (a, b) => (b === a ? 0.5 : (thr - a) / (b - a));
  const pts = new Map();
  const adj = new Map();
  const hEdge = (x, y) => {
    const key = ((y + 1) * W2 + (x + 1)) * 2;
    if (!pts.has(key)) pts.set(key, [x + frac(val(x, y), val(x + 1, y)), y]);
    return key;
  };
  const vEdge = (x, y) => {
    const key = ((y + 1) * W2 + (x + 1)) * 2 + 1;
    if (!pts.has(key)) pts.set(key, [x, y + frac(val(x, y), val(x, y + 1))]);
    return key;
  };
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const idx =
        (val(x, y) >= thr ? 8 : 0) | (val(x + 1, y) >= thr ? 4 : 0) | (val(x + 1, y + 1) >= thr ? 2 : 0) | (val(x, y + 1) >= thr ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => hEdge(x, y);
      const B = () => hEdge(x, y + 1);
      const L = () => vEdge(x, y);
      const R = () => vEdge(x + 1, y);
      switch (idx) {
        case 1:
        case 14:
          link(L(), B());
          break;
        case 2:
        case 13:
          link(B(), R());
          break;
        case 3:
        case 12:
          link(L(), R());
          break;
        case 4:
        case 11:
          link(T(), R());
          break;
        case 6:
        case 9:
          link(T(), B());
          break;
        case 7:
        case 8:
          link(L(), T());
          break;
        case 5:
          link(T(), R());
          link(L(), B());
          break;
        case 10:
          link(L(), T());
          link(B(), R());
          break;
        default:
          break;
      }
    }
  }

  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1;
    let cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pts.get(cur));
      const [a, b] = adj.get(cur);
      const next = a !== prev ? a : b;
      prev = cur;
      cur = next;
    }
    loops.push(loop);
  }
  return loops;
}

// Ramer–Douglas–Peucker on a closed loop (split at the first point and the point farthest from it).
function simplify(loop, eps) {
  if (loop.length < 16) return loop;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(loop.slice(0, far + 1), eps);
  const b = rdp(loop.slice(far).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function rdp(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let idx = -1;
    let best = eps;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > best) {
        best = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
