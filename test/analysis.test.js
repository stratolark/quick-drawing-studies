import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { analyzeShapes } from '../src/analysis/shapes.js';
import { analyzeValues, otsu3, TONE } from '../src/analysis/values.js';
import { tonesFromRGBA, maskFromRGBA } from '../src/analysis/raster.js';
import { analyzeGesture, ANALYSIS_STATUS } from '../src/analysis/gesture.js';
import { rankIssues } from '../src/analysis/issues.js';
import { compareAnalyses, VERDICT } from '../src/analysis/compare.js';
import { evidenceFor } from '../src/analysis/metrics.js';
import { OBJECTIVES } from '../src/learning/curriculum.js';
import { horizon, vanishingPoint, maskBBox } from '../src/refs/projection.js';

function rectMask(w, h, x0, y0, x1, y1) {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      m[y * w + x] = 1;
    }
  }
  return m;
}

describe('shape analysis', () => {
  const W = 60,
    H = 80;
  const ref = { mask: rectMask(W, H, 20, 10, 40, 70), w: W, h: H }; // 20 wide, 60 tall

  it('matches the same silhouette drawn smaller and shifted', () => {
    const drawn = { mask: rectMask(W, H, 5, 5, 15, 35), w: W, h: H };
    const a = analyzeShapes({ ref, drawn });
    expect(a.status).toBe(ANALYSIS_STATUS.measured);
    expect(Math.abs(a.metrics.aspectError)).toBeLessThan(0.05);
    expect(a.metrics.overlap).toBeGreaterThan(0.85);
  });

  it('reports a silhouette that is too wide for its height', () => {
    const drawn = { mask: rectMask(W, H, 10, 10, 50, 70), w: W, h: H };
    const a = analyzeShapes({ ref, drawn });
    expect(a.metrics.aspectError).toBeLessThan(-0.4);
    const issues = rankIssues(a, OBJECTIVES['shape.silhouette']);
    expect(issues.primary.id).toBe('shapes.proportion');
    expect(issues.primary.measured).toMatch(/shorter and wider/);
  });

  it('works when the drawn grid has a different resolution with the same aspect', () => {
    const drawn = { mask: rectMask(120, 160, 40, 20, 80, 140), w: 120, h: 160 };
    const a = analyzeShapes({ ref, drawn });
    expect(Math.abs(a.metrics.aspectError)).toBeLessThan(0.05);
    expect(a.metrics.overlap).toBeGreaterThan(0.85);
  });

  it('reports missing silhouettes and empty drawings honestly', () => {
    expect(analyzeShapes({ ref: null, drawn: null }).status).toBe(ANALYSIS_STATUS.unavailable);
    expect(analyzeShapes({ ref, drawn: { mask: new Uint8Array(W * H), w: W, h: H } }).status).toBe(
      ANALYSIS_STATUS.empty,
    );
  });
});

describe('values analysis', () => {
  const W = 20,
    H = 10;
  /* Reference: light background, mid band, dark block on the right. */
  function refLum() {
    const l = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        l[y * W + x] = x >= 15 ? 0.15 : x >= 8 ? 0.55 : 0.9;
      }
    }
    return l;
  }
  function tones(darkFrom, midFrom) {
    const t = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        t[y * W + x] = x >= darkFrom ? TONE.dark : x >= midFrom ? TONE.mid : TONE.light;
      }
    }
    return t;
  }

  it('splits luminance into three groups from the image itself', () => {
    const [t1, t2] = otsu3(refLum());
    expect(t1).toBeGreaterThan(0.15);
    expect(t1).toBeLessThan(0.55);
    expect(t2).toBeGreaterThan(0.55);
    expect(t2).toBeLessThan(0.9);
  });

  it('agrees fully with a faithful three-value study', () => {
    const a = analyzeValues({ refLum: refLum(), drawnTones: tones(15, 8), w: W, h: H });
    expect(a.metrics.toneAgreement).toBe(1);
    expect(a.metrics.darkCoverageRatio).toBe(1);
    expect(a.metrics.darkCentroidOffset).toBe(0);
    expect(rankIssues(a, OBJECTIVES['values.three-values']).primary).toBe(null);
  });

  it('flags too little dark and darks on the wrong side', () => {
    const few = analyzeValues({ refLum: refLum(), drawnTones: tones(19, 8), w: W, h: H });
    expect(rankIssues(few, OBJECTIVES['values.three-values']).primary.id).toBe('values.dark-coverage');
    const wrongSide = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 5; x++) {
        wrongSide[y * W + x] = TONE.dark;
      }
    }
    const w = analyzeValues({ refLum: refLum(), drawnTones: wrongSide, w: W, h: H, lightSide: 'left' });
    const issues = rankIssues(w, OBJECTIVES['values.light-direction']);
    expect(issues.primary.id).toBe('values.dark-placement');
    expect(issues.primary.measured).toMatch(/to the left/);
  });

  it('treats an almost blank study as empty', () => {
    expect(analyzeValues({ refLum: refLum(), drawnTones: new Uint8Array(W * H), w: W, h: H }).status).toBe(
      ANALYSIS_STATUS.empty,
    );
  });

  it('reads drawing pixels as paper, mid or dark', () => {
    // transparent, mid grey #9a9da3, dark #3a3d44 (premultiplied at full alpha)
    const px = new Uint8ClampedArray([0, 0, 0, 0, 0x9a, 0x9d, 0xa3, 255, 0x3a, 0x3d, 0x44, 255]);
    expect([...tonesFromRGBA(px)]).toEqual([TONE.light, TONE.mid, TONE.dark]);
    expect([...maskFromRGBA(px)]).toEqual([0, 1, 1]);
  });
});

describe('issue ranking', () => {
  const line = n =>
    Array.from({ length: n }, (_, i) => [400 - 110 * Math.sin((Math.PI * i) / (n - 1)), 120 + (760 * i) / (n - 1)]);
  const reference = { actionLine: line(30), width: 750, height: 1000 };
  const stroke = pairs => ({ tool: 'pen', erase: false, pts: pairs.map(([x, y]) => ({ x, y })) });
  const rotated = deg => {
    const a = (deg * Math.PI) / 180;
    return line(30).map(([x, y]) => [
      375 + (x - 375) * Math.cos(a) - (y - 500) * Math.sin(a),
      500 + (x - 375) * Math.sin(a) + (y - 500) * Math.cos(a),
    ]);
  };

  it('puts the issue matching the objective first', () => {
    // A tilted line that is also too straight: tilt matters most for the torso-tilt objective.
    const straightTilted = [
      [400, 120],
      [46, 880],
    ]; // about 25° of tilt and no bend: two comparable issues
    const a = analyzeGesture({ strokes: [stroke(straightTilted)], reference, canvas: { w: 750, h: 1000 } });
    expect(rankIssues(a, OBJECTIVES['gesture.torso-tilt']).primary.id).toBe('gesture.orientation');
    // Without a focus metric the larger measured error wins.
    const unfocused = rankIssues(a, OBJECTIVES['gesture.line-of-action']);
    expect(unfocused.primary.focus).toBe(false);
    expect(unfocused.primary.rank).toBeGreaterThanOrEqual(unfocused.others[0].rank);
  });

  it('gives no correction when everything is within tolerance', () => {
    const a = analyzeGesture({ strokes: [stroke(line(30))], reference, canvas: { w: 750, h: 1000 } });
    const r = rankIssues(a, OBJECTIVES['gesture.line-of-action']);
    expect(r.measurable).toBe(true);
    expect(r.primary).toBe(null);
  });

  it('produces a retry objective that reverses the measured tilt', () => {
    const a = analyzeGesture({ strokes: [stroke(rotated(20))], reference, canvas: { w: 750, h: 1000 } });
    const p = rankIssues(a, OBJECTIVES['gesture.torso-tilt']).primary;
    expect(p.measured).toMatch(/clockwise/);
    expect(p.objective).toMatch(/counter-clockwise/);
    expect(p.objective).toMatch(/top of the line further left/);
  });

  it('does not invent issues for unmeasurable attempts', () => {
    expect(
      rankIssues(
        { status: ANALYSIS_STATUS.unavailable, evaluator: 'gesture-line', metrics: {} },
        OBJECTIVES['gesture.line-of-action'],
      ),
    ).toEqual({ primary: null, others: [], measurable: false });
  });
});

describe('before-and-after comparison', () => {
  const ref = {
    actionLine: Array.from({ length: 30 }, (_, i) => [400 - 100 * Math.sin((Math.PI * i) / 29), 120 + (760 * i) / 29]),
    width: 750,
    height: 1000,
  };
  const go = pairs =>
    analyzeGesture({
      strokes: [{ tool: 'pen', pts: pairs.map(([x, y]) => ({ x, y })) }],
      reference: ref,
      canvas: { w: 750, h: 1000 },
    });
  const tilt = deg =>
    ref.actionLine.map(([x, y]) => {
      const a = (deg * Math.PI) / 180;
      return [
        375 + (x - 375) * Math.cos(a) - (y - 500) * Math.sin(a),
        500 + (x - 375) * Math.sin(a) + (y - 500) * Math.cos(a),
      ];
    });

  it('reports a measured improvement', () => {
    const c = compareAnalyses(go(tilt(22)), go(tilt(5)));
    expect(c.comparable).toBe(true);
    expect(c.rows.find(r => r.key === 'orientationErrorDeg').verdict).toBe(VERDICT.improved);
  });
  it('calls small changes similar instead of congratulating', () => {
    const c = compareAnalyses(go(tilt(14)), go(tilt(12)));
    expect(c.rows.find(r => r.key === 'orientationErrorDeg').verdict).toBe(VERDICT.similar);
  });
  it('reports a measured regression', () => {
    expect(compareAnalyses(go(tilt(3)), go(tilt(20))).rows.find(r => r.key === 'orientationErrorDeg').verdict).toBe(
      VERDICT.worse,
    );
  });
  it('refuses to compare unmeasured attempts', () => {
    const c = compareAnalyses({ status: ANALYSIS_STATUS.empty }, go(tilt(3)));
    expect(c.comparable).toBe(false);
    expect(c.rows).toEqual([]);
  });
  it('lists evidence with tolerances for display and the AI request', () => {
    const e = evidenceFor(go(tilt(20)));
    const o = e.find(x => x.key === 'orientationErrorDeg');
    expect(o.within).toBe(false);
    expect(o.display).toMatch(/°$/);
  });
});

describe('reference projection metadata', () => {
  const cam = (pos, target, fov = 50) => {
    const c = new T.PerspectiveCamera(fov, 4 / 3, 0.1, 100);
    c.position.set(...pos);
    c.lookAt(new T.Vector3(...target));
    c.updateMatrixWorld(true);
    return c;
  };

  it('puts the horizon at the image centre for a level camera', () => {
    const h = horizon(cam([0, 1.6, 5], [0, 1.6, 0]), 1000, 750);
    expect(h.y).toBeCloseTo(375, 3);
    expect(h.inFrame).toBe(true);
    expect(Math.abs(h.rollDeg)).toBeLessThan(1e-6);
  });

  it('moves the horizon up when the camera looks down', () => {
    const h = horizon(cam([0, 5, 5], [0, 0, 0]), 1000, 750);
    expect(h.y).toBeLessThan(375);
  });

  it('puts the vanishing point of the view direction at the image centre', () => {
    const c = cam([0, 1.6, 5], [0, 1.6, 0]);
    const vp = vanishingPoint(c, new T.Vector3(0, 0, -1), 1000, 750);
    expect(vp[0]).toBeCloseTo(500, 3);
    expect(vp[1]).toBeCloseTo(375, 3);
    expect(vanishingPoint(c, new T.Vector3(1, 0, 0), 1000, 750)).toBe(null);
  });

  it('measures a mask bounding box in full-image pixels', () => {
    const m = rectMask(10, 10, 2, 3, 6, 9);
    expect(maskBBox(m, 10, 10, 4)).toEqual({ x: 8, y: 12, w: 16, h: 24 });
    expect(maskBBox(new Uint8Array(100), 10, 10, 4)).toBe(null);
  });
});
