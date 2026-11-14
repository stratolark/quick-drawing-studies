import { describe, it, expect } from 'vitest';
import { analyzeGesture, ANALYSIS_STATUS, GESTURE_TOLERANCES } from '../src/analysis/gesture.js';

const CANVAS = { w: 750, h: 1000 };
const REF = { width: 750, height: 1000 };

/* A C-shaped line of action from head to foot, bowing to the viewer's left. */
function cCurve(n = 40, bow = 110) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push([400 - 20 * t - bow * Math.sin(Math.PI * t), 120 + 760 * t]);
  }
  return pts;
}
const REF_LINE = cCurve();
const reference = Object.assign({ actionLine: REF_LINE }, REF);

const stroke = (pairs, extra) =>
  Object.assign({ tool: 'pen', erase: false, pts: pairs.map(([x, y]) => ({ x, y, p: 0.6 })) }, extra);
const map = (pairs, f) => pairs.map(([x, y]) => f(x, y));
const center = pairs => {
  let x = 0,
    y = 0;
  for (const p of pairs) {
    x += p[0];
    y += p[1];
  }
  return [x / pairs.length, y / pairs.length];
};
function rotate(pairs, deg) {
  const [cx, cy] = center(pairs);
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return map(pairs, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}
function mirrorX(pairs) {
  const [cx] = center(pairs);
  return map(pairs, (x, y) => [2 * cx - x, y]);
}
/* Deterministic noise so tests never flake. */
function jitter(pairs, amp) {
  let s = 7;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  return map(pairs, (x, y) => [x + r() * 2 * amp, y + r() * 2 * amp]);
}

const run = (strokes, extra) => analyzeGesture(Object.assign({ strokes, reference, canvas: CANVAS }, extra));

describe('gesture analysis', () => {
  it('measures an identical line as a match', () => {
    const a = run([stroke(REF_LINE)]);
    expect(a.status).toBe(ANALYSIS_STATUS.measured);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(0.5);
    expect(a.metrics.bowError).toBeLessThan(0.01);
    expect(a.metrics.shapeError).toBeLessThan(0.02);
    expect(a.metrics.curvatureDirectionMatch).toBe(true);
    expect(a.metrics.refCurveType).toBe('C');
  });

  it('ignores translation', () => {
    const a = run([stroke(map(REF_LINE, (x, y) => [x + 150, y - 60]))]);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(0.5);
    expect(a.metrics.shapeError).toBeLessThan(0.02);
  });

  it('ignores uniform scale', () => {
    const [cx, cy] = center(REF_LINE);
    const a = run([stroke(map(REF_LINE, (x, y) => [cx + (x - cx) * 0.55, cy + (y - cy) * 0.55]))]);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(0.5);
    expect(a.metrics.bowError).toBeLessThan(0.01);
    expect(a.metrics.shapeError).toBeLessThan(0.02);
  });

  it('treats a reversed stroke as the same line', () => {
    const a = run([stroke(REF_LINE.slice().reverse())]);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(0.5);
    expect(a.metrics.curvatureDirectionMatch).toBe(true);
    expect(a.metrics.shapeError).toBeLessThan(0.02);
  });

  it('keeps a tilt error instead of rotating it away', () => {
    const a = run([stroke(rotate(REF_LINE, 25))]);
    expect(a.metrics.orientationErrorDeg).toBeGreaterThan(22);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(28);
    expect(a.metrics.orientationDeltaDeg).toBeGreaterThan(0); // clockwise on screen
    const b = run([stroke(rotate(REF_LINE, -18))]);
    expect(b.metrics.orientationDeltaDeg).toBeLessThan(-15);
  });

  it('keeps a mirrored bend instead of flipping it to match', () => {
    const a = run([stroke(mirrorX(REF_LINE))]);
    expect(a.metrics.curvatureDirectionMatch).toBe(false);
    expect(a.metrics.bowError).toBeGreaterThan(0.2);
  });

  it('reports a line drawn too straight', () => {
    const a = run([
      stroke([
        [400, 120],
        [380, 880],
      ]),
    ]);
    expect(a.metrics.drawnCurveType).toBe('straight');
    expect(a.metrics.curvatureDirectionMatch).toBe(null);
    expect(a.metrics.bowError).toBeGreaterThan(GESTURE_TOLERANCES.bow);
  });

  it('stays within tolerance for a noisy but faithful line', () => {
    const a = run([stroke(jitter(REF_LINE, 6))]);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(GESTURE_TOLERANCES.orientationDeg);
    expect(a.metrics.curvatureDirectionMatch).toBe(true);
    expect(a.metrics.bowError).toBeLessThan(GESTURE_TOLERANCES.bow);
  });

  it('picks the long main line over short limb strokes, wherever it is in the order', () => {
    const limbs = [
      stroke([
        [300, 300],
        [360, 360],
      ]),
      stroke([
        [420, 500],
        [500, 540],
      ]),
      stroke([
        [350, 700],
        [330, 780],
      ]),
    ];
    const a = run([limbs[0], limbs[1], stroke(rotate(REF_LINE, 12)), limbs[2]]);
    expect(a.status).toBe(ANALYSIS_STATUS.measured);
    expect(a.metrics.orientationErrorDeg).toBeGreaterThan(9);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(15);
  });

  it('joins a main line drawn in two pulls', () => {
    const half = Math.floor(REF_LINE.length / 2);
    const a = run([stroke(REF_LINE.slice(0, half + 1)), stroke(REF_LINE.slice(half))]);
    expect(a.selection.candidates.length).toBeGreaterThan(2);
    expect(a.metrics.orientationErrorDeg).toBeLessThan(1);
    expect(a.metrics.shapeError).toBeLessThan(0.05);
  });

  it('flags two equally plausible lines at different angles as ambiguous, and honours the learner pick', () => {
    const vertical = [
      [380, 120],
      [380, 880],
    ];
    const tilted = [
      [620, 150],
      [160, 860],
    ];
    const a = run([stroke(vertical), stroke(tilted)]);
    expect(a.status).toBe(ANALYSIS_STATUS.ambiguous);
    expect(a.selection.source).toBe('auto');
    const other = a.selection.candidates.find(c => c.index !== a.selection.index).index;
    const b = run([stroke(vertical), stroke(tilted)], { selection: other });
    expect(b.status).toBe(ANALYSIS_STATUS.measured);
    expect(b.selection.source).toBe('user');
    expect(b.metrics.orientationErrorDeg).not.toBe(a.metrics.orientationErrorDeg);
  });

  it('reports an empty drawing', () => {
    expect(run([]).status).toBe(ANALYSIS_STATUS.empty);
    expect(run([stroke(REF_LINE), { tool: 'clear' }]).status).toBe(ANALYSIS_STATUS.empty);
    expect(run([stroke(REF_LINE, { erase: true })]).status).toBe(ANALYSIS_STATUS.empty);
  });

  it('reports missing reference metadata instead of guessing', () => {
    const a = analyzeGesture({ strokes: [stroke(REF_LINE)], reference: { width: 750, height: 1000 }, canvas: CANVAS });
    expect(a.status).toBe(ANALYSIS_STATUS.unavailable);
    expect(a.metrics).toEqual({});
    expect(analyzeGesture({ strokes: [stroke(REF_LINE)], reference: null, canvas: CANVAS }).status).toBe(
      ANALYSIS_STATUS.unavailable,
    );
  });

  it('does not read a scribble as a line of action', () => {
    const scribble = [];
    for (let i = 0; i < 60; i++) {
      scribble.push([300 + (i % 2) * 200, 200 + i * 4]);
    }
    expect(run([stroke(scribble)]).status).toBe(ANALYSIS_STATUS.unavailable);
  });

  it('scales reference coordinates into canvas coordinates', () => {
    const small = Object.assign({ actionLine: map(REF_LINE, (x, y) => [x / 2, y / 2]) }, { width: 375, height: 500 });
    const a = analyzeGesture({ strokes: [stroke(REF_LINE)], reference: small, canvas: CANVAS });
    expect(a.metrics.shapeError).toBeLessThan(0.02);
    expect(a.annotations[0].points[0][1]).toBeCloseTo(120, 0);
  });
});
