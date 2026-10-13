import { useState } from 'react';

export default function ShapePicker({ shapes, selectedId, onSelect, onFile, onText, onDraw, tab, onTab, playground }) {
  const [dragging, setDragging] = useState(false);
  const [word, setWord] = useState('');

  const drop = (e) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files?.[0]);
  };

  return (
    <section className="panel" style={{ '--accent': 'var(--pink)' }}>
      <div className="panel-tabs">
        <h2>{tab === 'equation' ? 'Your equation' : 'Target shape'}</h2>
        <div className="seg seg-tabs" role="tablist" aria-label="Source">
          {[
            ['shapes', 'Shapes'],
            ['equation', 'Equation'],
          ].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => onTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'equation' ? playground : <ShapeSource {...{ dragging, setDragging, drop, word, setWord, onFile, onText, onDraw, shapes, selectedId, onSelect }} />}
    </section>
  );
}

function ShapeSource({ dragging, setDragging, drop, word, setWord, onFile, onText, onDraw, shapes, selectedId, onSelect }) {
  return (
    <>
      <label
        className={`drop${dragging ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <input
          type="file"
          accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <span className="drop-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14" />
          </svg>
        </span>
        <strong>Drop an SVG or image</strong>
        <span className="drop-sub">or click to browse · SVG paths, or PNG / JPG silhouettes and logos</span>
      </label>

      <form
        className="word-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (word.trim()) onText(word.trim());
        }}
      >
        <input
          className="text-input"
          value={word}
          maxLength={14}
          placeholder="Type a word…"
          aria-label="Word to trace"
          onChange={(e) => setWord(e.target.value)}
        />
        <button type="submit" className="btn btn-violet btn-sm" disabled={!word.trim()}>
          Trace
        </button>
      </form>

      <button type="button" className="btn btn-ghost btn-draw" onClick={onDraw}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
          <path d="M4 20l4.2-1 10.3-10.3a2.1 2.1 0 0 0-3-3L5.2 16 4 20zM13.8 7.2l3 3" />
        </svg>
        Draw your own
      </button>

      <div className="tiles" role="listbox" aria-label="Shapes">
        {shapes.map((s) => (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={s.id === selectedId}
            className={`tile${s.id === selectedId ? ' active' : ''}`}
            onClick={() => onSelect(s.id)}
            title={s.name}
          >
            {s.custom && <em className="tile-badge">{s.custom}</em>}
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path d={s.thumb} />
            </svg>
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
