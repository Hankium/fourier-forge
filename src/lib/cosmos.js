// Celestial look for the epicycle chain. The first circle's centre is a star; every joint is a
// planet or moon riding its parent's orbit. Surfaces are procedural and hierarchical: each zoom
// octave adds a finer layer of craters, bands, coastlines, cracks or granules, so you can keep
// diving towards the ground.

const TAU = Math.PI * 2;

// Only the first joints get full worlds; deeper ones (tiny, crowded near the pen) are asteroids.
export const MAX_BODIES = 24;

// ── deterministic randomness ─────────────────────────────────────────────────

export function hash(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = Math.imul(h ^ (Math.floor(p) | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

function prng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── bodies ───────────────────────────────────────────────────────────────────

const SYL_A = ['Ae', 'Bel', 'Cal', 'Dra', 'Ely', 'Fen', 'Gal', 'Hel', 'Ix', 'Jun', 'Kor', 'Lyr', 'Mer', 'Nyx', 'Or', 'Pyr', 'Quo', 'Rhe', 'Sel', 'Thal', 'Ul', 'Vor', 'Xan', 'Zeph'];
const SYL_B = ['a', 'ion', 'is', 'on', 'us', 'ara', 'eth', 'ix', 'or', 'une', 'os', 'ia'];

const LABELS = {
  star: 'Star',
  gas: 'Gas giant',
  ringed: 'Ringed giant',
  ocean: 'Ocean world',
  rocky: 'Rocky world',
  ice: 'Ice world',
  lava: 'Lava world',
};

const hsl = (h, s, l, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;

function palette(type, rand) {
  const j = (span) => (rand() - 0.5) * span;
  switch (type) {
    case 'star':
      return { dot: '#fff3c4' };
    case 'gas':
    case 'ringed': {
      const h = [32, 22, 205, 275, 48, 190][Math.floor(rand() * 6)] + j(12);
      return {
        base: hsl(h, 45, 52),
        light: hsl(h + 8, 55, 74),
        dark: hsl(h - 10, 50, 32),
        storm: hsl(h - 20, 65, 45),
        atmo: hsl(h, 80, 70),
        ring: [hsl(h + 15, 35, 78, 0.55), hsl(h, 30, 60, 0.4), hsl(h + 25, 40, 85, 0.3)],
        dot: hsl(h, 50, 62),
      };
    }
    case 'ocean': {
      const h = 210 + j(16);
      return {
        base: hsl(h, 70, 32),
        mottle: [hsl(h - 10, 70, 42, 0.18), hsl(h + 10, 75, 22, 0.2)],
        land: [hsl(105 + j(30), 38, 36), hsl(38 + j(10), 42, 52), hsl(90 + j(20), 30, 28)],
        cloud: 'rgba(255, 255, 255, 0.32)',
        atmo: hsl(200, 90, 70),
        dot: hsl(h, 70, 55),
      };
    }
    case 'ice': {
      const h = 192 + j(20);
      return {
        base: hsl(h, 40, 80),
        mottle: [hsl(h, 50, 92, 0.3), hsl(h + 15, 45, 66, 0.22)],
        crack: hsl(h + 10, 55, 48, 0.6),
        frost: 'rgba(255, 255, 255, 0.35)',
        atmo: hsl(h, 70, 85),
        dot: hsl(h, 50, 85),
      };
    }
    case 'lava': {
      return {
        base: hsl(12, 30, 13),
        mottle: [hsl(20, 25, 22, 0.35), hsl(5, 30, 6, 0.4)],
        crack: 'rgba(255, 150, 50, 0.95)',
        glow: 'rgba(255, 80, 20, 0.3)',
        atmo: 'hsl(20, 100%, 55%)',
        dot: 'hsl(15, 90%, 45%)',
      };
    }
    case 'rocky':
    default: {
      const h = [30, 15, 45, 0][Math.floor(rand() * 4)] + j(10);
      const s = 8 + rand() * 18;
      return {
        base: hsl(h, s, 46),
        mottle: [hsl(h, s, 56, 0.22), hsl(h, s + 4, 34, 0.24)],
        mare: 'rgba(0, 0, 0, 0.12)',
        rim: 'rgba(255, 250, 235, 0.32)',
        dot: hsl(h, s, 60),
      };
    }
  }
}

// Role along the chain: the centre is a star, the first joint a planet circling it, the next
// joints its moons, and the deep, tiny joints near the pen are asteroids.
const roleOf = (index) => (index === 0 ? 'star' : index === 1 ? 'planet' : index < MAX_BODIES ? 'moon' : 'asteroid');

function pickType(role, rand) {
  const r = rand();
  if (role === 'star') return 'star';
  if (role === 'planet') return r < 0.38 ? 'gas' : r < 0.6 ? 'ringed' : r < 0.72 ? 'ice' : r < 0.86 ? 'ocean' : r < 0.94 ? 'rocky' : 'lava';
  if (role === 'moon') return r < 0.4 ? 'rocky' : r < 0.72 ? 'ice' : r < 0.86 ? 'lava' : 'ocean';
  return r < 0.8 ? 'rocky' : 'ice';
}

const between = (rand, lo, hi) => lo + rand() * (hi - lo);

// Real radii in km, after bodies in our own solar system.
function radiusKm(role, type, rand) {
  if (role === 'star') return 696000 * between(rand, 0.75, 1.35);
  if (role === 'asteroid') return Math.exp(between(rand, Math.log(2), Math.log(300)));
  if (role === 'planet') {
    return {
      gas: between(rand, 58000, 72000), // Saturn … Jupiter
      ringed: between(rand, 54000, 60500),
      ice: between(rand, 24000, 25600), // Uranus, Neptune
      ocean: between(rand, 6000, 7200), // Earth-ish
      rocky: between(rand, 2440, 6400), // Mercury … Earth
      lava: between(rand, 4500, 6500),
    }[type];
  }
  return { rocky: between(rand, 200, 1800), ice: between(rand, 500, 2630), lava: between(rand, 1700, 1900), ocean: between(rand, 1500, 2600) }[type];
}

const MOON_LABELS = { rocky: 'Rocky moon', ice: 'Icy moon', lava: 'Volcanic moon', ocean: 'Ocean moon' };

function labelFor(role, type) {
  if (role === 'asteroid') return type === 'ice' ? 'Icy asteroid' : 'Asteroid';
  if (role === 'moon') return MOON_LABELS[type];
  if (role === 'planet' && type === 'ice') return 'Ice giant';
  return LABELS[type];
}

const cache = new Map();

export function describeBody(index) {
  let body = cache.get(index);
  if (body) return body;
  const seed = hash(index, 9173);
  const rand = prng(seed);
  const role = roleOf(index);
  const type = pickType(role, rand);
  const name = index === 0 ? 'Helion' : `${SYL_A[Math.floor(rand() * SYL_A.length)]}${SYL_B[Math.floor(rand() * SYL_B.length)]}`;
  body = {
    index,
    seed,
    role,
    type,
    label: labelFor(role, type),
    name,
    pal: palette(type, rand),
    tilt: (rand() - 0.5) * 0.9,
    km: radiusKm(role, type, rand),
  };
  cache.set(index, body);
  return body;
}

// The planet at the tip of the chain: the one that actually draws the shape.
export const PEN_BODY = (() => {
  const seed = hash(424242, 7);
  const rand = prng(seed);
  return { index: 'pen', seed, role: 'pen', type: 'ocean', label: 'Drawing planet', name: 'Orbis', pal: palette('ocean', rand), tilt: 0, km: 6371 };
})();

// Point marker for a body whose real disc is too small to see (planetarium style).
export function drawMarker(ctx, b, x, y, size) {
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 3.2);
  halo.addColorStop(0, b.pal.dot);
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, size * 3.2, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = b.pal.dot;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, TAU);
  ctx.fill();
}

// ── geometry helpers ─────────────────────────────────────────────────────────

// Angular span of the screen as seen from a far-away centre (used for huge discs and orbits).
export function screenArcSpan(x, y, w, h) {
  const mid = Math.atan2(h / 2 - y, w / 2 - x);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    const a = Math.atan2(cy - y, cx - x) - mid;
    const d = Math.atan2(Math.sin(a), Math.cos(a));
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [mid + lo - 0.02, mid + hi + 0.02];
}

// Clips to the body's disc. Returns false when the disc misses the screen. Discs far larger
// than the screen are clipped with a pie slice, keeping canvas coordinates small and exact.
function clipDisc(ctx, x, y, r, w, h) {
  const nx = Math.max(-x, 0, x - w);
  const ny = Math.max(-y, 0, y - h);
  if (Math.hypot(nx, ny) > r) return false;
  const fx = Math.max(Math.abs(x), Math.abs(x - w));
  const fy = Math.max(Math.abs(y), Math.abs(y - h));
  if (Math.hypot(fx, fy) < r) return true; // the whole screen is inside: nothing to clip
  ctx.beginPath();
  if (r < 3 * Math.max(w, h)) {
    ctx.arc(x, y, r, 0, TAU);
  } else {
    const [lo, hi] = screenArcSpan(x, y, w, h);
    for (let i = 0; i <= 96; i++) {
      const a = lo + ((hi - lo) * i) / 96;
      ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.lineTo(x, y);
    ctx.closePath();
  }
  ctx.clip();
  return true;
}

// ── surface painters (local coords: the disc is the unit circle) ─────────────

const P = {
  rocky: {
    cell(ctx, b, rand, L, cu, cv, cell, x, y, r, la) {
      if (L <= 1 && rand() < 0.4) {
        ctx.fillStyle = b.pal.mare;
        ctx.beginPath();
        ctx.arc(x + cu * r, y + cv * r, cell * 0.6 * r, 0, TAU);
        ctx.fill();
      }
      const count = rand() < 0.8 ? 1 + Math.floor(rand() * 2) : 0;
      const lx = Math.cos(la);
      const ly = Math.sin(la);
      for (let k = 0; k < count; k++) {
        const fx = cu + (rand() - 0.5) * cell;
        const fy = cv + (rand() - 0.5) * cell;
        const fr = cell * (0.08 + rand() * 0.28) * r;
        const sx = x + fx * r;
        const sy = y + fy * r;
        const depth = 0.35 + rand() * 0.3;
        // Bowl: the wall facing the star is in shadow, the far wall catches the light.
        const bowl = ctx.createLinearGradient(sx + lx * fr, sy + ly * fr, sx - lx * fr, sy - ly * fr);
        bowl.addColorStop(0, `rgba(0, 0, 0, ${depth})`);
        bowl.addColorStop(0.55, `rgba(0, 0, 0, ${depth * 0.25})`);
        bowl.addColorStop(1, `rgba(255, 245, 225, ${depth * 0.35})`);
        ctx.fillStyle = bowl;
        ctx.beginPath();
        ctx.arc(sx, sy, fr, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = b.pal.rim;
        ctx.lineWidth = Math.max(0.5, Math.min(fr * 0.07, 3));
        ctx.beginPath();
        ctx.arc(sx, sy, fr * 1.03, la - 1.2, la + 1.2);
        ctx.stroke();
      }
    },
  },

  ocean: {
    cell(ctx, b, rand, L, cu, cv, cell, x, y, r) {
      if (L <= 3 && rand() < (L === 0 ? 0.55 : 0.42)) {
        ctx.fillStyle = b.pal.land[Math.floor(rand() * b.pal.land.length)];
        const blobs = 2 + Math.floor(rand() * 3);
        ctx.beginPath();
        for (let k = 0; k < blobs; k++) {
          const bx = x + (cu + (rand() - 0.5) * cell * 0.8) * r;
          const by = y + (cv + (rand() - 0.5) * cell * 0.8) * r;
          const br = cell * (0.18 + rand() * 0.38) * r;
          ctx.moveTo(bx + br, by);
          ctx.arc(bx, by, br, 0, TAU);
        }
        ctx.fill();
      }
      if (L >= 2 && rand() < 0.3) {
        ctx.fillStyle = b.pal.land[2];
        ctx.beginPath();
        ctx.arc(x + (cu + (rand() - 0.5) * cell) * r, y + (cv + (rand() - 0.5) * cell) * r, cell * (0.06 + rand() * 0.14) * r, 0, TAU);
        ctx.fill();
      }
      if (rand() < 0.3) {
        ctx.fillStyle = b.pal.cloud;
        ctx.beginPath();
        ctx.ellipse(x + cu * r, y + cv * r, cell * 0.6 * r, cell * 0.14 * r, (rand() - 0.5) * 0.6, 0, TAU);
        ctx.fill();
      }
    },
  },

  gas: {
    // Bands at every scale: each level splits the latitude into twice as many stripes.
    level(ctx, b, L, x, y, r, w, h, v0, v1) {
      const rows = 6 << L;
      const cell = 2 / rows;
      if (cell * r < 3) return false;
      const j0 = Math.max(0, Math.floor((v0 + 1) / cell));
      const j1 = Math.min(rows - 1, Math.floor((v1 + 1) / cell));
      if (j1 - j0 > 600) return true;
      const left = Math.max(0, x - r);
      const right = Math.min(w, x + r);
      for (let j = j0; j <= j1; j++) {
        const t = prng(hash(b.seed, 77, L, j))() * 2 - 1;
        if (Math.abs(t) < 0.22) continue;
        ctx.globalAlpha = Math.abs(t) * (L === 0 ? 0.55 : 0.24);
        ctx.fillStyle = t > 0 ? b.pal.light : b.pal.dark;
        ctx.fillRect(left, y + (-1 + j * cell) * r, right - left, cell * r + 0.5);
      }
      ctx.globalAlpha = 1;
      return true;
    },
    cell(ctx, b, rand, L, cu, cv, cell, x, y, r) {
      if (L >= 1 && rand() < 0.05) {
        // Storm: soft nested ovals, darkest in the eye.
        [
          [0.55, 0.26, b.pal.storm, 0.22],
          [0.4, 0.18, b.pal.storm, 0.3],
          [0.24, 0.1, b.pal.dark, 0.35],
          [0.1, 0.045, b.pal.light, 0.4],
        ].forEach(([rx, ry, color, alpha]) => {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(x + cu * r, y + cv * r, cell * rx * r, cell * ry * r, 0, 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
      if (L >= 1 && rand() < 0.3) {
        ctx.fillStyle = rand() < 0.5 ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.09)';
        ctx.beginPath();
        ctx.ellipse(x + (cu + (rand() - 0.5) * cell) * r, y + cv * r, cell * 0.5 * r, cell * 0.05 * r, 0, 0, TAU);
        ctx.fill();
      }
    },
  },

  ice: {
    cell(ctx, b, rand, L, cu, cv, cell, x, y, r) {
      if (rand() < 0.6) {
        ctx.strokeStyle = b.pal.crack;
        ctx.lineWidth = Math.max(0.5, Math.min(cell * r * 0.02, 2.5));
        ctx.beginPath();
        let px = cu + (rand() - 0.5) * cell;
        let py = cv + (rand() - 0.5) * cell;
        ctx.moveTo(x + px * r, y + py * r);
        for (let k = 0; k < 3; k++) {
          px += (rand() - 0.5) * cell * 0.7;
          py += (rand() - 0.5) * cell * 0.7;
          ctx.lineTo(x + px * r, y + py * r);
        }
        ctx.stroke();
      }
      if (rand() < 0.25) {
        ctx.fillStyle = b.pal.frost;
        ctx.beginPath();
        ctx.arc(x + cu * r, y + cv * r, cell * 0.25 * r, 0, TAU);
        ctx.fill();
      }
    },
  },

  lava: {
    cell(ctx, b, rand, L, cu, cv, cell, x, y, r) {
      if (rand() < 0.7) {
        const pts = [];
        let px = cu + (rand() - 0.5) * cell;
        let py = cv + (rand() - 0.5) * cell;
        pts.push([px, py]);
        for (let k = 0; k < 3; k++) {
          px += (rand() - 0.5) * cell * 0.8;
          py += (rand() - 0.5) * cell * 0.8;
          pts.push([px, py]);
        }
        // Rifts stay thin however close you get; big ones just get longer.
        const width = Math.max(0.6, Math.min(cell * r * 0.02, 2.6));
        for (const [stroke, lw, comp] of [
          [b.pal.glow, width * 4, 'lighter'],
          [b.pal.crack, width, 'lighter'],
        ]) {
          ctx.globalCompositeOperation = comp;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lw;
          ctx.beginPath();
          pts.forEach(([u, v], i) => (i ? ctx.lineTo(x + u * r, y + v * r) : ctx.moveTo(x + u * r, y + v * r)));
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  },

  star: {
    // Convection granules: bright cell tops with darker lanes between them, at every scale.
    cell(ctx, b, rand, L, cu, cv, cell, x, y, r) {
      for (let k = 0; k < 3; k++) {
        const gx = x + (cu + (rand() - 0.5) * cell) * r;
        const gy = y + (cv + (rand() - 0.5) * cell) * r;
        const gr = cell * (0.14 + rand() * 0.18) * r;
        const bright = rand() < 0.62;
        ctx.fillStyle = bright ? 'rgba(255, 244, 185, 0.2)' : 'rgba(240, 110, 25, 0.1)';
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, TAU);
        ctx.fill();
      }
      if (L >= 1 && L <= 4 && rand() < 0.04) {
        const sx = x + cu * r;
        const sy = y + cv * r;
        ctx.fillStyle = 'rgba(150, 60, 10, 0.4)';
        ctx.beginPath();
        ctx.arc(sx, sy, cell * 0.36 * r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(70, 20, 0, 0.6)';
        ctx.beginPath();
        ctx.arc(sx, sy, cell * 0.18 * r, 0, TAU);
        ctx.fill();
      }
    },
  },
};
P.ringed = P.gas;

function surface(ctx, b, x, y, r, w, h, la) {
  const u0 = Math.max(-1, -x / r);
  const u1 = Math.min(1, (w - x) / r);
  const v0 = Math.max(-1, -y / r);
  const v1 = Math.min(1, (h - y) / r);
  if (u0 >= u1 || v0 >= v1) return;
  const painter = P[b.type];
  for (let L = 0; L < 26; L++) {
    painter.level?.(ctx, b, L, x, y, r, w, h, v0, v1);
    const n = 4 * 2 ** L;
    const cell = 2 / n;
    const px = cell * r;
    if (px < (L === 0 ? 5 : 38)) break;
    const i0 = Math.max(0, Math.floor((u0 + 1) / cell));
    const i1 = Math.min(n - 1, Math.floor((u1 + 1) / cell));
    const j0 = Math.max(0, Math.floor((v0 + 1) / cell));
    const j1 = Math.min(n - 1, Math.floor((v1 + 1) / cell));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 1600) continue;
    const reach = (1 + cell) ** 2;
    for (let j = j0; j <= j1; j++) {
      const cv = -1 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const cu = -1 + (i + 0.5) * cell;
        if (cu * cu + cv * cv > reach) continue;
        const rand = prng(hash(b.seed, L, i, j));
        if (b.pal.mottle) {
          // Soft light/dark blotches at every scale: a cheap fractal texture under the features.
          ctx.fillStyle = b.pal.mottle[rand() < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(x + (cu + (rand() - 0.5) * cell * 0.6) * r, y + (cv + (rand() - 0.5) * cell * 0.6) * r, cell * (0.45 + rand() * 0.4) * r, 0, TAU);
          ctx.fill();
        }
        painter.cell(ctx, b, rand, L, cu, cv, cell, x, y, r, la);
      }
    }
  }
}

function rings(ctx, b, x, y, r, back) {
  const [a0, a1] = back ? [Math.PI, TAU] : [0, Math.PI];
  b.pal.ring.forEach((color, i) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = r * (0.2 - i * 0.05);
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1.75 + i * 0.28), r * (0.42 + i * 0.07), b.tilt, a0, a1);
    ctx.stroke();
  });
}

// Draws one body at screen (x, y) with screen radius r, lit from direction (lx, ly).
export function drawBody(ctx, b, x, y, r, lx, ly, w, h, time) {
  const star = b.type === 'star';
  const reach = star ? Math.max(r * 3.2, 40) : b.type === 'ringed' ? r * 2.4 : r * 1.25;
  if (x + reach < 0 || x - reach > w || y + reach < 0 || y - reach > h) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (star && r < 3 * Math.max(w, h)) drawGlare(ctx, x, y, r, time);
  if (r < 1.6) {
    ctx.fillStyle = star ? '#fffbe8' : b.pal.dot;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(star ? 1.8 : 0.8, r), 0, TAU);
    ctx.fill();
    return;
  }
  const big = r > 3 * Math.max(w, h);
  if (star) return drawStar(ctx, b, x, y, r, w, h, time);

  if (b.type === 'ringed' && !big) rings(ctx, b, x, y, r, true);
  ctx.save();
  if (clipDisc(ctx, x, y, r, w, h)) {
    const left = Math.max(0, x - r);
    const top = Math.max(0, y - r);
    const right = Math.min(w, x + r);
    const bottom = Math.min(h, y + r);
    ctx.fillStyle = b.pal.base;
    ctx.fillRect(left, top, right - left, bottom - top);
    surface(ctx, b, x, y, r, w, h, Math.atan2(ly, lx));
    // Day / night: lit from the star, with a soft terminator.
    const shade = ctx.createRadialGradient(x + lx * r * 0.55, y + ly * r * 0.55, r * 0.1, x + lx * r * 0.2, y + ly * r * 0.2, r * 1.35);
    shade.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    shade.addColorStop(0.34, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(0.6, 'rgba(3, 2, 14, 0.72)');
    shade.addColorStop(0.82, 'rgba(3, 2, 14, 0.95)');
    ctx.fillStyle = shade;
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  ctx.restore();

  if (!big && b.type !== 'rocky' && b.type !== 'lava') {
    const glow = ctx.createRadialGradient(x, y, r * 0.95, x, y, r * 1.2);
    glow.addColorStop(0, b.pal.atmo);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  if (b.type === 'ringed' && !big) rings(ctx, b, x, y, r, false);
}

// Corona plus a screen-space glare, the way a star photographs: it reads as a star even when
// its true disc is a fraction of a pixel.
function drawGlare(ctx, x, y, r, time) {
  const pulse = 1 + Math.sin(time * 1.7) * 0.04;
  const reach = Math.max(r * 3.2, 38) * pulse;
  const inner = Math.min(r * 0.85, reach * 0.3);
  const corona = ctx.createRadialGradient(x, y, inner, x, y, reach);
  corona.addColorStop(0, 'rgba(255, 210, 110, 0.55)');
  corona.addColorStop(0.3, 'rgba(255, 140, 50, 0.16)');
  corona.addColorStop(1, 'rgba(255, 90, 30, 0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, TAU);
  ctx.fill();
  if (r < 12) {
    // diffraction spikes for a point-like star
    ctx.strokeStyle = 'rgba(255, 236, 190, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - reach * 0.8, y);
    ctx.lineTo(x + reach * 0.8, y);
    ctx.moveTo(x, y - reach * 0.8);
    ctx.lineTo(x, y + reach * 0.8);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawStar(ctx, b, x, y, r, w, h, time) {
  ctx.save();
  if (clipDisc(ctx, x, y, r, w, h)) {
    const left = Math.max(0, x - r);
    const top = Math.max(0, y - r);
    const right = Math.min(w, x + r);
    const bottom = Math.min(h, y + r);
    const body = ctx.createRadialGradient(x - r * 0.15, y - r * 0.15, 0, x, y, r);
    body.addColorStop(0, '#fffbe8');
    body.addColorStop(0.55, '#ffd36b');
    body.addColorStop(0.9, '#ff9a3c');
    body.addColorStop(1, '#e8622a');
    ctx.fillStyle = body;
    ctx.fillRect(left, top, right - left, bottom - top);
    surface(ctx, b, x, y, r, w, h, 0);
  }
  ctx.restore();
}
