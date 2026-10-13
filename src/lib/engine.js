// Imperative canvas renderer for the epicycle machine. React only feeds it data and settings;
// everything per-frame happens here so the animation never waits on a re-render.
//
// Coordinates: the curve, the chain of circles, particles and rings all live in "world" units
// (the SVG's own units). A camera (zoom + world-space centre, optionally glued to the pen)
// maps world → screen each frame.
import { curveResolution, traceCurve } from './fourier.js';
import { MAX_BODIES, PEN_BODY, describeBody, drawBody, drawMarker, hash, screenArcSpan } from './cosmos.js';

const TAU = Math.PI * 2;
const HOLD = 0.65; // seconds the finished stage lingers before more circles join in
const LOOP = 7.5; // seconds per lap once locked / in explorer mode
const MAX_GHOSTS = 3;
const MAX_PARTICLES = 700;
const CHUNK = 48; // trail points per stroke (lets the trail shift hue and be culled off-screen)
const SLOWMO = 0.1;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1e9;
const AU_KM = 149.6e6; // realistic scale: the first orbit is one astronomical unit
const TRAIL_PASSES = [
  [12, 0.045, 60],
  [5, 0.14, 64],
  [2, 0.95, 80],
];
const CIRCLE_TIERS = [
  [0, 2, 0.55, 1.4],
  [2, 8, 0.36, 1.1],
  [8, 32, 0.22, 1],
  [32, Infinity, 0.12, 0.8],
];

// Early, blobby stages fly by; the detailed final ones get more time.
const stageDuration = (i, n) => 2.1 + 1.9 * (n > 1 ? i / (n - 1) : 1);
const wrap = (i, n) => ((i % n) + n) % n;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpLog = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));
const smoothstep = (t) => t * t * (3 - 2 * t);

function lapLength(xs, ys, M) {
  let len = 0;
  for (let i = 1; i <= M; i++) len += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  return len || 1;
}

function worldPath(xs, ys, count, close) {
  const p = new Path2D();
  p.moveTo(xs[0], ys[0]);
  for (let i = 1; i < count; i++) p.lineTo(xs[i], ys[i]);
  if (close) p.closePath();
  return p;
}

export class EpicycleEngine {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.opts = { speed: 1, circles: true, target: true, ghosts: true, heat: false, style: 'cosmic', scale: 'real' };
    this.followIndex = null; // chain index the camera follows; null = the pen
    this.playing = true;
    this.recording = false;
    this.slowmo = false;
    this.speedNow = 1;
    this.slowFx = 0;
    this.an = null;
    this.stages = [];
    this.stageIdx = 0;
    this.phase = 'idle';
    this.t = 0;
    this.hold = 0;
    this.manualK = null;
    this.curve = null;
    this.ghosts = [];
    this.particles = [];
    this.rings = [];
    this.flash = 0;
    this.time = 0;
    this.spawnDebt = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.bg = document.createElement('canvas');

    // Camera: `cam` eases towards `goal`; `follow` blends the centre onto the pen tip.
    this.fit = { s: 1, x: 0, y: 0 };
    this.fitGoal = { s: 1, shift: 0 };
    this.insets = { top: 0, bottom: 0 };
    this.shift = 0;
    this.cam = { x: 0, y: 0, z: 1 };
    this.goal = { x: 0, y: 0, z: 1 };
    this.eff = { x: 0, y: 0, z: 1 };
    this.follow = false;
    this.followMix = 0;
    this.followZoom = 6;
    this.followZoomGoal = 6;
    this.view = { s: 1, ox: 0, oy: 0 };
    this.viewVersion = 0;
    this.camSig = '';

    this.chainWX = new Float64Array(2);
    this.chainWY = new Float64Array(2);
    this.chainX = new Float64Array(2);
    this.chainY = new Float64Array(2);
    this.tipW = { x: 0, y: 0 };
    this.prevTipW = null;

    this.pointers = new Map();
    this.pinch = null;
    this.bindInput();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unbindInput();
  }

  // ── commands ────────────────────────────────────────────────────────────────

  load(an, stages) {
    const fresh = an !== this.an;
    this.an = an;
    this.stages = stages;
    if (fresh) {
      this.targetW = worldPath(an.samples.xs, an.samples.ys, an.N, true);
      this.fitView(true);
      this.cam = { x: this.fit.x, y: this.fit.y, z: 1 };
      this.goal = { ...this.cam };
    }
    this.restart();
  }

  // Live edit (equation playground): swap in the new series with every circle already in play,
  // keeping the pen's position in the lap and easing the view over instead of restarting.
  morph(an, stages) {
    this.an = an;
    this.stages = stages;
    this.targetW = worldPath(an.samples.xs, an.samples.ys, an.N, true);
    this.fitView();
    if (!this.follow && Math.abs(this.goal.z - 1) < 1e-3) {
      this.goal.x = this.fit.x;
      this.goal.y = this.fit.y;
    }
    this.manualK = null;
    this.ghosts = [];
    this.stageIdx = stages.length - 1;
    this.phase = 'done';
    this.t %= 1;
    this.buildCurve();
    this.emit();
  }

  setOptions(opts) {
    Object.assign(this.opts, opts);
  }

  setPlaying(playing) {
    this.playing = playing;
    this.emit();
  }

  setSlowmo(on) {
    this.slowmo = on;
  }

  // While recording, the HTML HUD isn't captured, so the canvas draws its own caption.
  setRecording(on) {
    this.recording = on;
  }

  restart() {
    if (!this.an) return;
    this.manualK = null;
    this.stageIdx = 0;
    this.ghosts = [];
    this.particles = [];
    this.rings = [];
    this.startStage();
  }

  skipToEnd() {
    if (!this.an) return;
    this.manualK = null;
    this.ghosts = [];
    this.stageIdx = this.stages.length - 1;
    this.startStage();
  }

  setManual(k) {
    if (!this.an) return;
    this.manualK = clamp(Math.round(k), 1, this.an.count);
    this.phase = 'manual';
    this.ghosts = [];
    this.buildCurve();
    this.emit();
  }

  // Jump to a point of the current lap (u in [0, 1]).
  scrub(u) {
    if (!this.curve) return;
    if (this.phase === 'done' || this.phase === 'manual') this.t = wrap(u, 1);
    else {
      this.phase = 'drawing';
      this.t = clamp(u, 0, 0.9999);
    }
    this.emit();
  }

  step(dir) {
    this.scrub((this.phase === 'hold' ? 1 : this.t) + dir * 0.004);
  }

  // ── camera commands ─────────────────────────────────────────────────────────

  zoomBy(f) {
    this.zoomAt(f, this.w / 2, this.h / 2);
  }

  // Zoom by `f`, keeping the world point under screen position (sx, sy) where it is.
  zoomAt(f, sx, sy, immediate = false) {
    if (this.follow) {
      this.followZoomGoal = clamp(this.followZoomGoal * f, 1.5, MAX_ZOOM);
      return;
    }
    const g = this.goal;
    const k0 = this.fit.s * g.z;
    const z = clamp(g.z * f, MIN_ZOOM, MAX_ZOOM);
    const k1 = this.fit.s * z;
    const dx = sx - this.w / 2;
    const dy = sy - (this.h / 2 + this.shift);
    g.x += dx / k0 - dx / k1;
    g.y += dy / k0 - dy / k1;
    g.z = z;
    if (immediate) Object.assign(this.cam, g);
  }

  panBy(dx, dy) {
    this.unfollow();
    const k = this.fit.s * this.cam.z;
    this.cam.x -= dx / k;
    this.cam.y -= dy / k;
    this.goal.x = this.cam.x;
    this.goal.y = this.cam.y;
  }

  resetView() {
    this.unfollow();
    Object.assign(this.goal, { x: this.fit.x, y: this.fit.y, z: 1 });
  }

  setFollow(on) {
    if (on) {
      if (this.followIndex != null) this.unfollow();
      this.follow = true;
    } else this.unfollow();
    this.emitCamera();
  }

  toggleFollow() {
    this.setFollow(!(this.follow && this.followIndex == null));
  }

  // Fly to a planet (chain index j) and keep it centred, close enough to see its surface.
  focusBody(j) {
    const K = this.curve.K;
    this.unfollow();
    this.follow = true;
    this.followIndex = j >= K ? null : j; // the tip is the drawing planet: follow the pen
    const r = this.bodyRadius(j, K) * this.fit.s;
    this.followZoomGoal = clamp((0.2 * Math.min(this.w, this.h)) / Math.max(r, 1e-15), 1.5, MAX_ZOOM);
    this.emitCamera();
  }

  // Leave follow mode without a jump: freeze the free camera where the view is right now.
  unfollow() {
    if (!this.follow && this.followMix === 0) return;
    Object.assign(this.cam, this.eff);
    Object.assign(this.goal, this.eff);
    this.follow = false;
    this.followIndex = null;
    this.followMix = 0;
  }

  body(j, K) {
    return j >= K ? PEN_BODY : describeBody(j);
  }

  // World radius of the body on chain point j (0 = the star, K = the drawing planet).
  // Realistic: true radii in km, with the first orbit taken as 1 AU. Enlarged: sized from the
  // orbits so every world is visible. Either way a body stays clear of its parent and inside
  // its own moon's orbit.
  bodyRadius(j, K) {
    const a = this.an.amp;
    if (this.opts.scale === 'real') {
      const unitKm = AU_KM / a[0];
      const r = this.body(j, K).km / unitKm;
      if (j === 0) return Math.min(r, 0.5 * a[0]);
      const roomOut = j < K ? 0.35 * a[j] : Infinity;
      return Math.min(r, 0.3 * a[j - 1], roomOut);
    }
    if (j === 0) return 0.16 * a[0];
    if (j >= K) return 0.04 * a[0]; // the drawing planet stays a visible world
    return 0.36 * Math.min(a[j], 0.6 * a[j - 1]);
  }

  // Is body j drawn (as a disc or a marker)? Markers only show once their orbit is resolvable.
  bodyShown(j, K, s) {
    if (j === 0 || j >= K) return true;
    return this.bodyRadius(j, K) * s >= 1.6 || this.an.amp[j - 1] * s >= (j < MAX_BODIES ? 4 : 9);
  }

  // Chain index of the body under a screen point (K = the drawing planet), or null.
  // A visible disc you click inside wins (the smallest one, for a moon in front of a planet);
  // otherwise the nearest marker within reach, with the drawing planet given a head start.
  bodyAt(px, py) {
    if (this.opts.style !== 'cosmic' || !this.opts.circles || !this.curve) return null;
    const K = this.curve.K;
    const s = this.view.s;
    let inside = null;
    let insideR = Infinity;
    let near = null;
    let nearD = 14;
    for (let j = 0; j <= K; j++) {
      if (!this.bodyShown(j, K, s)) continue;
      const r = this.bodyRadius(j, K) * s;
      const d = Math.hypot(px - this.chainX[j], py - this.chainY[j]);
      if (r >= 6 && d <= r && r < insideR) {
        inside = j;
        insideR = r;
      }
      const score = d - Math.max(r, 0) - (j === K ? 8 : 0);
      if (score < nearD) {
        near = j;
        nearD = score;
      }
    }
    return inside ?? near;
  }

  // ── run state ───────────────────────────────────────────────────────────────

  get k() {
    return this.manualK ?? this.stages[this.stageIdx]?.k ?? 1;
  }

  emit() {
    this.hooks.onState?.({
      stageIdx: this.stageIdx,
      phase: this.phase,
      k: this.curve?.K ?? this.k,
      playing: this.playing,
    });
  }

  emitCamera() {
    const j = this.follow ? this.followIndex : null;
    const cosmic = this.opts.style === 'cosmic';
    const sig = `${Math.round(Math.log(this.eff.z) * 40)}|${this.follow}|${j}|${cosmic}|${this.opts.scale}`;
    if (sig === this.camSig) return;
    this.camSig = sig;
    // Following the pen in the cosmic look means riding along with the drawing planet.
    const body = j != null ? describeBody(j) : this.follow && cosmic ? PEN_BODY : null;
    this.hooks.onCamera?.({
      zoom: this.eff.z,
      follow: this.follow,
      focus: body && {
        name: body.name,
        label: body.label,
        km: this.opts.scale === 'real' ? body.km : null,
        pen: body === PEN_BODY,
      },
    });
  }

  startStage() {
    this.phase = 'drawing';
    this.t = 0;
    this.buildCurve();
    this.emit();
  }

  completeStage() {
    const { wx, wy, M } = this.curve;
    const x = wx[M];
    const y = wy[M];
    if (this.stageIdx >= this.stages.length - 1) {
      this.phase = 'done';
      this.t = 0;
      this.celebrate(x, y);
    } else {
      this.phase = 'hold';
      this.t = 1;
      this.hold = HOLD;
      this.rings.push({ x, y, age: 0, max: 0.9, maxR: 90, hue: this.hue(1) });
      this.burst(x, y, 36, 40, 160, 0.5, 1.1, this.hue(1));
    }
    this.emit();
  }

  nextStage() {
    const c = this.curve;
    c.pathW ??= worldPath(c.wx, c.wy, c.M + 1, false);
    this.ghosts.push(c);
    if (this.ghosts.length > MAX_GHOSTS) this.ghosts.shift();
    this.stageIdx++;
    this.startStage();
  }

  celebrate(x, y) {
    this.flash = 1;
    [0, 0.12, 0.26].forEach((delay, i) => {
      this.rings.push({ x, y, age: 0, delay, max: 1.3, maxR: 140 + i * 110, hue: 100 + i * 50 });
    });
    this.burst(x, y, 200, 60, 340, 0.8, 2, 120);
    this.burst(this.eff.x, this.eff.y, 80, 30, 220, 0.8, 1.8, 190);
  }

  // Curve resolution grows with zoom so deep zooms still look smooth.
  resolution(K, zoom) {
    return Math.min(16384, curveResolution(this.an, K) * clamp(Math.ceil(zoom / 2.5), 1, 6));
  }

  zoomGoal() {
    return this.follow ? this.followZoomGoal : this.goal.z;
  }

  buildCurve(M) {
    const K = this.k;
    M ??= this.resolution(K, this.zoomGoal());
    const { xs, ys } = traceCurve(this.an, K, M);
    this.curve = {
      id: (this.curve?.id ?? 0) + 1,
      K,
      M,
      wx: xs,
      wy: ys,
      sx: new Float64Array(M + 1),
      sy: new Float64Array(M + 1),
      boxes: new Float64Array((Math.ceil(M / CHUNK) + 1) * 4),
      heat: this.chunkErrors(xs, ys, M),
      lapLength: lapLength(xs, ys, M),
      projected: -1,
      pathW: null,
    };
    if (this.chainX.length < K + 1) {
      this.chainWX = new Float64Array(K + 1);
      this.chainWY = new Float64Array(K + 1);
      this.chainX = new Float64Array(K + 1);
      this.chainY = new Float64Array(K + 1);
    }
  }

  // Worst miss per trail chunk (vs. the target at the same t), as a fraction of the shape radius.
  chunkErrors(xs, ys, M) {
    const { N, radius, samples } = this.an;
    const heat = new Float64Array(Math.ceil(M / CHUNK) + 1);
    const r = radius || 1;
    for (let i = 0; i <= M; i++) {
      const j = Math.round((i * N) / M) % N;
      const e = Math.hypot(xs[i] - samples.xs[j], ys[i] - samples.ys[j]) / r;
      const c = Math.floor(i / CHUNK);
      if (e > heat[c]) heat[c] = e;
    }
    return heat;
  }

  ensureResolution() {
    const c = this.curve;
    const z = this.zoomGoal();
    if (Math.abs(this.eff.z - z) > z * 0.03) return; // wait for the zoom to settle
    const want = this.resolution(c.K, z);
    if (want > c.M * 1.3 || want < c.M / 1.8) this.buildCurve(want);
  }

  // ── geometry ────────────────────────────────────────────────────────────────

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.paintBackground();
    if (this.an) this.fitView(true);
  }

  // Screen space covered by overlays (fullscreen equation on top, dock at the bottom):
  // the shape is fitted into what's left, easing over when it changes.
  setInsets(top, bottom) {
    if (top === this.insets.top && bottom === this.insets.bottom) return;
    this.insets = { top, bottom };
    if (this.an) this.fitView();
  }

  fitView(snap = false) {
    const { minX, minY, maxX, maxY } = this.an.bbox;
    const bw = Math.max(maxX - minX, 1e-9);
    const bh = Math.max(maxY - minY, 1e-9);
    const { top, bottom } = this.insets;
    const free = Math.max(this.h * 0.3, this.h - top - bottom);
    const s = Math.min((this.w * 0.74) / bw, (free * (top || bottom ? 0.9 : 0.74)) / bh);
    this.fitGoal = { s, shift: (top - bottom) / 2 };
    this.fit.x = minX + bw / 2;
    this.fit.y = minY + bh / 2;
    if (snap) {
      this.fit.s = s;
      this.shift = this.fitGoal.shift;
    }
  }

  updateCamera(dt) {
    const a = 1 - Math.exp(-dt * 10);
    const { cam, goal, eff } = this;
    this.fit.s = lerpLog(this.fit.s, this.fitGoal.s, a);
    this.shift = lerp(this.shift, this.fitGoal.shift, a);
    cam.x = lerp(cam.x, goal.x, a);
    cam.y = lerp(cam.y, goal.y, a);
    cam.z = lerpLog(cam.z, goal.z, a);
    // Dives towards a planet ease in log space, so a million-fold zoom still takes about a second.
    this.followZoom = lerpLog(this.followZoom, this.followZoomGoal, 1 - Math.exp(-dt * 3.2));
    if (this.follow) {
      this.followMix = this.followMix > 0.995 ? 1 : lerp(this.followMix, 1, 1 - Math.exp(-dt * 3.5));
    }
    const K = this.curve.K;
    if (this.followIndex != null && this.followIndex >= K) this.followIndex = null;
    const fx = this.followIndex != null ? this.chainWX[this.followIndex] : this.tipW.x;
    const fy = this.followIndex != null ? this.chainWY[this.followIndex] : this.tipW.y;
    const m = smoothstep(this.followMix);
    eff.x = lerp(cam.x, fx, m);
    eff.y = lerp(cam.y, fy, m);
    eff.z = lerpLog(cam.z, this.followZoom, m);

    const s = this.fit.s * eff.z;
    const ox = this.w / 2 - eff.x * s;
    const oy = this.h / 2 + this.shift - eff.y * s;
    const v = this.view;
    if (Math.abs(v.s - s) > s * 1e-9 || Math.abs(v.ox - ox) > 1e-3 || Math.abs(v.oy - oy) > 1e-3) {
      this.view = { s, ox, oy };
      this.viewVersion++;
    }
    this.emitCamera();
  }

  // World → screen for the current curve, plus a bounding box per chunk for culling.
  project(c) {
    const { s, ox, oy } = this.view;
    const { wx, wy, sx, sy, boxes, M } = c;
    for (let i = 0; i <= M; i++) {
      sx[i] = ox + wx[i] * s;
      sy[i] = oy + wy[i] * s;
    }
    for (let start = 0, b = 0; start < M; start += CHUNK, b += 4) {
      const end = Math.min(M, start + CHUNK);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = start; i <= end; i++) {
        if (sx[i] < x0) x0 = sx[i];
        if (sx[i] > x1) x1 = sx[i];
        if (sy[i] < y0) y0 = sy[i];
        if (sy[i] > y1) y1 = sy[i];
      }
      boxes[b] = x0;
      boxes[b + 1] = y0;
      boxes[b + 2] = x1;
      boxes[b + 3] = y1;
    }
    c.projected = this.viewVersion;
  }

  onScreen(boxes, b, pad) {
    return !(boxes[b + 2] < -pad || boxes[b] > this.w + pad || boxes[b + 3] < -pad || boxes[b + 1] > this.h + pad);
  }

  // Draw world-space geometry (Path2D in SVG units) through the camera. `fn` gets the scale
  // so it can keep line widths constant in screen pixels.
  withWorld(fn) {
    const { s, ox, oy } = this.view;
    const d = this.dpr;
    this.ctx.setTransform(d * s, 0, 0, d * s, d * ox, d * oy);
    fn(s);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  hue(u) {
    return 190 + 150 * u + this.time * 5;
  }

  paintBackground() {
    const { w, h, dpr, bg } = this;
    bg.width = Math.round(w * dpr);
    bg.height = Math.round(h * dpr);
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const base = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    base.addColorStop(0, '#181333');
    base.addColorStop(0.55, '#0c0a1a');
    base.addColorStop(1, '#05040c');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    const glow = (x, y, r, color) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    };
    glow(w * 0.18, h * 0.2, w * 0.55, 'rgba(124, 92, 255, 0.14)');
    glow(w * 0.88, h * 0.85, w * 0.5, 'rgba(255, 90, 170, 0.09)');
    glow(w * 0.8, h * 0.12, w * 0.32, 'rgba(70, 220, 255, 0.06)');

    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stars = Math.round((w * h) / 2400);
    for (let i = 0; i < stars; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = rnd() ** 3 * 1.3 + 0.25;
      g.fillStyle = `rgba(222, 216, 255, ${0.12 + rnd() * 0.55})`;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }

    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(w, h) / 2;
    g.lineWidth = 1;
    for (let r = 40, n = 1; r < reach; r += 40, n++) {
      g.strokeStyle = `rgba(160, 150, 255, ${n % 4 === 0 ? 0.075 : 0.035})`;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
    }
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * TAU;
      g.strokeStyle = `rgba(160, 150, 255, ${a % 6 === 0 ? 0.07 : 0.028})`;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * 40, cy + Math.sin(ang) * 40);
      g.lineTo(cx + Math.cos(ang) * reach, cy + Math.sin(ang) * reach);
      g.stroke();
    }
  }

  // ── input: wheel / drag / pinch / double-click ──────────────────────────────

  bindInput() {
    const cv = this.canvas;
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.listeners = {
      wheel: (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0018;
        const p = local(e);
        this.zoomAt(Math.exp(-e.deltaY * unit), p.x, p.y);
      },
      pointerdown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        cv.setPointerCapture(e.pointerId);
        const p = local(e);
        this.pointers.set(e.pointerId, p);
        this.pinch = null;
        // A press that never travels more than a few pixels is a click (fly to a planet).
        this.press = this.pointers.size === 1 ? { ...p, moved: 0 } : null;
        cv.classList.add('grabbing');
      },
      pointermove: (e) => {
        const prev = this.pointers.get(e.pointerId);
        if (!prev) return;
        const p = local(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 1) {
          if (this.press) {
            this.press.moved += Math.hypot(p.x - prev.x, p.y - prev.y);
            if (this.press.moved < 5) return;
          }
          this.panBy(p.x - prev.x, p.y - prev.y);
        } else if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          if (this.pinch) {
            this.zoomAt(d / this.pinch.d, mx, my, true);
            this.panBy(mx - this.pinch.mx, my - this.pinch.my);
          }
          this.pinch = { d, mx, my };
        }
      },
      pointerup: (e) => this.releasePointer(e),
      pointercancel: (e) => this.releasePointer(e),
      dblclick: () => this.resetView(),
    };
    for (const [type, fn] of Object.entries(this.listeners)) {
      cv.addEventListener(type, fn, type === 'wheel' ? { passive: false } : undefined);
    }
  }

  releasePointer(e) {
    const press = this.pointers.size === 1 && e.type === 'pointerup' ? this.press : null;
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    this.press = null;
    if (!this.pointers.size) this.canvas.classList.remove('grabbing');
    if (press && press.moved < 5) {
      const j = this.bodyAt(press.x, press.y);
      if (j != null) this.focusBody(j);
    }
  }

  unbindInput() {
    for (const [type, fn] of Object.entries(this.listeners)) this.canvas.removeEventListener(type, fn);
  }

  // ── frame loop ──────────────────────────────────────────────────────────────

  frame = (now) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.an || !this.curve) return;
    // Speed changes (and slow-mo) ease in rather than snapping.
    const target = this.opts.speed * (this.slowmo ? SLOWMO : 1);
    this.speedNow = lerpLog(this.speedNow, target, 1 - Math.exp(-dt * 5));
    const sim = this.playing ? dt * this.speedNow : 0;
    if (this.playing) this.advance(sim);
    this.render(dt, sim);
  };

  advance(sim) {
    this.time += sim;
    if (this.phase === 'drawing') {
      this.t += sim / stageDuration(this.stageIdx, this.stages.length);
      if (this.t >= 1) this.completeStage();
    } else if (this.phase === 'hold') {
      this.hold -= sim;
      if (this.hold <= 0) this.nextStage();
    } else if (this.phase === 'done' || this.phase === 'manual') {
      this.t = (this.t + sim / LOOP) % 1;
    }
  }

  render(dt, sim) {
    const { ctx, w, h, dpr } = this;
    const T = this.phase === 'hold' ? 1 : this.t;

    this.computeChain(T);
    this.updateCamera(dt);
    this.ensureResolution();
    const c = this.curve;
    if (c.projected !== this.viewVersion) this.project(c);
    const tip = this.projectChain(c.K);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.bg, 0, 0, w, h);
    const cosmic = this.opts.style === 'cosmic';
    if (cosmic) this.drawDust();

    // World-space paths go through the canvas transform (float32 inside the browser), which
    // loses precision at extreme zoom; past that point the outline and ghosts are skipped.
    const worldPathsOk = this.eff.z < 400;
    if (this.opts.target && worldPathsOk) {
      // Dashes are generated along the whole outline, which explodes at deep zoom: go solid there.
      const dashed = this.eff.z < 2.5;
      this.withWorld((s) => {
        if (dashed) {
          ctx.setLineDash([4 / s, 7 / s]);
          ctx.lineDashOffset = (-this.time * 14) / s;
        }
        ctx.strokeStyle = dashed ? 'rgba(225, 220, 255, 0.28)' : 'rgba(225, 220, 255, 0.16)';
        ctx.lineWidth = 1.3 / s;
        ctx.stroke(this.targetW);
        ctx.setLineDash([]);
      });
    }

    ctx.globalCompositeOperation = 'lighter';
    if (this.opts.ghosts && worldPathsOk && this.phase !== 'manual' && this.ghosts.length) {
      this.withWorld((s) => {
        this.ghosts.forEach((g, i) => {
          ctx.lineWidth = 1.4 / s;
          ctx.strokeStyle = `hsla(${255 + i * 18}, 90%, 72%, ${0.06 + (0.07 * (i + 1)) / this.ghosts.length})`;
          ctx.stroke(g.pathW);
        });
      });
    }

    if (this.opts.circles) {
      if (cosmic) this.drawCosmic(c.K);
      else this.drawEpicycles(c.K);
    }

    ctx.globalCompositeOperation = 'lighter';
    const tail = this.refinedTail(c, T);
    const skip = tail && [tail.from, Math.ceil(T * c.M)];
    if (this.phase === 'drawing') {
      this.drawTrail(c, tail ? Math.max(0, tail.from) : Math.floor(T * c.M), tail ? null : tip, 1);
    } else if (this.phase === 'hold') {
      this.drawTrail(c, c.M, null, 1, skip);
    } else {
      this.drawTrail(c, c.M, null, this.phase === 'done' ? 0.8 : 0.6, skip);
      if (!tail) this.drawComet(c, T, tip);
    }
    if (tail) this.drawTail(tail, tip, this.phase === 'drawing' ? 1 : 1.6);

    if (cosmic && this.opts.circles) {
      this.drawPen(tip, 0.45);
      this.drawPenPlanet(tip);
    } else this.drawPen(tip);
    this.drawParticles(sim);
    this.drawFx(sim);
    this.drawSlowmo(dt);
    this.drawMinimap();
    if (this.recording) this.drawCaption();
    this.prevTipW = { ...this.tipW };
    this.hooks.onTick?.(T, this.tipW);
  }

  computeChain(T) {
    const { an, chainWX: X, chainWY: Y } = this;
    const K = this.curve.K;
    let x = an.dc.x;
    let y = an.dc.y;
    for (let j = 0; j < K; j++) {
      X[j] = x;
      Y[j] = y;
      const a = an.phase[j] + TAU * an.freq[j] * T;
      x += an.amp[j] * Math.cos(a);
      y += an.amp[j] * Math.sin(a);
    }
    X[K] = x;
    Y[K] = y;
    this.tipW = { x, y };
  }

  projectChain(K) {
    const { s, ox, oy } = this.view;
    for (let j = 0; j <= K; j++) {
      this.chainX[j] = ox + this.chainWX[j] * s;
      this.chainY[j] = oy + this.chainWY[j] * s;
    }
    return { x: this.chainX[K], y: this.chainY[K] };
  }

  drawEpicycles(K) {
    const { ctx, an, chainX: X, chainY: Y, w, h } = this;
    const s = this.view.s;
    ctx.globalCompositeOperation = 'source-over';

    const r0 = an.amp[0] * s;
    if (r0 < 3 * Math.max(w, h)) {
      const core = ctx.createRadialGradient(X[0], Y[0], 0, X[0], Y[0], r0);
      core.addColorStop(0, 'rgba(143, 124, 255, 0.12)');
      core.addColorStop(1, 'rgba(143, 124, 255, 0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(X[0], Y[0], r0, 0, TAU);
      ctx.fill();
    }

    for (const [from, to, alpha, width] of CIRCLE_TIERS) {
      if (from >= K) break;
      ctx.beginPath();
      for (let j = from; j < Math.min(to, K); j++) {
        const r = an.amp[j] * s;
        if (r >= 0.7) this.addOrbit(X[j], Y[j], r);
      }
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(196, 186, 255, ${alpha})`;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(X[0], Y[0]);
    for (let j = 1; j <= K; j++) ctx.lineTo(X[j], Y[j]);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    for (let j = 1; j < Math.min(K, 24); j++) {
      ctx.moveTo(X[j] + 1.6, Y[j]);
      ctx.arc(X[j], Y[j], 1.6, 0, TAU);
    }
    ctx.fill();

    ctx.strokeStyle = 'rgba(85, 230, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X[0], Y[0], 4.5, 0, TAU);
    ctx.stroke();
  }

  // Adds a circle outline to the current path. Circles whose outline misses the screen are
  // skipped; huge ones are only traced along the sliver that crosses it, in double precision.
  addOrbit(x, y, r) {
    const { ctx, w, h } = this;
    const nx = Math.max(-4 - x, 0, x - w - 4);
    const ny = Math.max(-4 - y, 0, y - h - 4);
    if (r < Math.hypot(nx, ny)) return;
    const fx = Math.max(Math.abs(x), Math.abs(x - w));
    const fy = Math.max(Math.abs(y), Math.abs(y - h));
    if (r > Math.hypot(fx, fy) + 4) return;
    if (r > 2 * (w + h)) {
      const [lo, hi] = screenArcSpan(x, y, w, h);
      ctx.moveTo(x + r * Math.cos(lo), y + r * Math.sin(lo));
      for (let i = 1; i <= 64; i++) {
        const a = lo + ((hi - lo) * i) / 64;
        ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
    } else {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
  }

  // Celestial look: thin orbits, a star at the centre and a world on every joint, lit by the star.
  drawCosmic(K) {
    const { ctx, an, chainX: X, chainY: Y, w, h } = this;
    const s = this.view.s;
    ctx.globalCompositeOperation = 'source-over';
    for (const [from, to, alpha, width] of CIRCLE_TIERS) {
      if (from >= K) break;
      ctx.beginPath();
      for (let j = from; j < Math.min(to, K); j++) {
        const r = an.amp[j] * s;
        if (r >= 0.7) this.addOrbit(X[j], Y[j], r);
      }
      ctx.lineWidth = width * 0.9;
      ctx.strokeStyle = `rgba(150, 190, 255, ${alpha * 0.6})`;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(X[0], Y[0]);
    for (let j = 1; j <= K; j++) ctx.lineTo(X[j], Y[j]);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.stroke();

    // Every joint is a body. Ones whose true disc is too small to see get a marker instead,
    // and only once their orbit is wide enough on screen to tell them apart from their parent.
    for (let j = 0; j < K; j++) {
      const x = X[j];
      const y = Y[j];
      if (j && (x < -60 || y < -60 || x > w + 60 || y > h + 60) && an.amp[j] * s < w) continue;
      if (!this.bodyShown(j, K, s)) continue;
      this.drawWorld(this.body(j, K), j, x, y, this.bodyRadius(j, K) * s);
    }
  }

  // One body: its real disc when it's at least ~2px across, otherwise a marker (and a name for
  // the big ones, planetarium style).
  drawWorld(b, j, x, y, r) {
    const { ctx, chainX: X, chainY: Y, w, h } = this;
    if (r >= 1.6 || j === 0) {
      let lx = X[0] - x;
      let ly = Y[0] - y;
      const d = Math.hypot(lx, ly) || 1;
      drawBody(ctx, b, x, y, r, lx / d, ly / d, w, h, this.time);
    } else {
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) return;
      drawMarker(ctx, b, x, y, b.role === 'asteroid' ? 1.1 : b.role === 'moon' ? 1.6 : 2.3);
    }
    // Names for the star, the planet, the drawing planet, and moons once their orbit is wide
    // enough on screen that the label can't pile onto its parent's.
    const named = b.role === 'star' || b.role === 'planet' || b.role === 'pen' || (b.role === 'moon' && this.an.amp[j - 1] * this.view.s >= 40);
    if (r < 14 && named && x > -40 && y > -40 && x < w + 40 && y < h + 40) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = b.role === 'pen' ? 'rgba(140, 220, 255, 0.85)' : 'rgba(225, 220, 255, 0.6)';
      ctx.fillText(b.name, x + Math.max(r, 3) + 7, y - Math.max(r, 3) - 4);
    }
  }

  // The drawing planet rides the tip of the chain, on top of the trail it leaves behind.
  drawPenPlanet(tip) {
    const K = this.curve.K;
    this.drawWorld(PEN_BODY, K, tip.x, tip.y, this.bodyRadius(K, K) * this.view.s);
  }

  // Specks of dust pinned to world space at every scale: they stream past while you zoom,
  // which is what makes a deep dive read as motion through space.
  drawDust() {
    const { ctx, w, h } = this;
    const { s, ox, oy } = this.view;
    const { minX, minY, maxX, maxY } = this.an.bbox;
    const base = Math.hypot(maxX - minX, maxY - minY) / 6 || 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let L = -4; L < 80; L++) {
      const d = base / 2 ** L;
      const px = d * s;
      if (px > 420) continue;
      if (px < 34) break;
      const fade = Math.min(1, (px - 34) / 40) * Math.min(1, (420 - px) / 160);
      const gx0 = Math.floor(-ox / s / d);
      const gx1 = Math.floor((w - ox) / s / d);
      const gy0 = Math.floor(-oy / s / d);
      const gy1 = Math.floor((h - oy) / s / d);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const hsh = hash(gx % 1e9, gy % 1e9, L, 4242);
          if (hsh % 3 !== 0) continue;
          const x = ox + (gx + ((hsh >>> 4) & 255) / 255) * d * s;
          const y = oy + (gy + ((hsh >>> 12) & 255) / 255) * d * s;
          const size = 0.6 + ((hsh >>> 20) & 3) * 0.4;
          ctx.fillStyle = `rgba(205, 212, 255, ${fade * (0.18 + ((hsh >>> 24) & 7) / 20)})`;
          ctx.fillRect(x, y, size, size);
        }
      }
    }
  }

  // At deep zoom the precomputed trail is a visible polyline; recompute the stretch just
  // behind the pen exactly (aligned to a trail chunk so the two meet without a gap).
  refinedTail(c, T) {
    if (this.eff.z < 40) return null;
    const { an } = this;
    const { s, ox, oy } = this.view;
    const span = Math.min(0.03, (3 * Math.hypot(this.w, this.h)) / (c.lapLength * s));
    const from = Math.floor(((T - span) * c.M) / CHUNK) * CHUNK;
    const t0 = from / c.M;
    const n = 240;
    this.tailX ??= new Float64Array(n + 1);
    this.tailY ??= new Float64Array(n + 1);
    const X = this.tailX.fill(an.dc.x);
    const Y = this.tailY.fill(an.dc.y);
    for (let j = 0; j < c.K; j++) {
      // Terms smaller than a hundredth of a pixel at this zoom can't be seen; skip their work.
      if (an.amp[j] * s < 0.01) {
        if (an.order === 'size') break;
        continue;
      }
      const a0 = an.phase[j] + TAU * an.freq[j] * t0;
      const da = (TAU * an.freq[j] * (T - t0)) / n;
      const cs = Math.cos(da);
      const sn = Math.sin(da);
      let zr = an.amp[j] * Math.cos(a0);
      let zi = an.amp[j] * Math.sin(a0);
      for (let m = 0; m <= n; m++) {
        X[m] += zr;
        Y[m] += zi;
        const nr = zr * cs - zi * sn;
        zi = zr * sn + zi * cs;
        zr = nr;
      }
    }
    for (let m = 0; m <= n; m++) {
      X[m] = ox + X[m] * s;
      Y[m] = oy + Y[m] * s;
    }
    return { from, n, X, Y, hue: this.hue(T) };
  }

  drawTail(tail, tip, boost) {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [width, a, light] of TRAIL_PASSES) {
      ctx.lineWidth = width;
      ctx.strokeStyle = `hsla(${tail.hue}, 100%, ${light}%, ${Math.min(1, a * boost)})`;
      ctx.beginPath();
      ctx.moveTo(tail.X[0], tail.Y[0]);
      for (let m = 1; m <= tail.n; m++) ctx.lineTo(tail.X[m], tail.Y[m]);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
  }

  drawTrail(c, upto, tip, alpha, skip = null) {
    const { ctx } = this;
    const { sx, sy, M, boxes, heat } = c;
    const heatOn = this.opts.heat;
    const skipped = (s, e) =>
      skip && [-M, 0, M].some((o) => s < skip[1] + o && e > skip[0] + o);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    for (const [width, a, light] of TRAIL_PASSES) {
      ctx.lineWidth = width;
      for (let s = 0, b = 0; s < upto; s += CHUNK, b += 4) {
        if (!this.onScreen(boxes, b, 24)) continue;
        const e = Math.min(upto, s + CHUNK);
        if (skipped(s, e)) continue;
        // Heatmap: green on target → red at 10% of the shape's radius off.
        const hue = heatOn ? 125 * (1 - clamp(heat[b / 4] / 0.1, 0, 1)) : this.hue(s / M);
        ctx.strokeStyle = `hsla(${hue}, 100%, ${light}%, ${a * alpha})`;
        ctx.beginPath();
        ctx.moveTo(sx[s], sy[s]);
        for (let i = s + 1; i <= e; i++) ctx.lineTo(sx[i], sy[i]);
        if (tip && e === upto) ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
    }
  }

  // A bright tail chasing the pen once the full curve is on screen.
  drawComet(c, T, tip) {
    const { ctx } = this;
    const { sx, sy, M } = c;
    const end = Math.floor(T * M);
    const len = Math.floor(M * 0.14);
    const parts = 8;
    ctx.lineCap = 'butt';
    for (let p = 0; p < parts; p++) {
      const a0 = end - len + Math.floor((p * len) / parts);
      const a1 = end - len + Math.floor(((p + 1) * len) / parts);
      const k = (p + 1) / parts;
      for (const [width, alpha, light] of [[9, 0.1, 65], [3, 0.85, 90]]) {
        ctx.lineWidth = width * (0.45 + 0.55 * k);
        ctx.strokeStyle = `hsla(${this.hue(wrap(a1, M) / M)}, 100%, ${light}%, ${alpha * k})`;
        ctx.beginPath();
        for (let i = a0; i <= a1; i++) {
          const j = wrap(i, M);
          if (i === a0) ctx.moveTo(sx[j], sy[j]);
          else ctx.lineTo(sx[j], sy[j]);
        }
        if (p === parts - 1) ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
    }
  }

  // Glow where the line is being laid down. `scale` < 1 is the softer halo used when the
  // drawing planet itself sits on top.
  drawPen({ x, y }, scale = 1) {
    const { ctx } = this;
    const hue = this.hue(this.phase === 'hold' ? 1 : this.t);
    const r = (26 + Math.sin(this.time * 6) * 3) * scale;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.18, `hsla(${hue}, 100%, 72%, 0.6)`);
    g.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    if (scale < 1) return;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, TAU);
    ctx.fill();
  }

  // Particles live in world space; speeds are given in screen px/s at the current zoom.
  burst(x, y, n, vMin, vMax, lifeMin, lifeMax, hue) {
    const s = this.view.s;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = (vMin + Math.random() * (vMax - vMin)) / s;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        max: lifeMin + Math.random() * (lifeMax - lifeMin),
        size: 0.8 + Math.random() * 2,
        hue: hue + (Math.random() - 0.5) * 60,
      });
    }
  }

  drawParticles(sim) {
    const { ctx, tipW } = this;
    const { s, ox, oy } = this.view;
    const live = this.phase === 'drawing' || this.phase === 'done' || this.phase === 'manual';
    if (sim > 0 && live && this.prevTipW) {
      let vx = (tipW.x - this.prevTipW.x) / sim;
      let vy = (tipW.y - this.prevTipW.y) / sim;
      const px = Math.hypot(vx, vy) * s;
      if (px > 2000) {
        vx *= 2000 / px;
        vy *= 2000 / px;
      }
      const rate = this.phase === 'drawing' ? 110 : 55;
      this.spawnDebt += (rate * sim) / Math.sqrt(Math.max(0.05, this.speedNow));
      const hue = this.hue(this.t);
      while (this.spawnDebt >= 1) {
        this.spawnDebt -= 1;
        const a = Math.random() * TAU;
        const v = (10 + Math.random() * 50) / s;
        this.particles.push({
          x: tipW.x,
          y: tipW.y,
          vx: Math.cos(a) * v - vx * 0.08,
          vy: Math.sin(a) * v - vy * 0.08,
          age: 0,
          max: 0.5 + Math.random() * 0.9,
          size: 0.6 + Math.random() * 1.6,
          hue: hue + (Math.random() - 0.5) * 40,
        });
      }
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);

    ctx.globalCompositeOperation = 'lighter';
    const drag = Math.max(0, 1 - 1.6 * sim);
    let keep = 0;
    for (const p of this.particles) {
      p.age += sim;
      if (p.age >= p.max) continue;
      p.x += p.vx * sim;
      p.y += p.vy * sim;
      p.vx *= drag;
      p.vy *= drag;
      this.particles[keep++] = p;
      const x = ox + p.x * s;
      const y = oy + p.y * s;
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) continue;
      const life = (1 - p.age / p.max) ** 1.4;
      ctx.fillStyle = `hsla(${p.hue}, 100%, 72%, ${life})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (0.4 + 0.6 * life), 0, TAU);
      ctx.fill();
    }
    this.particles.length = keep;
  }

  drawFx(sim) {
    const { ctx, w, h } = this;
    const { s, ox, oy } = this.view;
    ctx.globalCompositeOperation = 'lighter';
    this.rings = this.rings.filter((r) => (r.age += sim) < r.max + (r.delay ?? 0));
    for (const r of this.rings) {
      const age = r.age - (r.delay ?? 0);
      if (age < 0) continue;
      const p = age / r.max;
      ctx.lineWidth = 3 * (1 - p) + 0.5;
      ctx.strokeStyle = `hsla(${r.hue}, 100%, 72%, ${(1 - p) * 0.8})`;
      ctx.beginPath();
      ctx.arc(ox + r.x * s, oy + r.y * s, r.maxR * (1 - (1 - p) ** 3), 0, TAU);
      ctx.stroke();
    }
    if (this.flash > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, `rgba(170, 255, 200, ${this.flash * 0.22})`);
      g.addColorStop(1, 'rgba(170, 255, 200, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      this.flash = Math.max(0, this.flash - sim * 1.4);
    }
  }

  // Cool vignette that fades in while slow-mo is on.
  drawSlowmo(dt) {
    const { ctx, w, h } = this;
    this.slowFx = lerp(this.slowFx, this.slowmo ? 1 : 0, 1 - Math.exp(-dt * 6));
    if (this.slowFx < 0.01) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.56);
    g.addColorStop(0, 'rgba(60, 200, 255, 0)');
    g.addColorStop(1, `rgba(60, 200, 255, ${0.22 * this.slowFx})`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawCaption() {
    const { ctx, h } = this;
    const manual = this.manualK != null;
    const acc = manual ? this.an.accAt(this.manualK) : (this.stages[this.stageIdx]?.acc ?? 0);
    const pad2 = (n) => String(n).padStart(2, '0');
    const head = manual ? 'EXPLORER' : `STAGE ${pad2(this.stageIdx + 1)}/${pad2(this.stages.length)}`;
    const lines = [
      [`${head} · ${this.curve.K} EPICYCLE${this.curve.K === 1 ? '' : 'S'}`, 'rgba(239, 236, 255, 0.92)'],
      [`${(acc * 100).toFixed(2)}% MATCH`, this.phase === 'done' ? '#b4ff7e' : '#55e6ff'],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.textBaseline = 'top';
    ctx.font = '700 14px "JetBrains Mono", ui-monospace, monospace';
    lines.forEach(([text, color], i) => {
      ctx.fillStyle = 'rgba(10, 8, 22, 0.6)';
      ctx.fillText(text, 19, 19 + i * 22);
      ctx.fillStyle = color;
      ctx.fillText(text, 18, 18 + i * 22);
    });
    ctx.font = '800 12px Unbounded, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(176, 170, 214, 0.55)';
    ctx.textBaseline = 'bottom';
    ctx.fillText('FOURIER FORGE', 18, h - 40);
    ctx.restore();
  }

  // Overview inset with the visible region, shown once you zoom in. The shape layer is cached
  // and only redrawn when the curve or canvas size changes.
  drawMinimap() {
    const alpha = clamp((this.eff.z - 1.12) / 0.4, 0, 1);
    if (alpha <= 0) return;
    const { ctx, w, h, dpr, view, an, curve } = this;
    const size = Math.round(clamp(Math.min(w, h) * 0.24, 84, 190));
    const x0 = w - size - 14;
    const y0 = 56;
    const { minX, minY, maxX, maxY } = an.bbox;
    const bw = Math.max(maxX - minX, 1e-9);
    const bh = Math.max(maxY - minY, 1e-9);
    const ms = (size * 0.8) / Math.max(bw, bh);
    const lx = size / 2 - (minX + bw / 2) * ms;
    const ly = size / 2 - (minY + bh / 2) * ms;
    const mx = x0 + lx;
    const my = y0 + ly;

    const key = `${curve.id}|${size}|${dpr}|${an.N}|${minX}`;
    if (this.miniKey !== key) {
      this.miniKey = key;
      this.mini ??= document.createElement('canvas');
      this.mini.width = Math.round(size * dpr);
      this.mini.height = Math.round(size * dpr);
      const g = this.mini.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.beginPath();
      g.roundRect(0.5, 0.5, size - 1, size - 1, 16);
      g.fillStyle = 'rgba(12, 10, 28, 0.82)';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      g.stroke();
      curve.pathW ??= worldPath(curve.wx, curve.wy, curve.M + 1, false);
      g.setTransform(dpr * ms, 0, 0, dpr * ms, dpr * lx, dpr * ly);
      g.lineWidth = 1 / ms;
      g.strokeStyle = 'rgba(200, 190, 255, 0.3)';
      g.stroke(this.targetW);
      g.lineWidth = 1.4 / ms;
      g.strokeStyle = `hsla(${this.hue(0.5)}, 100%, 70%, 0.75)`;
      g.stroke(curve.pathW);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.mini, x0, y0, size, size);
    ctx.beginPath();
    ctx.roundRect(x0, y0, size, size, 16);
    ctx.clip();

    const vx = mx + (-view.ox / view.s) * ms;
    const vy = my + (-view.oy / view.s) * ms;
    const vw = (w / view.s) * ms;
    const vh = (h / view.s) * ms;
    ctx.fillStyle = 'rgba(85, 230, 255, 0.1)';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(85, 230, 255, 0.9)';
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(mx + this.tipW.x * ms, my + this.tipW.y * ms, 2.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
