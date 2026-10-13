// Complex Fourier series of a closed curve: z(t) = Σ c_f · e^(i·2π·f·t), t ∈ [0, 1).
// Each term is one epicycle: radius |c_f|, spinning f turns per loop, starting at angle arg(c_f).

const TAU = Math.PI * 2;

// In-place iterative radix-2 FFT (length must be a power of two).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = -TAU / len;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k);
      const wi = Math.sin(step * k);
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const xr = re[j] * wr - im[j] * wi;
        const xi = re[j] * wi + im[j] * wr;
        re[j] = re[i] - xr;
        im[j] = im[i] - xi;
        re[i] += xr;
        im[i] += xi;
      }
    }
  }
}

// Order in which circles join: 'size' (biggest first, converges fastest) or
// 'freq' (slowest first: 1, −1, 2, −2, … the textbook order).
const ORDERS = {
  size: (a, b) => b.amp - a.amp,
  freq: (a, b) => Math.abs(a.f) - Math.abs(b.f) || b.f - a.f,
};

export function analyze(samples, order = 'size') {
  const N = samples.xs.length;
  const re = Float64Array.from(samples.xs);
  const im = Float64Array.from(samples.ys);
  fft(re, im);

  const terms = [];
  for (let k = 1; k < N; k++) {
    const r = re[k] / N;
    const i = im[k] / N;
    terms.push({ f: k < N / 2 ? k : k - N, amp: Math.hypot(r, i), phase: Math.atan2(i, r) });
  }
  terms.sort(ORDERS[order] ?? ORDERS.size);

  const count = terms.length;
  const freq = new Int32Array(count);
  const amp = new Float64Array(count);
  const phase = new Float64Array(count);
  const rank = new Int32Array(N);
  const cum = new Float64Array(count + 1);
  terms.forEach((t, j) => {
    freq[j] = t.f;
    amp[j] = t.amp;
    phase[j] = t.phase;
    rank[t.f + N / 2] = j;
    cum[j + 1] = cum[j] + t.amp * t.amp;
  });
  const dc = { x: re[0] / N, y: im[0] / N };
  const radius = Math.sqrt(cum[count]); // RMS distance of the shape from its centroid (Parseval)
  const worst = worstErrors(samples, dc, freq, amp, phase);

  // Accuracy = 1 − (worst distance between the epicycle curve and the target at any sample point)
  // ÷ (RMS radius of the shape). Strict on purpose: one bad corner keeps it below 100%.
  const accAt = (k) => {
    const K = Math.max(0, Math.min(count, Math.round(k)));
    return radius > 0 ? Math.max(0, 1 - worst[K] / radius) : 1;
  };

  return { N, count, dc, radius, order, freq, amp, phase, rank, accAt, samples, bbox: samples.bbox };
}

// worst[K] = max over samples of |target − partial sum of the first K terms|.
// Terms are peeled off the residual one at a time, so the whole table costs O(count · N).
function worstErrors(samples, dc, freq, amp, phase) {
  const N = samples.xs.length;
  const rx = new Float64Array(N);
  const ry = new Float64Array(N);
  let max = 0;
  for (let n = 0; n < N; n++) {
    rx[n] = samples.xs[n] - dc.x;
    ry[n] = samples.ys[n] - dc.y;
    max = Math.max(max, rx[n] * rx[n] + ry[n] * ry[n]);
  }
  const worst = new Float64Array(freq.length + 1);
  worst[0] = Math.sqrt(max);
  for (let j = 0; j < freq.length; j++) {
    const c = Math.cos((TAU * freq[j]) / N);
    const s = Math.sin((TAU * freq[j]) / N);
    let zr = amp[j] * Math.cos(phase[j]);
    let zi = amp[j] * Math.sin(phase[j]);
    max = 0;
    for (let n = 0; n < N; n++) {
      const ex = (rx[n] -= zr);
      const ey = (ry[n] -= zi);
      const d = ex * ex + ey * ey;
      if (d > max) max = d;
      const nr = zr * c - zi * s;
      zi = zr * s + zi * c;
      zr = nr;
    }
    worst[j + 1] = Math.sqrt(max);
  }
  return worst;
}

const LADDER = [1, 2, 3, 4, 6, 8, 11, 16, 22, 30, 42, 60, 84, 120, 170, 240, 340, 480, 680, 960, 1360, 2048];

// Stages of the auto run: a roughly geometric ladder of epicycle counts, ending at the
// smallest count that clears the target accuracy.
export function buildSchedule(an, target) {
  const stages = [];
  let prev = 0;
  for (const rung of LADDER) {
    const k = Math.min(rung, an.count);
    if (k <= prev) continue;
    if (an.accAt(k) >= target) {
      let exact = prev + 1;
      while (exact < k && an.accAt(exact) < target) exact++;
      stages.push({ k: exact, acc: an.accAt(exact) });
      return stages;
    }
    stages.push({ k, acc: an.accAt(k) });
    prev = k;
    if (k === an.count) break;
  }
  return stages;
}

export function maxFreq(an, K) {
  let m = 0;
  for (let j = 0; j < K; j++) m = Math.max(m, Math.abs(an.freq[j]));
  return m;
}

export function curveResolution(an, K) {
  return Math.min(4096, Math.max(720, Math.ceil(maxFreq(an, K) * 6)));
}

// The path drawn by the first K epicycles, sampled at M+1 points (last point == first).
// Each term is advanced by a fixed rotation per step, so there is no trig in the inner loop.
export function traceCurve(an, K, M) {
  const xs = new Float64Array(M + 1).fill(an.dc.x);
  const ys = new Float64Array(M + 1).fill(an.dc.y);
  for (let j = 0; j < K; j++) {
    const w = (TAU * an.freq[j]) / M;
    const c = Math.cos(w);
    const s = Math.sin(w);
    let zr = an.amp[j] * Math.cos(an.phase[j]);
    let zi = an.amp[j] * Math.sin(an.phase[j]);
    for (let m = 0; m <= M; m++) {
      xs[m] += zr;
      ys[m] += zi;
      const nr = zr * c - zi * s;
      zi = zr * s + zi * c;
      zr = nr;
    }
  }
  return { xs, ys };
}
