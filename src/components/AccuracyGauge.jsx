import { useTweened } from '../lib/useTweened.js';

const R = 78;
const C = 2 * Math.PI * R;

export default function AccuracyGauge({ value, target, locked, label }) {
  const v = Math.max(0, Math.min(1, useTweened(value)));
  const ta = target * 2 * Math.PI - Math.PI / 2;

  return (
    <div className={`gauge${locked ? ' locked' : ''}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <linearGradient id="gauge-run" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#55e6ff" />
            <stop offset="0.5" stopColor="#8f7cff" />
            <stop offset="1" stopColor="#ff6fb5" />
          </linearGradient>
          <linearGradient id="gauge-lock" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d4ff9e" />
            <stop offset="1" stopColor="#55e6ff" />
          </linearGradient>
        </defs>
        <circle className="gauge-well" cx="100" cy="100" r="94" />
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * 2 * Math.PI;
          const r1 = i % 5 ? 90 : 87;
          return (
            <line
              key={i}
              className="gauge-tick"
              x1={100 + Math.cos(a) * r1}
              y1={100 + Math.sin(a) * r1}
              x2={100 + Math.cos(a) * 92}
              y2={100 + Math.sin(a) * 92}
            />
          );
        })}
        <circle className="gauge-track" cx="100" cy="100" r={R} />
        <circle
          className="gauge-fill"
          cx="100"
          cy="100"
          r={R}
          stroke={`url(#${locked ? 'gauge-lock' : 'gauge-run'})`}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - v)}
          transform="rotate(-90 100 100)"
        />
        <circle className="gauge-target" cx={100 + Math.cos(ta) * R} cy={100 + Math.sin(ta) * R} r="5" />
      </svg>
      <div className="gauge-center">
        <div className="gauge-num">
          {(v * 100).toFixed(2)}
          <small>%</small>
        </div>
        <div className="gauge-label">{label}</div>
      </div>
    </div>
  );
}
