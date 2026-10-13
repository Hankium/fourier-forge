import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { EpicycleEngine } from '../lib/engine.js';

const pad2 = (n) => String(n).padStart(2, '0');
const ZOOM_STEP = 1.6;

function fmtZoom(z) {
  if (z < 10) return z.toFixed(1);
  if (z < 1000) return String(Math.round(z));
  if (z < 1e6) return `${(z / 1000).toFixed(z < 1e4 ? 1 : 0)}k`;
  if (z < 1e9) return `${(z / 1e6).toFixed(z < 1e7 ? 1 : 0)}M`;
  return `${(z / 1e9).toFixed(1)}B`;
}

const fmtKm = (km) => `R ${km >= 100 ? Math.round(km).toLocaleString('en-US') : km.toFixed(1)} KM`;

const EpicycleStage = forwardRef(function EpicycleStage(
  { analysis, stages, speed, playing, slowmo, view, manualK, run, acc, recording, onRun, onPause, onFrame, fullscreenUi },
  ref,
) {
  const canvasRef = useRef(null);
  const screenRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const scrubRef = useRef(null);
  const engineRef = useRef(null);
  const onRunRef = useRef(onRun);
  const onFrameRef = useRef(onFrame);
  const scrubbing = useRef(false);
  const [cam, setCam] = useState({ zoom: 1, follow: false, focus: null });
  const [hint, setHint] = useState(true);

  useLayoutEffect(() => {
    onRunRef.current = onRun;
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    const engine = new EpicycleEngine(canvasRef.current, {
      onState: (s) => onRunRef.current?.(s),
      onCamera: setCam,
      onTick: (p, tip) => {
        scrubRef.current?.style.setProperty('--p', p);
        onFrameRef.current?.(p, tip);
      },
    });
    engineRef.current = engine;
    if (import.meta.env.DEV) window.__engine = engine; // handy for poking at it from devtools
    return () => engine.destroy();
  }, []);

  // Playground edits morph the running machine; anything else (new shape, new target) restarts it.
  const prevAnalysis = useRef(null);
  useEffect(() => {
    if (!analysis || !stages.length) return;
    const prev = prevAnalysis.current;
    if (analysis.playground && prev?.playground && prev !== analysis) engineRef.current.morph(analysis, stages);
    else engineRef.current.load(analysis, stages);
    prevAnalysis.current = analysis;
  }, [analysis, stages]);

  useEffect(() => {
    engineRef.current.setOptions({ speed, ...view });
  }, [speed, view]);

  useEffect(() => {
    engineRef.current.setPlaying(playing);
  }, [playing]);

  useEffect(() => {
    engineRef.current.setSlowmo(slowmo);
  }, [slowmo]);

  useEffect(() => {
    if (manualK != null) engineRef.current.setManual(manualK);
  }, [manualK]);

  useEffect(() => {
    const id = setTimeout(() => setHint(false), 8000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    engineRef.current.setRecording(Boolean(recording));
  }, [recording]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === screenRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // In fullscreen, keep the shape clear of the equation overlay and the control dock.
  useLayoutEffect(() => {
    const engine = engineRef.current;
    const screen = screenRef.current;
    if (!engine || !screen) return;
    if (!fullscreen) {
      engine.setInsets(0, 0);
      return;
    }
    const box = screen.getBoundingClientRect();
    const eq = screen.querySelector('.fs-eq')?.getBoundingClientRect();
    const dock = screen.querySelector('.fs-dock')?.getBoundingClientRect();
    engine.setInsets(eq ? Math.round(eq.bottom - box.top + 8) : 0, dock ? Math.round(box.bottom - dock.top + 8) : 0);
  });

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else screenRef.current.requestFullscreen?.().catch(() => {});
  };

  useImperativeHandle(
    ref,
    () => ({
      restart: () => engineRef.current?.restart(),
      skip: () => engineRef.current?.skipToEnd(),
      step: (dir) => engineRef.current?.step(dir),
      zoomIn: () => engineRef.current?.zoomBy(ZOOM_STEP),
      zoomOut: () => engineRef.current?.zoomBy(1 / ZOOM_STEP),
      resetView: () => engineRef.current?.resetView(),
      toggleFollow: () => engineRef.current?.toggleFollow(),
      toggleFullscreen,
      canvas: () => canvasRef.current,
    }),
    [],
  );

  const scrubTo = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    engineRef.current.scrub((e.clientX - r.left) / r.width);
  };

  const manual = manualK != null;
  const locked = !manual && run.phase === 'done' && !analysis?.playground;
  const zoomed = cam.follow || Math.abs(cam.zoom - 1) > 0.04;
  const showHint = hint && !zoomed;

  return (
    <div className={`bezel${locked ? ' locked' : ''}${playing ? '' : ' paused'}`}>
      <div ref={screenRef} className={`screen${zoomed ? ' zoomed' : ''}${recording ? ' recording' : ''}`}>
        <canvas ref={canvasRef} role="img" aria-label="Fourier epicycles tracing the selected shape" />
        {fullscreen && fullscreenUi}
        {recording && (
          <span className="rec-pill">
            <span className="rec-dot" /> REC
          </span>
        )}
        {view.heat && (
          <div className="heat-legend" aria-hidden="true">
            <span>on target</span>
            <i />
            <span>10% off</span>
          </div>
        )}

        <div className="hud">
          <div className="hud-stack">
            <span className="hud-pill">
              {manual ? (
                <>EXPLORER MODE</>
              ) : (
                <>
                  STAGE <b>{pad2(run.stageIdx + 1)}</b>
                  <i>/{pad2(stages.length)}</i>
                </>
              )}
            </span>
            {slowmo && <span className="hud-pill hud-slow">SLOW-MO ×{(speed * 0.1).toFixed(speed < 1 ? 3 : 2)}</span>}
            {cam.follow && (
              <span className="hud-pill hud-follow">
                {cam.focus ? (
                  <>
                    {cam.focus.pen ? 'RIDING' : 'ORBITING'} <b>{cam.focus.name.toUpperCase()}</b> · {cam.focus.label.toUpperCase()}
                    {cam.focus.km != null && <> · {fmtKm(cam.focus.km)}</>}
                  </>
                ) : (
                  'FOLLOWING PEN'
                )}
              </span>
            )}
          </div>
          <span className="hud-pill">
            <b>{run.k}</b> {run.k === 1 ? 'EPICYCLE' : 'EPICYCLES'}
          </span>
        </div>

        {!playing && <div className="hud-paused">PAUSED</div>}
        {showHint && (
          <div className="hud-hint">
            {view.style === 'cosmic' ? 'Click a planet to fly to it · ' : ''}scroll or pinch to zoom · drag to pan · double-click to reset
          </div>
        )}
        {locked && !zoomed && (
          <div className="lock-banner" key={`${analysis?.N}-${stages.length}-${run.k}`}>
            <span className="lock-dot" /> TARGET LOCKED · {(acc * 100).toFixed(2)}%
          </div>
        )}

        <div className="cam-ctrl">
          <button type="button" className="cam-btn" onClick={() => engineRef.current.zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out" title="Zoom out (−)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
          <button type="button" className="cam-btn cam-zoom" onClick={() => engineRef.current.resetView()} title="Reset view (0)">
            ×{fmtZoom(cam.zoom)}
          </button>
          <button type="button" className="cam-btn" onClick={() => engineRef.current.zoomBy(ZOOM_STEP)} aria-label="Zoom in" title="Zoom in (+)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12M12 6v12" />
            </svg>
          </button>
          <button
            type="button"
            className={`cam-btn cam-follow${cam.follow ? ' on' : ''}`}
            onClick={() => engineRef.current.toggleFollow()}
            aria-pressed={cam.follow}
            title="Follow the pen (F)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" />
              <circle cx="12" cy="12" r="1.6" className="dot" />
              <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
            </svg>
            <span>Follow</span>
          </button>
          <button
            type="button"
            className="cam-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title="Fullscreen (C)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {fullscreen ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              )}
            </svg>
          </button>
        </div>

        <div
          ref={scrubRef}
          className="scrub"
          title="Drag to scrub through the lap (← → to step)"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubbing.current = true;
            onPause();
            scrubTo(e);
          }}
          onPointerMove={(e) => scrubbing.current && scrubTo(e)}
          onPointerUp={() => (scrubbing.current = false)}
          onPointerCancel={() => (scrubbing.current = false)}
        >
          <div className="scrub-track">
            <i className="scrub-fill" />
            <b className="scrub-thumb" />
          </div>
        </div>
      </div>
    </div>
  );
});

export default EpicycleStage;
