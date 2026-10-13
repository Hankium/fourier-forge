import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLES } from './lib/samples.js';
import { svgToSamples, thumbPath } from './lib/svgSampler.js';
import { analyze, buildSchedule, maxFreq } from './lib/fourier.js';
import { defaultTerms, seriesSamples, termsFromAnalysis } from './lib/playground.js';
import Playground from './components/Playground.jsx';
import EpicycleStage from './components/EpicycleStage.jsx';
import ShapePicker from './components/ShapePicker.jsx';
import Controls from './components/Controls.jsx';
import Explorer from './components/Explorer.jsx';
import EquationPanel from './components/EquationPanel.jsx';
import AccuracyGauge from './components/AccuracyGauge.jsx';
import Convergence from './components/Convergence.jsx';
import Spectrum from './components/Spectrum.jsx';
import DrawPad from './components/DrawPad.jsx';
import FullscreenDock, { EquationStrip } from './components/FullscreenDock.jsx';
import { imageToSvg, textToSvg } from './lib/traceRaster.js';
import { downloadBlob, recordCanvas } from './lib/recorder.js';

const MAX_UPLOAD_BYTES = 4_000_000;
const MAX_CUSTOM = 6;

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['← →', 'Step through the lap'],
  ['R', 'Restart from one circle'],
  ['S', 'Skip to the final stage'],
  ['F', 'Follow the pen'],
  ['C', 'Fullscreen'],
  ['Shift', 'Hold for slow-mo'],
  ['[ ]', 'One circle fewer / more'],
  ['E', 'Equation in fullscreen'],
  ['+ −', 'Zoom in / out'],
  ['0', 'Reset the view'],
  ['Wheel', 'Zoom at the cursor'],
  ['Drag', 'Pan'],
  ['Dbl-click', 'Reset the view'],
];

function prepare(entry) {
  const samples = svgToSamples(entry.svg);
  return { ...entry, samples, thumb: thumbPath(samples) };
}

function loadSamples() {
  return SAMPLES.flatMap((s) => {
    try {
      return [prepare(s)];
    } catch (err) {
      console.warn(`Sample "${s.name}" failed to load`, err);
      return [];
    }
  });
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <g className="spin-a">
          <circle cx="24" cy="24" r="12" />
          <line x1="24" y1="24" x2="36" y2="24" />
          <g className="spin-b">
            <circle cx="36" cy="24" r="6" />
            <line x1="36" y1="24" x2="42" y2="24" />
            <circle className="pen" cx="42" cy="24" r="2.4" />
          </g>
        </g>
      </svg>
    </div>
  );
}

const fmtPct = (a) => `${(a * 100).toFixed(2)}%`;

export default function App() {
  const [shapes, setShapes] = useState(loadSamples);
  const [selectedId, setSelectedId] = useState(() => shapes[0]?.id);
  const [target, setTarget] = useState(0.99);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState({ circles: true, target: true, ghosts: true, heat: false, style: 'cosmic', scale: 'real' });
  const [manualK, setManualK] = useState(null);
  const [run, setRun] = useState({ stageIdx: 0, phase: 'idle', k: 1 });
  const [toast, setToast] = useState(null);
  const [slowLatch, setSlowLatch] = useState(false);
  const [slowHold, setSlowHold] = useState(false);
  const slowmo = slowLatch || slowHold;
  const [order, setOrder] = useState('size');
  const [drawOpen, setDrawOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const recorderRef = useRef(null);
  const shapeNameRef = useRef('');
  const stageRef = useRef(null);
  const liveListeners = useRef(new Set());
  const onFrame = useCallback((t, tip) => liveListeners.current.forEach((fn) => fn(t, tip)), []);
  const [fsEquation, setFsEquation] = useState(true);
  const kRef = useRef({ k: 1, max: 1 });

  // Source of the drawing: a traced shape, or the hand-built series from the equation playground.
  const [sourceTab, setSourceTab] = useState('shapes');
  const [mode, setMode] = useState('shape');
  const [pgTerms, setPgTerms] = useState(defaultTerms);

  const shape = shapes.find((s) => s.id === selectedId) ?? shapes[0];
  const shapeAnalysis = useMemo(() => (shape ? analyze(shape.samples, order) : null), [shape, order]);
  const pgAnalysis = useMemo(() => {
    const samples = seriesSamples(pgTerms);
    if (!samples) return null;
    const an = analyze(samples, order);
    an.playground = true;
    return an;
  }, [pgTerms, order]);
  const inPlayground = mode === 'playground' && pgAnalysis != null;
  const analysis = inPlayground ? pgAnalysis : shapeAnalysis;
  shapeNameRef.current = inPlayground ? 'equation' : shape?.name;
  // A playground series is drawn exactly (every term you entered), not to the accuracy target.
  const stopAt = inPlayground ? 0.999999 : target;
  const stages = useMemo(() => (analysis ? buildSchedule(analysis, stopAt) : []), [analysis, stopAt]);
  const finalK = stages.at(-1)?.k ?? 1;
  const specRange = useMemo(
    () => (analysis ? Math.min(analysis.N / 2, Math.max(12, Math.ceil(maxFreq(analysis, finalK) * 1.2))) : 16),
    [analysis, finalK],
  );

  useEffect(() => setManualK(null), [analysis, target]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);

  const notify = useCallback((msg) => setToast({ msg, id: Date.now() }), []);

  const selectShape = useCallback((id) => {
    setSelectedId(id);
    setMode('shape');
  }, []);

  // Any edit in the playground puts its series on the stage (and keeps morphing it live).
  const editTerms = useCallback((next) => {
    setPgTerms(next);
    setMode('playground');
    setPlaying(true);
  }, []);

  // Traces SVG markup and adds it to the front of the shape list. Returns false on failure.
  const addShape = useCallback(
    (svg, name, badge) => {
      try {
        const entry = prepare({ id: `${badge}-${Date.now()}`, name: name.slice(0, 14) || badge, svg, custom: badge });
        setShapes((prev) => {
          const mine = [entry, ...prev.filter((s) => s.custom)].slice(0, MAX_CUSTOM);
          return [...mine, ...prev.filter((s) => !s.custom)];
        });
        setSelectedId(entry.id);
        setMode('shape');
        setPlaying(true);
        return true;
      } catch (err) {
        notify(err.message || "Couldn't trace that shape.");
        return false;
      }
    },
    [notify],
  );

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        notify('That file is over 4 MB. Try something smaller.');
        return;
      }
      const name = file.name.replace(/\.[a-z0-9]+$/i, '');
      try {
        if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') addShape(await file.text(), name, 'SVG');
        else if (file.type.startsWith('image/')) addShape(await imageToSvg(file), name, 'IMG');
        else notify('Drop an SVG, PNG, JPG or WebP file.');
      } catch (err) {
        notify(err.message || "Couldn't read that image.");
      }
    },
    [addShape, notify],
  );

  const handleText = useCallback(
    async (word) => {
      try {
        addShape(await textToSvg(word), word, 'TEXT');
      } catch (err) {
        notify(err.message || "Couldn't trace that word.");
      }
    },
    [addShape, notify],
  );

  const handleDrawing = useCallback(
    (svg) => {
      const ok = addShape(svg, 'Sketch', 'DRAW');
      if (ok) setDrawOpen(false);
      return ok;
    },
    [addShape],
  );

  // ── video recording: restarts the run, records it, saves a few seconds after the lock ──
  const finishRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecording(null);
    const blob = await rec.stop();
    const slug = (shapeNameRef.current || 'shape').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadBlob(blob, `fourier-forge-${slug}.${rec.extension}`);
    notify(`Saved fourier-forge-${slug}.${rec.extension}`);
  }, [notify]);

  const toggleRecording = useCallback(() => {
    if (recorderRef.current) {
      finishRecording();
      return;
    }
    try {
      recorderRef.current = recordCanvas(stageRef.current.canvas());
    } catch (err) {
      notify(err.message);
      return;
    }
    setRecording({ start: Date.now() });
    setManualK(null);
    setPlaying(true);
    stageRef.current?.restart();
  }, [finishRecording, notify]);

  useEffect(() => {
    if (!recording || run.phase !== 'done') return undefined;
    const id = setTimeout(finishRecording, 3500);
    return () => clearTimeout(id);
  }, [recording, run.phase, finishRecording]);

  const restart = useCallback(() => {
    setManualK(null);
    setPlaying(true);
    stageRef.current?.restart();
  }, []);

  // One circle more / fewer (switches to explorer mode).
  const stepIndex = useCallback((dir) => {
    const { k, max } = kRef.current;
    setManualK(Math.max(1, Math.min(max, k + dir)));
  }, []);

  const stepFrame = useCallback((dir) => {
    setPlaying(false);
    stageRef.current?.step(dir);
  }, []);

  const skip = useCallback(() => {
    setManualK(null);
    setPlaying(true);
    stageRef.current?.skip();
  }, []);

  useEffect(() => {
    const stage = () => stageRef.current;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || drawOpen) return;
      if (e.key === 'Shift') {
        if (!e.repeat) setSlowHold(true);
        return;
      }
      if (e.key === 'Escape') setKeysOpen(false);
      if (e.target.closest?.('input, button, select, textarea')) return;
      const key = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (key === 'r') restart();
      else if (key === 's') skip();
      else if (key === 'f') stage()?.toggleFollow();
      else if (key === 'c') stage()?.toggleFullscreen();
      else if (key === '+' || key === '=') stage()?.zoomIn();
      else if (key === '-' || key === '_') stage()?.zoomOut();
      else if (key === '0') stage()?.resetView();
      else if (key === '[' || key === ']') stepIndex(key === '[' ? -1 : 1);
      else if (key === 'e') setFsEquation((v) => !v);
      else if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        stepFrame(key === 'arrowleft' ? -1 : 1);
      }
    };
    const onKeyUp = (e) => e.key === 'Shift' && setSlowHold(false);
    const onBlur = () => setSlowHold(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [restart, skip, drawOpen, stepIndex, stepFrame]);

  useEffect(() => {
    if (!keysOpen) return undefined;
    const close = (e) => !e.target.closest?.('.keys-wrap') && setKeysOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [keysOpen]);

  if (!shape) return <div className="app">No shapes could be loaded.</div>;

  const manual = manualK != null;
  const activeK = manual ? manualK : run.k;
  const acc = analysis.accAt(activeK);
  const prevAcc = !manual && run.stageIdx > 0 ? stages[run.stageIdx - 1]?.acc : null;
  const locked = !manual && run.phase === 'done';
  const gaugeLabel = locked ? 'locked in' : manual ? 'explorer' : 'match';
  // Terms that joined in the current stage (highlighted in the equation).
  const freshFrom = manual ? activeK : run.stageIdx > 0 ? (stages[run.stageIdx - 1]?.k ?? 0) : 0;
  kRef.current = { k: activeK, max: analysis.count };
  const gain = prevAcc != null ? (acc - prevAcc) * 100 : 0;
  const gainText = `${gain < 0 ? '−' : '+'}${Math.abs(gain).toFixed(2)}% this stage`;
  const delta = manual ? `${activeK} circles` : prevAcc != null ? gainText : 'first circle';

  return (
    <div className="app">
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="blob blob-c" />

      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Fourier Forge</h1>
            <p>Spinning circles that learn to draw any SVG</p>
          </div>
        </div>
        <div className="chips">
          <span className="chip">
            <b>{analysis.N}</b> samples
          </span>
          <span className="chip">
            <b>{analysis.count}</b> epicycles available
          </span>
          <div className="keys-wrap">
            <button type="button" className="chip chip-btn" aria-expanded={keysOpen} onClick={() => setKeysOpen((v) => !v)}>
              <kbd>⌘</kbd> Shortcuts
            </button>
            {keysOpen && (
              <div className="keys-pop" role="dialog" aria-label="Keyboard shortcuts">
                {SHORTCUTS.map(([k, label]) => (
                  <div key={k}>
                    <kbd>{k}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="col col-left">
          <ShapePicker
            shapes={shapes}
            selectedId={inPlayground ? null : shape.id}
            onSelect={selectShape}
            onFile={handleFile}
            onText={handleText}
            onDraw={() => setDrawOpen(true)}
            tab={sourceTab}
            onTab={setSourceTab}
            playground={
              <Playground
                terms={pgTerms}
                onTerms={editTerms}
                active={inPlayground}
                invalid={mode === 'playground' && !pgAnalysis}
                onDraw={() => {
                  if (inPlayground) restart();
                  else {
                    setMode('playground');
                    setPlaying(true);
                  }
                }}
                onImport={() => shapeAnalysis && editTerms(termsFromAnalysis(shapeAnalysis))}
              />
            }
          />
          <Controls
            playing={playing}
            onPlay={() => setPlaying((p) => !p)}
            onRestart={restart}
            onSkip={skip}
            speed={speed}
            onSpeed={setSpeed}
            slowmo={slowmo}
            onSlowmo={() => setSlowLatch((v) => !v)}
            target={target}
            onTarget={setTarget}
            order={order}
            onOrder={setOrder}
            view={view}
            onView={setView}
            recording={recording}
            onRecord={toggleRecording}
          />
        </aside>

        <section className="col col-center">
          <EpicycleStage
            ref={stageRef}
            analysis={analysis}
            stages={stages}
            speed={speed}
            playing={playing}
            slowmo={slowmo}
            view={view}
            manualK={manualK}
            run={run}
            acc={acc}
            recording={recording}
            onRun={setRun}
            onPause={() => setPlaying(false)}
            onFrame={onFrame}
            fullscreenUi={
              <>
                {fsEquation && <EquationStrip analysis={analysis} k={activeK} freshFrom={freshFrom} live={liveListeners} />}
                <FullscreenDock
                  playing={playing}
                  onPlay={() => setPlaying((p) => !p)}
                  onRestart={restart}
                  onStepFrame={stepFrame}
                  speed={speed}
                  onSpeed={setSpeed}
                  slowmo={slowmo}
                  onSlowmo={() => setSlowLatch((v) => !v)}
                  k={activeK}
                  maxK={analysis.count}
                  acc={acc}
                  manual={manual}
                  onStepIndex={stepIndex}
                  onAuto={restart}
                  showEquation={fsEquation}
                  onToggleEquation={() => setFsEquation((v) => !v)}
                  recording={recording}
                  onRecord={toggleRecording}
                />
              </>
            }
          />
          <EquationPanel analysis={analysis} k={activeK} freshFrom={freshFrom} live={liveListeners} />
          <Explorer analysis={analysis} manualK={manualK} autoK={run.k} onManual={setManualK} onAuto={restart} />
        </section>

        <aside className="col col-right">
          <section className="panel" style={{ '--accent': 'var(--lime)' }}>
            <h2>Accuracy</h2>
            <AccuracyGauge value={acc} target={target} locked={locked} label={gaugeLabel} />
            <div className="gauge-meta">
              <span className="pill pill-up">{delta}</span>
              <span className="pill">{inPlayground ? 'exact series' : `target ${fmtPct(target)}`}</span>
            </div>
          </section>

          <section className="panel" style={{ '--accent': 'var(--cyan)' }}>
            <h2>Convergence</h2>
            <Convergence stages={stages} reached={run.stageIdx} target={target} />
          </section>

          <section className="panel" style={{ '--accent': 'var(--pink)' }}>
            <h2>Spectrum</h2>
            <Spectrum analysis={analysis} k={activeK} range={specRange} />
            <dl className="stats">
              <div>
                <dt>Outlines</dt>
                <dd>{shape.samples.contours}</dd>
              </div>
              <div>
                <dt>Top speed</dt>
                <dd>{maxFreq(analysis, activeK)}×/lap</dd>
              </div>
              <div>
                <dt>Stages</dt>
                <dd>{stages.length}</dd>
              </div>
              <div>
                <dt>Worst miss</dt>
                <dd>{((1 - acc) * 100).toFixed(2)}%</dd>
              </div>
            </dl>
          </section>
        </aside>
      </main>

      {drawOpen && <DrawPad onDone={handleDrawing} onClose={() => setDrawOpen(false)} />}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
