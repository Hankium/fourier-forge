import { useMemo } from 'react';
import { tex } from '../lib/equationTex.js';
import { F_RANGE, MAX_TERMS, PRESETS, blankTerm, randomTerms, termsTex } from '../lib/playground.js';

const FIELDS = [
  { key: 'r', label: 'r', title: 'Radius', min: 0, max: 100, step: 0.5, unit: '' },
  { key: 'f', label: 'f', title: 'Turns per lap (negative spins the other way)', min: -F_RANGE, max: F_RANGE, step: 1, unit: '' },
  { key: 'p', label: 'φ', title: 'Starting angle in degrees', min: 0, max: 360, step: 1, unit: '°' },
];

function clampField(field, raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  if (field.key === 'f') return Math.max(-200, Math.min(200, Math.round(v)));
  if (field.key === 'p') return ((v % 360) + 360) % 360;
  return Math.max(0, Math.min(10000, v));
}

function TermCard({ term, index, onChange, onRemove, canRemove }) {
  return (
    <div className="pg-term">
      <div className="pg-term-head">
        <span className="pg-idx">{index + 1}</span>
        <span className="pg-term-name">Circle {index + 1}</span>
        <button type="button" className="pg-remove" onClick={onRemove} disabled={!canRemove} aria-label={`Remove circle ${index + 1}`}>
          ×
        </button>
      </div>
      {FIELDS.map((field) => {
        const value = term[field.key];
        const sliderValue = Math.max(field.min, Math.min(field.max, value));
        const fill = ((sliderValue - field.min) / (field.max - field.min)) * 100;
        return (
          <label key={field.key} className="pg-row" title={field.title}>
            <span className="pg-label">{field.label}</span>
            <input
              type="range"
              className="range pg-range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={sliderValue}
              style={{ '--fill': `${fill}%` }}
              onChange={(e) => onChange({ ...term, [field.key]: Number(e.target.value) })}
              aria-label={`${field.title}, circle ${index + 1}`}
            />
            <span className="pg-num">
              <input
                type="number"
                step={field.step}
                value={value}
                onChange={(e) => {
                  const v = clampField(field, e.target.value);
                  if (v != null) onChange({ ...term, [field.key]: v });
                }}
                aria-label={`${field.title}, circle ${index + 1} (exact)`}
              />
              {field.unit}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function Playground({ terms, onTerms, active, invalid, onDraw, onImport }) {
  const formula = useMemo(() => tex(termsTex(terms)), [terms]);
  const update = (i, term) => onTerms(terms.map((t, j) => (j === i ? term : t)));

  return (
    <div className="pg">
      <p className="pg-intro">
        Each circle is one term <i>r·e</i>
        <sup>
          <i>i(2πft + φ)</i>
        </sup>
        . Change a number and the stage redraws live.
      </p>

      <div className="pg-presets">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="pg-chip" onClick={() => onTerms(p.make())}>
            {p.name}
          </button>
        ))}
        <button type="button" className="pg-chip" onClick={() => onTerms(randomTerms())}>
          Random
        </button>
        <button type="button" className="pg-chip pg-chip-alt" onClick={onImport} title="Start from the biggest circles of the selected shape">
          From shape
        </button>
      </div>

      <div className="pg-formula" dangerouslySetInnerHTML={{ __html: formula }} />
      {invalid && <p className="pg-warn">Nothing moves yet: give a circle a radius above 0 and a speed f ≠ 0.</p>}
      {active && !invalid && <p className="pg-live">● Live on the stage</p>}

      <div className="pg-terms">
        {terms.map((t, i) => (
          <TermCard
            key={t.id}
            term={t}
            index={i}
            onChange={(next) => update(i, next)}
            onRemove={() => onTerms(terms.filter((_, j) => j !== i))}
            canRemove={terms.length > 1}
          />
        ))}
      </div>

      <div className="pg-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onTerms([...terms, blankTerm(terms)])}
          disabled={terms.length >= MAX_TERMS}
        >
          + Add circle
        </button>
        <button type="button" className="btn btn-pink btn-sm" onClick={onDraw}>
          {active ? '↺ Replay build-up' : '▶ Draw it'}
        </button>
      </div>
    </div>
  );
}
