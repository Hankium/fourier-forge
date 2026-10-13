import { useMemo } from 'react';
import { RecordButton, SpeedSlider, fmtSpeed } from './Controls.jsx';
import { expansionTex, tex } from '../lib/equationTex.js';
import { useLiveReadout } from '../lib/useLiveReadout.js';

const Icon = ({ d, stroke = false }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={stroke ? 'stroke' : undefined}>
    <path d={d} />
  </svg>
);

// Live equation shown across the top of the screen in fullscreen.
export function EquationStrip({ analysis, k, freshFrom, live }) {
  const html = useMemo(() => tex(expansionTex(analysis, k, freshFrom)), [analysis, k, freshFrom]);
  const { tRef, zRef } = useLiveReadout(live);
  return (
    <div className="fs-eq">
      <div className="fs-eq-math" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="fs-eq-live">
        t = <b ref={tRef}>0.000</b>
        <span>·</span>z(t) = <b ref={zRef}>0</b>
      </div>
    </div>
  );
}

// Everything you need while the stage fills the screen: transport, frame step, speed,
// slow-mo, circle index stepper, equation toggle and record.
export default function FullscreenDock({
  playing,
  onPlay,
  onRestart,
  onStepFrame,
  speed,
  onSpeed,
  slowmo,
  onSlowmo,
  k,
  maxK,
  acc,
  manual,
  onStepIndex,
  onAuto,
  showEquation,
  onToggleEquation,
  recording,
  onRecord,
}) {
  return (
    <div className="fs-dock" role="toolbar" aria-label="Fullscreen controls">
      <div className="fs-group">
        <button type="button" className="cam-btn" onClick={() => onStepFrame(-1)} aria-label="Step back one frame" title="Step back (←)">
          <Icon d="M11 6 5 12l6 6M19 6l-6 6 6 6" stroke />
        </button>
        <button type="button" className="cam-btn fs-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
          <Icon d={playing ? 'M7 5h3.6v14H7zM13.4 5H17v14h-3.6z' : 'M8 5.2v13.6L19 12z'} />
        </button>
        <button type="button" className="cam-btn" onClick={() => onStepFrame(1)} aria-label="Step forward one frame" title="Step forward (→)">
          <Icon d="M13 6l6 6-6 6M5 6l6 6-6 6" stroke />
        </button>
        <button type="button" className="cam-btn" onClick={onRestart} aria-label="Restart from one circle" title="Restart (R)">
          <Icon d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.6h4.6" stroke />
        </button>
      </div>

      <div className="fs-group fs-speed">
        <span className="fs-label">Speed</span>
        <SpeedSlider speed={speed} onSpeed={onSpeed} className="fs-range" />
        <b className="fs-value">{fmtSpeed(speed)}</b>
        <button
          type="button"
          className={`cam-btn fs-slow${slowmo ? ' on' : ''}`}
          onClick={onSlowmo}
          aria-pressed={slowmo}
          title="Slow-mo (hold Shift)"
        >
          <Icon d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 8 4.5 8 8.5s-8 4-8 8.5M16 3.5c0 4.5-8 4.5-8 8.5s8 4 8 8.5" stroke />
        </button>
      </div>

      <div className="fs-group fs-index">
        <button type="button" className="cam-btn" onClick={() => onStepIndex(-1)} disabled={k <= 1} aria-label="One circle fewer" title="One circle fewer ([)">
          <Icon d="M6 12h12" stroke />
        </button>
        <div className="fs-k">
          <b>{k}</b>
          <span>
            / {maxK} circles · {(acc * 100).toFixed(2)}%
          </span>
        </div>
        <button type="button" className="cam-btn" onClick={() => onStepIndex(1)} disabled={k >= maxK} aria-label="One circle more" title="One circle more (])">
          <Icon d="M6 12h12M12 6v12" stroke />
        </button>
        {manual && (
          <button type="button" className="cam-btn fs-auto" onClick={onAuto} title="Resume the auto run">
            Auto
          </button>
        )}
      </div>

      <div className="fs-group">
        <button
          type="button"
          className={`cam-btn fs-eq-toggle${showEquation ? ' on' : ''}`}
          onClick={onToggleEquation}
          aria-pressed={showEquation}
          title="Show the equation (E)"
        >
          z(t)
        </button>
        <RecordButton recording={recording} onRecord={onRecord} compact />
      </div>
    </div>
  );
}
