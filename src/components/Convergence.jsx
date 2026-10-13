// Accuracy per stage on a "nines" scale (90% → 99% → 99.9% are evenly spaced),
// so the last stretch towards 100% stays readable.
const W = 300;
const H = 160;
const PAD = { l: 44, r: 12, t: 14, b: 28 };
const TOP = 3.3;
const TICKS = [
  [0, '0%'],
  [0.9, '90%'],
  [0.99, '99%'],
  [0.999, '99.9%'],
];

const nines = (a) => Math.min(TOP, -Math.log10(Math.max(1e-7, 1 - a)));
const yOf = (a) => PAD.t + (1 - nines(a) / TOP) * (H - PAD.t - PAD.b);

export default function Convergence({ stages, reached, target }) {
  const n = stages.length;
  const xOf = (i) => PAD.l + (n > 1 ? i / (n - 1) : 0.5) * (W - PAD.l - PAD.r);
  const upto = Math.max(0, Math.min(reached, n - 1));
  const line = stages.slice(0, upto + 1).map((s, i) => [xOf(i), yOf(s.acc)]);
  const area = line.length
    ? `M${xOf(0)},${H - PAD.b} ${line.map(([x, y]) => `L${x},${y}`).join(' ')} L${xOf(upto)},${H - PAD.b} Z`
    : '';
  const labelIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])].filter((i) => i >= 0);

  return (
    <svg className="conv" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accuracy at each stage">
      <defs>
        <linearGradient id="conv-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#55e6ff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#8f7cff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="conv-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8f7cff" />
          <stop offset="1" stopColor="#55e6ff" />
        </linearGradient>
      </defs>
      {TICKS.map(([a, label]) => (
        <g key={label}>
          <line className="conv-grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(a)} y2={yOf(a)} />
          <text className="conv-tick" x={PAD.l - 8} y={yOf(a) + 3.5} textAnchor="end">
            {label}
          </text>
        </g>
      ))}
      <line className="conv-target" x1={PAD.l} x2={W - PAD.r} y1={yOf(target)} y2={yOf(target)} />
      <text className="conv-target-label" x={W - PAD.r} y={yOf(target) - 5} textAnchor="end">
        target
      </text>
      {area && <path d={area} fill="url(#conv-area)" />}
      {line.length > 1 && <polyline className="conv-line" points={line.map((p) => p.join(',')).join(' ')} />}
      {stages.map((s, i) => (
        <circle
          key={i}
          cx={xOf(i)}
          cy={yOf(s.acc)}
          r={i === upto ? 4.5 : 2.6}
          className={`conv-dot ${i < upto ? 'past' : i === upto ? 'now' : 'todo'}`}
        />
      ))}
      {labelIdx.map((i) => (
        <text key={i} className="conv-k" x={xOf(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
          {stages[i].k}
        </text>
      ))}
    </svg>
  );
}
