import { useMemo } from 'react';
import { expansionTex, generalTex, tex } from '../lib/equationTex.js';
import { useLiveReadout } from '../lib/useLiveReadout.js';

// The series currently being drawn, typeset with its real coefficients (SVG units).
export default function EquationPanel({ analysis, k, freshFrom, live }) {
  const firstWord = analysis.order === 'freq' ? 'Slowest' : 'Biggest';
  const { tRef, zRef } = useLiveReadout(live);

  const general = useMemo(() => tex(generalTex(k), true), [k]);
  const expanded = useMemo(() => tex(expansionTex(analysis, k, freshFrom)), [analysis, k, freshFrom]);
  const where = useMemo(
    () => ({
      coeffs: tex(
        `r_n e^{i\\varphi_n} = \\frac{1}{N}\\sum_{j=0}^{N-1} z_j\\, e^{-2\\pi i f_n j / N}, \\quad N = ${analysis.N}`,
      ),
      accuracy: tex(`\\text{accuracy} = 1 - \\frac{\\max_j \\lvert z(j/N) - z_j \\rvert}{R_{\\text{rms}}}`),
    }),
    [analysis.N],
  );

  return (
    <section className="panel equation" style={{ '--accent': 'var(--cyan)' }}>
      <div className="eq-head">
        <h2>The equation</h2>
        <div className="eq-live" aria-live="off">
          <span className="pill">
            t = <b ref={tRef}>0.000</b>
          </span>
          <span className="pill">
            z(t) = <b ref={zRef}>0</b>
          </span>
        </div>
      </div>

      <div className="eq-main" dangerouslySetInnerHTML={{ __html: general }} />

      <div className="eq-expand" dangerouslySetInnerHTML={{ __html: expanded }} />
      <p className="eq-legend">
        Each term is one circle: radius <i>r</i>, spinning <i>f</i> turns per lap, starting at angle <i>φ</i>. {firstWord} circles
        first; <span className="eq-new">green</span> terms joined this stage. SVG units, y points down.
      </p>

      <div className="eq-where">
        <div>
          <span className="eq-label">Coefficients · DFT of the traced outline</span>
          <div dangerouslySetInnerHTML={{ __html: where.coeffs }} />
        </div>
        <div>
          <span className="eq-label">Accuracy · worst miss vs. shape size</span>
          <div dangerouslySetInnerHTML={{ __html: where.accuracy }} />
        </div>
      </div>
    </section>
  );
}
