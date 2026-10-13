import katex from 'katex';

// TeX for the series currently being drawn, with its real coefficients (SVG units).

export const tex = (src, displayMode = false) => katex.renderToString(src, { displayMode, throwOnError: false, strict: false });

function num(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

const signed = (v) => `${v < 0 ? '-' : '+'} ${num(Math.abs(v))}`;
const complex = (x, y) => `${num(x)} ${y < 0 ? '-' : '+'} ${num(Math.abs(y))}\\,i`;

function angle(f) {
  if (f === 1) return '2\\pi t';
  if (f === -1) return '-2\\pi t';
  return `${f < 0 ? '-' : ''}2\\pi{\\cdot}${Math.abs(f)}\\,t`;
}

function term(an, j, fresh) {
  const body = `${num(an.amp[j])}\\,e^{\\,i\\left(${angle(an.freq[j])}\\,${signed(an.phase[j])}\\right)}`;
  return fresh ? `\\textcolor{#b4ff7e}{${body}}` : body;
}

export const generalTex = (k) => `z(t) = c_0 + \\sum_{n=1}^{${k}} r_n\\, e^{\\,i\\,(2\\pi f_n t \\,+\\, \\varphi_n)}`;

// First four circles, then the two newest once there are too many to list.
export function expansionTex(an, K, freshFrom) {
  const picks = K <= 7 ? Array.from({ length: K }, (_, j) => j) : [0, 1, 2, 3, null, K - 2, K - 1];
  const terms = picks.map((j) =>
    j === null ? `\\underbrace{\\;\\cdots\\;}_{\\text{${K - 6} more}}` : term(an, j, j >= freshFrom),
  );
  return `z(t) = \\left(${complex(an.dc.x, an.dc.y)}\\right) + ${terms.join(' + ')}`;
}

export const formatZ = (tip) => `${tip.x.toFixed(2)} ${tip.y < 0 ? '−' : '+'} ${Math.abs(tip.y).toFixed(2)}i`;
