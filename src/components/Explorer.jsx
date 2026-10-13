// Log-scaled scrubber over the number of epicycles; touching it switches the stage to explorer mode.
export default function Explorer({ analysis, manualK, autoK, onManual, onAuto }) {
  const max = analysis?.count ?? 1;
  const k = manualK ?? autoK;
  const logMax = Math.log(Math.max(2, max));
  const toSlider = (n) => Math.round((1000 * Math.log(Math.max(1, n))) / logMax);
  const fromSlider = (v) => Math.max(1, Math.min(max, Math.round(Math.exp((v / 1000) * logMax))));
  const pos = toSlider(k);
  const acc = analysis ? analysis.accAt(k) : 0;

  return (
    <section className="panel explorer" style={{ '--accent': 'var(--amber)' }}>
      <div className="explorer-head">
        <h2>Epicycle explorer</h2>
        {manualK != null ? (
          <button type="button" className="btn btn-cyan btn-sm" onClick={onAuto}>
            Resume auto run
          </button>
        ) : (
          <span className="hint">drag to add or remove circles by hand</span>
        )}
      </div>
      <div className="explorer-row">
        <input
          type="range"
          className="range range-amber"
          min="0"
          max="1000"
          value={pos}
          style={{ '--fill': `${pos / 10}%` }}
          onChange={(e) => onManual(fromSlider(Number(e.target.value)))}
          aria-label="Number of epicycles"
        />
        <div className="readout">
          <b>{k}</b>
          <span>circles</span>
        </div>
        <div className="readout">
          <b>{(acc * 100).toFixed(2)}%</b>
          <span>match</span>
        </div>
      </div>
    </section>
  );
}
