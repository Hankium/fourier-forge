// Turns SVG markup into one closed loop of evenly spaced points, ready for a DFT.
// Every outline in the file is sampled, then all outlines are stitched into a single
// loop by walking a minimum spanning tree of "bridges" between them (each bridge is
// traced out and back, so it reads as a hairline instead of a slash across the shape).

const NS = 'http://www.w3.org/2000/svg';
const GEOMETRY = {
  path: ['d'],
  polygon: ['points'],
  polyline: ['points'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
};
const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
const MAX_CONTOURS = 300;

export const SAMPLE_COUNT = 2048;

export function svgToSamples(text, count = SAMPLE_COUNT) {
  const contours = readContours(text);
  const samples = resampleLoop(tourContours(contours), count);
  samples.contours = contours.length;
  return samples;
}

export function thumbPath({ xs, ys, bbox }, step = 6) {
  const size = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) || 1;
  const k = 84 / size;
  const ox = 50 - ((bbox.minX + bbox.maxX) / 2) * k;
  const oy = 50 - ((bbox.minY + bbox.maxY) / 2) * k;
  let d = '';
  for (let i = 0; i < xs.length; i += step) {
    d += `${i ? 'L' : 'M'}${(ox + xs[i] * k).toFixed(1)} ${(oy + ys[i] * k).toFixed(1)}`;
  }
  return `${d}Z`;
}

function readContours(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || !root || root.localName !== 'svg') {
    throw new Error("Couldn't read that file as SVG.");
  }

  // Rebuild only the geometry (no scripts, styles or external refs) in a hidden live SVG
  // so the browser resolves nested transforms and length units for us.
  const host = document.createElementNS(NS, 'svg');
  host.setAttribute('width', '10');
  host.setAttribute('height', '10');
  host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(host);
  try {
    const elements = [];
    mirror(root, host, elements);
    return finishContours(elements.flatMap(elementOutlines));
  } finally {
    host.remove();
  }
}

function isHidden(el) {
  const style = el.getAttribute('style') || '';
  return (
    el.getAttribute('display') === 'none' ||
    el.getAttribute('visibility') === 'hidden' ||
    /display\s*:\s*none/.test(style)
  );
}

function mirror(src, dst, out) {
  for (const child of src.children) {
    const tag = child.localName;
    if (isHidden(child)) continue;
    if (CONTAINERS.has(tag)) {
      const g = document.createElementNS(NS, 'g');
      const offset =
        tag === 'svg'
          ? `translate(${parseFloat(child.getAttribute('x')) || 0} ${parseFloat(child.getAttribute('y')) || 0}) `
          : '';
      const transform = `${offset}${child.getAttribute('transform') || ''}`.trim();
      if (transform) g.setAttribute('transform', transform);
      dst.appendChild(g);
      mirror(child, g, out);
    } else if (GEOMETRY[tag]) {
      const el = document.createElementNS(NS, tag);
      for (const name of [...GEOMETRY[tag], 'transform']) {
        const value = child.getAttribute(name);
        if (value != null) el.setAttribute(name, value);
      }
      dst.appendChild(el);
      out.push(el);
    }
  }
}

// Outlines of one element as polylines in root coordinates: [{ pts, closed }].
function elementOutlines(el) {
  const m = el.getCTM() || new DOMMatrix();
  const tf = ({ x, y }) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  let outlines;
  try {
    outlines = localOutlines(el);
  } catch {
    return [];
  }
  return outlines.filter((o) => o.pts.length > 1).map((o) => ({ pts: o.pts.map(tf), closed: o.closed }));
}

const lengthAttr = (el, name) => el[name].baseVal.value;

function localOutlines(el) {
  switch (el.localName) {
    case 'path':
      return flattenPath(el.getAttribute('d') || '');
    case 'polygon':
    case 'polyline': {
      const list = el.points;
      const pts = [];
      for (let i = 0; i < list.numberOfItems; i++) {
        const p = list.getItem(i);
        pts.push({ x: p.x, y: p.y });
      }
      return [{ pts, closed: el.localName === 'polygon' }];
    }
    case 'line':
      return [
        {
          pts: [
            { x: lengthAttr(el, 'x1'), y: lengthAttr(el, 'y1') },
            { x: lengthAttr(el, 'x2'), y: lengthAttr(el, 'y2') },
          ],
          closed: false,
        },
      ];
    case 'circle': {
      const r = lengthAttr(el, 'r');
      return ellipseOutline(lengthAttr(el, 'cx'), lengthAttr(el, 'cy'), r, r);
    }
    case 'ellipse':
      return ellipseOutline(lengthAttr(el, 'cx'), lengthAttr(el, 'cy'), lengthAttr(el, 'rx'), lengthAttr(el, 'ry'));
    case 'rect':
      return rectOutline(el);
    default:
      return [];
  }
}

function ellipseOutline(cx, cy, rx, ry) {
  if (!(rx > 0 && ry > 0)) return [];
  const pts = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * TAU;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return [{ pts, closed: true }];
}

function rectOutline(el) {
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((n) => lengthAttr(el, n));
  if (!(w > 0 && h > 0)) return [];
  let rx = el.hasAttribute('rx') ? lengthAttr(el, 'rx') : null;
  let ry = el.hasAttribute('ry') ? lengthAttr(el, 'ry') : null;
  rx ??= ry ?? 0;
  ry ??= rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0 && ry > 0)) {
    return [{ pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }];
  }
  const arc = `A${rx} ${ry} 0 0 1`;
  return flattenPath(
    `M${x + rx} ${y}H${x + w - rx}${arc} ${x + w} ${y + ry}V${y + h - ry}${arc} ${x + w - rx} ${y + h}` +
      `H${x + rx}${arc} ${x} ${y + h - ry}V${y + ry}${arc} ${x + rx} ${y}Z`,
  );
}

// ── Path data → polylines ─────────────────────────────────────────────────────
// Parses every SVG path command (absolute and relative, implicit repeats, compact arc flags),
// turns quadratics and arcs into cubics, then flattens cubics with a size-relative tolerance.

const TAU = Math.PI * 2;
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

function flattenPath(d) {
  const subpaths = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl = null;
  let i = 0;

  const skip = () => {
    while (i < d.length && ' \t\n\r\f,'.includes(d[i])) i++;
  };
  const num = () => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new Error('bad number');
    i = NUM.lastIndex;
    return parseFloat(m[0]);
  };
  const flag = () => {
    skip();
    const c = d[i++];
    if (c !== '0' && c !== '1') throw new Error('bad flag');
    return c === '1';
  };
  const ensure = () => {
    if (!cur || cur.closed) {
      cur = { ops: [{ x, y }], closed: false };
      subpaths.push(cur);
    }
  };
  const line = (nx, ny) => {
    ensure();
    cur.ops.push({ x: nx, y: ny });
    x = nx;
    y = ny;
    lastCtrl = null;
  };
  const cubic = (x1, y1, x2, y2, nx, ny) => {
    ensure();
    cur.ops.push({ c: [x1, y1, x2, y2], x: nx, y: ny });
    lastCtrl = { kind: 'C', x: x2, y: y2 };
    x = nx;
    y = ny;
  };
  const quad = (qx, qy, nx, ny) => {
    cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
    lastCtrl = { kind: 'Q', x: qx, y: qy };
  };
  const reflect = (kind) => (lastCtrl?.kind === kind ? [2 * x - lastCtrl.x, 2 * y - lastCtrl.y] : [x, y]);

  let cmd = '';
  try {
    for (;;) {
      skip();
      if (i >= d.length) break;
      if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
      else if (!cmd || cmd === 'z' || cmd === 'Z') break;
      else if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';

      const rel = cmd >= 'a';
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M':
          x = ox + num();
          y = oy + num();
          sx = x;
          sy = y;
          cur = { ops: [{ x, y }], closed: false };
          subpaths.push(cur);
          lastCtrl = null;
          break;
        case 'L': {
          const nx = ox + num();
          line(nx, oy + num());
          break;
        }
        case 'H':
          line(ox + num(), y);
          break;
        case 'V':
          line(x, oy + num());
          break;
        case 'C': {
          const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
          cubic(...a);
          break;
        }
        case 'S': {
          const [x1, y1] = reflect('C');
          const a = [ox + num(), oy + num(), ox + num(), oy + num()];
          cubic(x1, y1, ...a);
          break;
        }
        case 'Q': {
          const a = [ox + num(), oy + num(), ox + num(), oy + num()];
          quad(...a);
          break;
        }
        case 'T': {
          const [qx, qy] = reflect('Q');
          const nx = ox + num();
          quad(qx, qy, nx, oy + num());
          break;
        }
        case 'A': {
          const [rx, ry, rot] = [num(), num(), num()];
          const [large, sweep] = [flag(), flag()];
          const nx = ox + num();
          const ny = oy + num();
          const pieces = arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny);
          if (pieces.length) pieces.forEach((p) => cubic(...p));
          else line(nx, ny);
          lastCtrl = null;
          break;
        }
        case 'Z':
          if (cur && !cur.closed) {
            cur.ops.push({ x: sx, y: sy });
            cur.closed = true;
          }
          x = sx;
          y = sy;
          lastCtrl = null;
          break;
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    }
  } catch {
    // Like browsers, render everything up to the first error.
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sp of subpaths) {
    for (const op of sp.ops) {
      minX = Math.min(minX, op.x);
      maxX = Math.max(maxX, op.x);
      minY = Math.min(minY, op.y);
      maxY = Math.max(maxY, op.y);
    }
  }
  const unit = Math.hypot(maxX - minX, maxY - minY) / 500 || 1;

  return subpaths.map((sp) => {
    const pts = [];
    let px = 0;
    let py = 0;
    for (const op of sp.ops) {
      if (op.c) {
        const [x1, y1, x2, y2] = op.c;
        const hull = Math.hypot(x1 - px, y1 - py) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(op.x - x2, op.y - y2);
        const n = Math.min(96, Math.max(2, Math.ceil(hull / unit)));
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const e = t * t * t;
          pts.push({ x: a * px + b * x1 + c * x2 + e * op.x, y: a * py + b * y1 + c * y2 + e * op.y });
        }
      } else {
        pts.push({ x: op.x, y: op.y });
      }
      px = op.x;
      py = op.y;
    }
    return { pts, closed: sp.closed };
  });
}

// SVG elliptical arc (endpoint form) → cubic Béziers of at most 90° each. SVG spec, appendix B.2.
function arcToCubics(x1, y1, rx, ry, angleDeg, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * yp * yp - ry2 * xp * xp);
  let coef = Math.sqrt(num / (rx2 * yp * yp + ry2 * xp * xp));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (xp - cxp) / rx;
  const uy = (yp - cyp) / ry;
  const theta = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= TAU;
  else if (sweep && delta < 0) delta += TAU;

  const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const map = (px, py) => [cx + rx * px * cos - ry * py * sin, cy + rx * px * sin + ry * py * cos];
  const out = [];
  for (let s = 0, a = theta; s < segs; s++, a += step) {
    const c1 = Math.cos(a);
    const s1 = Math.sin(a);
    const c2 = Math.cos(a + step);
    const s2 = Math.sin(a + step);
    out.push([...map(c1 - k * s1, s1 + k * c1), ...map(c2 + k * s2, s2 - k * c2), ...map(c2, s2)]);
  }
  // Land exactly on the requested endpoint.
  out[out.length - 1][4] = x2;
  out[out.length - 1][5] = y2;
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function openLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

function loopLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length; i++) len += dist(pts[i], pts[(i + 1) % pts.length]);
  return len;
}

function densify(pts, maxSeg) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a);
    const pieces = Math.ceil(dist(a, b) / maxSeg);
    for (let j = 1; j < pieces; j++) {
      const u = j / pieces;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  return out;
}

function finishContours(raw) {
  const drawn = raw.reduce((sum, r) => sum + openLength(r.pts), 0);
  if (!(drawn > 0)) throw new Error('No drawable outlines found. Convert text and strokes to paths first.');
  const tol = drawn * 5e-4;

  // Every contour becomes a cyclic list of points. Open strokes are walked there and back.
  const loops = raw.map(({ pts, closed }) => {
    const gap = dist(pts[0], pts[pts.length - 1]);
    const isClosed = closed || gap <= tol;
    if (isClosed) return gap <= tol && pts.length > 2 ? pts.slice(0, -1) : pts;
    return pts.concat(pts.slice(1, -1).reverse());
  });
  const lengths = loops.map(loopLength);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error('The outlines in that SVG have no length.');

  const maxSeg = total / 4000;
  const contours = loops
    .map((pts, i) => ({ pts, len: lengths[i] }))
    .filter((c) => c.len > total * 1e-4)
    .sort((a, b) => b.len - a.len)
    .slice(0, MAX_CONTOURS)
    .map((c) => densify(c.pts, maxSeg));
  if (!contours.length) throw new Error('The outlines in that SVG are too small to draw.');
  return contours;
}

function probes(pts, count) {
  const stride = Math.max(1, Math.floor(pts.length / count));
  const idx = [];
  for (let i = 0; i < pts.length; i += stride) idx.push(i);
  return { idx, stride };
}

function nearestPair(A, pa, B, pb) {
  let best = Infinity;
  let at = 0;
  let entry = 0;
  for (const i of pa.idx) {
    const a = A[i];
    for (const j of pb.idx) {
      const b = B[j];
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (d < best) {
        best = d;
        at = i;
        entry = j;
      }
    }
  }
  return { d: best, at, entry };
}

function refinePair(A, B, at, entry, ra, rb) {
  let best = Infinity;
  let bi = at;
  let bj = entry;
  for (let di = -ra; di <= ra; di++) {
    const i = (((at + di) % A.length) + A.length) % A.length;
    for (let dj = -rb; dj <= rb; dj++) {
      const j = (((entry + dj) % B.length) + B.length) % B.length;
      const d = (A[i].x - B[j].x) ** 2 + (A[i].y - B[j].y) ** 2;
      if (d < best) {
        best = d;
        bi = i;
        bj = j;
      }
    }
  }
  return { at: bi, entry: bj };
}

function tourContours(contours) {
  const C = contours.length;
  if (C === 1) return contours[0];

  // Prim's MST over contours (largest one is the root), using coarse probes for speed.
  const probeCount = C > 120 ? 16 : C > 40 ? 32 : 64;
  const pr = contours.map((c) => probes(c, probeCount));
  const inTree = new Uint8Array(C);
  const best = Array.from({ length: C }, () => ({ d: Infinity, parent: -1, at: 0, entry: 0 }));
  const children = Array.from({ length: C }, () => new Map());
  const relax = (a) => {
    for (let b = 0; b < C; b++) {
      if (inTree[b]) continue;
      const hit = nearestPair(contours[a], pr[a], contours[b], pr[b]);
      if (hit.d < best[b].d) best[b] = { ...hit, parent: a };
    }
  };
  inTree[0] = 1;
  relax(0);
  for (let added = 1; added < C; added++) {
    let pick = -1;
    for (let b = 0; b < C; b++) if (!inTree[b] && (pick < 0 || best[b].d < best[pick].d)) pick = b;
    inTree[pick] = 1;
    const e = best[pick];
    const { at, entry } = refinePair(contours[e.parent], contours[pick], e.at, e.entry, pr[e.parent].stride, pr[pick].stride);
    const list = children[e.parent].get(at) ?? [];
    list.push({ child: pick, entry });
    children[e.parent].set(at, list);
    relax(pick);
  }

  // Depth-first walk: go around each contour, detouring into children at their bridge points.
  const out = [];
  const walk = (ci, start) => {
    const pts = contours[ci];
    const n = pts.length;
    for (let s = 0; s <= n; s++) {
      const i = (start + s) % n;
      out.push(pts[i]);
      if (s < n && children[ci].has(i)) {
        for (const kid of children[ci].get(i)) {
          walk(kid.child, kid.entry);
          out.push(pts[i]);
        }
      }
    }
  };
  walk(0, 0);
  out.pop();
  return out;
}

function resampleLoop(pts, count) {
  const n = pts.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + dist(pts[i], pts[(i + 1) % n]);
  const total = cum[n];
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % n];
    const span = cum[seg + 1] - cum[seg];
    const u = span > 0 ? (target - cum[seg]) / span : 0;
    const x = a.x + (b.x - a.x) * u;
    const y = a.y + (b.y - a.y) * u;
    xs[k] = x;
    ys[k] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { xs, ys, bbox: { minX, minY, maxX, maxY } };
}
