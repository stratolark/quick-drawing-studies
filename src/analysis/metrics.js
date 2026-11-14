/* One table describing every metric the analyses produce: label, unit, which direction is better, and the
   smallest change reported as a real difference between two attempts. Change thresholds are set by
   judgment from synthetic tests, not validated against human ratings (2026-11-14). */
import { EVALUATOR } from '../learning/curriculum.js';
import { GESTURE_ANALYSIS_VERSION, GESTURE_TOLERANCES } from './gesture.js';
import { SHAPES_ANALYSIS_VERSION, SHAPE_TOLERANCES } from './shapes.js';
import { VALUES_ANALYSIS_VERSION, VALUE_TOLERANCES } from './values.js';

export const BETTER = Object.freeze({ lower: 'lower', higher: 'higher' });

const pct = v => Math.round(v * 100) + '%';
const deg = v => Math.round(v) + '°';

/* value(metrics) derives the comparable number; a null result means "not measured this time". */
export const METRICS = {
  [EVALUATOR.gestureLine]: {
    version: GESTURE_ANALYSIS_VERSION,
    rows: [
      { key: 'orientationErrorDeg', label: 'Main-line tilt error', better: BETTER.lower, change: 4, tolerance: GESTURE_TOLERANCES.orientationDeg, format: deg, value: m => m.orientationErrorDeg },
      { key: 'bowError', label: 'Bend difference', better: BETTER.lower, change: 0.03, tolerance: GESTURE_TOLERANCES.bow, format: pct, value: m => m.bowError },
      { key: 'shapeError', label: 'Overall line shape difference', better: BETTER.lower, change: 0.08, tolerance: GESTURE_TOLERANCES.shapeError, format: v => v.toFixed(2), value: m => m.shapeError },
    ],
    primary: 'orientationErrorDeg',
  },
  [EVALUATOR.shapeSilhouette]: {
    version: SHAPES_ANALYSIS_VERSION,
    rows: [
      { key: 'aspectError', label: 'Height-to-width ratio error', better: BETTER.lower, change: 0.05, tolerance: SHAPE_TOLERANCES.aspectError, format: pct, value: m => (m.aspectError == null ? null : Math.abs(m.aspectError)) },
      { key: 'overlap', label: 'Silhouette overlap', better: BETTER.higher, change: 0.06, tolerance: SHAPE_TOLERANCES.overlap, format: pct, value: m => m.overlap },
    ],
    primary: 'aspectError',
  },
  [EVALUATOR.valueMasses]: {
    version: VALUES_ANALYSIS_VERSION,
    rows: [
      { key: 'darkCoverage', label: 'Dark area mismatch', better: BETTER.lower, change: 0.15, tolerance: Math.log(VALUE_TOLERANCES.darkCoverageRatio[1]), format: v => '×' + Math.exp(v).toFixed(1), value: m => (m.darkCoverageRatio ? Math.abs(Math.log(m.darkCoverageRatio)) : null) },
      { key: 'darkCentroidOffset', label: 'Dark mass offset', better: BETTER.lower, change: 0.04, tolerance: VALUE_TOLERANCES.darkCentroidOffset, format: pct, value: m => m.darkCentroidOffset },
      { key: 'toneAgreement', label: 'Tone agreement', better: BETTER.higher, change: 0.05, tolerance: null, format: pct, value: m => m.toneAgreement },
    ],
    primary: 'darkCoverage',
  },
  [EVALUATOR.none]: { version: null, rows: [], primary: null },
};

export function metricRows(evaluator) { return (METRICS[evaluator] || METRICS[EVALUATOR.none]).rows; }

export function withinTolerance(row, v) {
  if (v == null || row.tolerance == null) return null;
  return row.better === BETTER.lower ? v <= row.tolerance : v >= row.tolerance;
}

/* Measured facts in display form, for the review screen and the AI request. */
export function evidenceFor(analysis) {
  if (!analysis || !analysis.metrics) return [];
  return metricRows(analysis.evaluator)
    .map(r => { const v = r.value(analysis.metrics); return v == null ? null : { key: r.key, label: r.label, value: Math.round(v * 1000) / 1000, display: r.format(v), better: r.better, tolerance: r.tolerance, toleranceDisplay: r.tolerance == null ? null : r.format(r.tolerance), within: withinTolerance(r, v) }; })
    .filter(Boolean);
}
