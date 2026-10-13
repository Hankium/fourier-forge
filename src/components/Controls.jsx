import { useEffect, useState } from 'react';

// Log-scale speed slider: 0 → 0.05×, 100 → 8×, with a soft snap to 1×.
const MIN_SPEED = 0.05;
const MAX_SPEED = 8;
const RANGE = Math.log(MAX_SPEED / MIN_SPEED);
const toSlider = (speed) => (100 * Math.log(speed / MIN_SPEED)) / RANGE;
const fromSlider = (v) => {
  const speed = MIN_SPEED * Math.exp((v / 100) * RANGE);
  return Math.abs(Math.log(speed)) < 0.07 ? 1 : speed;
};
export const fmtSpeed = (s) => `${s < 1 ? s.toFixed(2) : s.toFixed(1)}×`;

export function SpeedSlider({ speed, onSpeed, className = '' }) {
  const pos = toSlider(speed);
  return (
    <input
      type="range"
      className={`range ${className}`}
      min="0"
      max="100"
      step="0.5"
      value={pos}
      style={{ '--fill': `${pos}%` }}
      onChange={(e) => onSpeed(fromSlider(Number(e.target.value)))}
      onDoubleClick={() => onSpeed(1)}
      aria-label="Animation speed"
      title="Double-click for 1×"
    />
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export default function Controls({
  playing,
  onPlay,
  onRestart,
  onSkip,
  speed,
  onSpeed,
  slowmo,
  onSlowmo,
  target,
  onTarget,
  order,
  onOrder,
  view,
  onView,
  recording,
  onRecord,
}) {
  const pct = target * 100;
  return (
    <section className="panel" style={{ '--accent': 'var(--violet)' }}>
      <h2>Machine</h2>
      <div className="transport">
        <button type="button" className="btn btn-pink btn-play" onClick={onPlay}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {playing ? <path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" /> : <path d="M8 5.2v13.6L19 12z" />}
          </svg>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn btn-cyan btn-icon" onClick={onRestart} aria-label="Restart from one circle" title="Restart (R)">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.6h4.6" />
          </svg>
        </button>
        <button type="button" className="btn btn-violet btn-icon" onClick={onSkip} aria-label="Skip to final stage" title="Skip to final (S)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5.5v13l9-6.5zM15.5 5h3.2v14h-3.2z" />
          </svg>
        </button>
      </div>

      <div className="field">
        <div className="field-head">
          <span>Speed</span>
          <b>{fmtSpeed(speed)}</b>
        </div>
        <SpeedSlider speed={speed} onSpeed={onSpeed} />
        <div className="range-ticks" aria-hidden="true">
          <span>0.05×</span>
          <span style={{ left: `${toSlider(1)}%` }}>1×</span>
          <span>8×</span>
        </div>
        <button
          type="button"
          className={`btn btn-amber btn-slowmo${slowmo ? ' on' : ''}`}
          aria-pressed={slowmo}
          onClick={onSlowmo}
          title="Toggle slow motion (or hold Shift)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 8 4.5 8 8.5s-8 4-8 8.5M16 3.5c0 4.5-8 4.5-8 8.5s8 4 8 8.5" />
          </svg>
          {slowmo ? 'Slow-mo on' : 'Slow-mo'}
          <kbd>Shift</kbd>
        </button>
      </div>

      <div className="field">
        <div className="field-head">
          <span>Stop at accuracy</span>
          <b>{pct.toFixed(1)}%</b>
        </div>
        <input
          type="range"
          className="range"
          min="90"
          max="99.9"
          step="0.1"
          value={pct}
          style={{ '--fill': `${((pct - 90) / 9.9) * 100}%` }}
          onChange={(e) => onTarget(Number(e.target.value) / 100)}
          aria-label="Target accuracy"
        />
      </div>

      <div className="field">
        <div className="field-head">
          <span>Add circles by</span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Order circles join in">
          {ORDERS.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={order === key} className={order === key ? 'on' : ''} onClick={() => onOrder(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <span>Look</span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Visual style">
          {LOOKS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={view.style === key}
              className={view.style === key ? 'on' : ''}
              onClick={() => onView({ ...view, style: key })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view.style === 'cosmic' && (
        <div className="field">
          <div className="field-head">
            <span>Body sizes</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="Body sizes">
            {SCALES.map(([key, label, title]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={view.scale === key}
                className={view.scale === key ? 'on' : ''}
                title={title}
                onClick={() => onView({ ...view, scale: key })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="toggles">
        <Toggle label={view.style === 'cosmic' ? 'Planets & orbits' : 'Epicycles'} checked={view.circles} onChange={(v) => onView({ ...view, circles: v })} />
        <Toggle label="Target outline" checked={view.target} onChange={(v) => onView({ ...view, target: v })} />
        <Toggle label="Ghost trails" checked={view.ghosts} onChange={(v) => onView({ ...view, ghosts: v })} />
        <Toggle label="Error heatmap" checked={view.heat} onChange={(v) => onView({ ...view, heat: v })} />
      </div>

      <RecordButton recording={recording} onRecord={onRecord} />
    </section>
  );
}

const SCALES = [
  ['real', 'Realistic', 'True radii in km, first orbit = 1 AU. Zoom in to see the worlds.'],
  ['big', 'Enlarged', 'Worlds sized from their orbits so they are visible at a glance'],
];

const LOOKS = [
  ['cosmic', 'Cosmic'],
  ['neon', 'Neon'],
];

const ORDERS = [
  ['size', 'Size'],
  ['freq', 'Frequency'],
];

export function RecordButton({ recording, onRecord, compact = false }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [recording]);
  const secs = recording ? Math.floor((Date.now() - recording.start) / 1000) : 0;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const label = compact ? (recording ? `Stop · ${clock}` : 'Rec') : recording ? `Stop & save · ${clock}` : 'Record video';
  return (
    <button
      type="button"
      className={`btn btn-rec${recording ? ' on' : ''}${compact ? ' btn-rec-compact' : ''}`}
      onClick={onRecord}
      title={recording ? 'Stop and save the video' : 'Record the whole run as a video'}
    >
      <span className="rec-dot" aria-hidden="true" />
      {label}
    </button>
  );
}
