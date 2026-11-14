/* Gesture analysis: find the learner's main line among their pen strokes and compare it with the
   reference's projected line of action. Measurements only; wording and priorities live in issues.js.

   Rules: translation and uniform scale are normalized away; rotation and mirroring are not, so tilt
   errors stay visible. Reversed stroke direction is the same line. The main line is chosen from
   features that do not look at the reference, so the choice cannot hide a mistake. */
import {
  toXY,
  toPair,
  pathLength,
  resample,
  bbox,
  dist,
  reverse,
  chordAngleDeg,
  angleDelta,
  signedBow,
  curveType,
  normalizeTS,
  meanPairDistance,
  canonicalOrder,
  roundTo as round,
} from './geometry.js';
import { EVALUATOR } from '../learning/curriculum.js';

export const GESTURE_ANALYSIS_VERSION = 'gesture-1';

export const ANALYSIS_STATUS = Object.freeze({
  measured: 'measured',
  ambiguous: 'ambiguous',
  unavailable: 'unavailable',
  empty: 'empty',
});

/* Tolerances are deliberately loose: a quick study is not expected to match within a few degrees. */
export const GESTURE_TOLERANCES = Object.freeze({
  orientationDeg: 8, // tilt differences below this are treated as a match
  bow: 0.05, // bow difference (fraction of chord length) treated as a match
  straightBow: 0.035, // a line bowing less than this counts as straight
  shapeError: 0.25, // normalized mean point distance treated as a close match
  minLengthFrac: 0.15, // candidate must span this fraction of the drawing's diagonal
  joinGapFrac: 0.06, // stroke ends closer than this (of the diagonal) may form one line
  maxTortuosity: 2.2, // path length / chord above this is a scribble, not a line of action
  ambiguityRatio: 0.88, // runner-up scoring this close to the best makes the choice uncertain
});

const RESAMPLE_N = 48;
const STORED_POINTS = 24;
const CANDIDATE_PREVIEW_POINTS = 16;
const LINE_TOOLS = new Set(['pen']);

const LIMITATIONS = [
  'Measures only the main line of action, not anatomy, proportions or line quality.',
  'Position and size are normalized; rotation is not, so tilt differences count.',
];

/* Strokes after the last clear, pen only, without erasers. */
export function linesFromStrokes(strokes) {
  let start = 0;
  strokes.forEach((s, i) => {
    if (s.tool === 'clear') {
      start = i + 1;
    }
  });
  return strokes
    .slice(start)
    .filter(s => LINE_TOOLS.has(s.tool) && !s.erase && s.pts && s.pts.length >= 2)
    .map(s => s.pts.map(toXY));
}

function joinPair(a, b, maxGap) {
  const options = [
    [a, b, dist(a[a.length - 1], b[0])],
    [a, reverse(b), dist(a[a.length - 1], b[b.length - 1])],
    [reverse(a), b, dist(a[0], b[0])],
    [b, a, dist(b[b.length - 1], a[0])],
  ].sort((x, y) => x[2] - y[2]);
  const [p, q, gap] = options[0];
  return gap <= maxGap ? p.concat(q) : null;
}

/* Every single stroke plus consecutive stroke pairs whose ends meet, since a gesture line is often drawn in two pulls. */
export function buildCandidates(lines, diag) {
  const out = lines.map((pts, i) => ({ pts, order: i, parts: [i] }));
  for (let i = 0; i + 1 < lines.length; i++) {
    const j = joinPair(lines[i], lines[i + 1], GESTURE_TOLERANCES.joinGapFrac * diag);
    if (j) {
      out.push({ pts: j, order: i, parts: [i, i + 1] });
    }
  }
  return out;
}

function scoreCandidate(c, diag) {
  const len = pathLength(c.pts);
  const chord = dist(c.pts[0], c.pts[c.pts.length - 1]);
  const tortuosity = chord > 0 ? len / chord : Infinity;
  if (len < GESTURE_TOLERANCES.minLengthFrac * diag || tortuosity > GESTURE_TOLERANCES.maxTortuosity) {
    return null;
  }
  const lengthScore = Math.min(1, len / (0.8 * diag));
  const spanScore = Math.min(1, chord / (0.7 * diag));
  const orderScore = 1 / (1 + 0.25 * c.order);
  const smoothScore = 1 / tortuosity;
  // Length and span dominate; early and smooth strokes break ties. A joined pair pays a small cost so it wins only when it is really longer (2026-11-14).
  const score =
    0.45 * lengthScore + 0.25 * spanScore + 0.15 * orderScore + 0.15 * smoothScore - (c.parts.length > 1 ? 0.02 : 0);
  return Object.assign({}, c, { len, chord, tortuosity, score });
}

function orderToMatch(drawn, ref) {
  const nr = normalizeTS(ref);
  const a = meanPairDistance(normalizeTS(drawn), nr);
  const rev = reverse(drawn);
  const b = meanPairDistance(normalizeTS(rev), nr);
  return a <= b ? { pts: drawn, shapeError: a } : { pts: rev, shapeError: b };
}

/* Compare an already chosen line with the reference line. Both in the same canvas coordinates. */
export function compareLines(drawnPts, refPts) {
  const T = GESTURE_TOLERANCES;
  const ref = resample(canonicalOrder(refPts), RESAMPLE_N);
  const { pts: drawn, shapeError } = orderToMatch(resample(drawnPts, RESAMPLE_N), ref);
  const refAngle = chordAngleDeg(ref);
  const drawnAngle = chordAngleDeg(drawn);
  const orientationDeltaDeg = angleDelta(drawnAngle, refAngle);
  const refBow = signedBow(ref);
  const drawnBow = signedBow(drawn);
  const refCurved = Math.abs(refBow) >= T.straightBow;
  const drawnCurved = Math.abs(drawnBow) >= T.straightBow;
  const vertical = Math.abs(Math.sin((refAngle * Math.PI) / 180)) >= Math.SQRT1_2;
  return {
    metrics: {
      orientationDeltaDeg: round(orientationDeltaDeg, 1),
      orientationErrorDeg: round(Math.abs(orientationDeltaDeg), 1),
      refBow: round(refBow, 3),
      drawnBow: round(drawnBow, 3),
      bowError: round(Math.abs(drawnBow - refBow), 3),
      curvatureDirectionMatch: refCurved && drawnCurved ? Math.sign(refBow) === Math.sign(drawnBow) : null,
      refCurveType: curveType(ref, T.straightBow),
      drawnCurveType: curveType(drawn, T.straightBow),
      shapeError: round(shapeError, 3),
      refMostlyVertical: vertical,
    },
    drawn,
    ref,
  };
}

function baseAnalysis(status, extra) {
  return Object.assign(
    {
      version: GESTURE_ANALYSIS_VERSION,
      evaluator: EVALUATOR.gestureLine,
      status,
      metrics: {},
      tolerances: GESTURE_TOLERANCES,
      limitations: LIMITATIONS.slice(),
      selection: null,
      annotations: [],
      compact: null,
    },
    extra,
  );
}

/* reference: { actionLine: [[x,y]...], width, height } in reference-image pixels.
   canvas: { w, h } the drawing canvas size. selection: optional candidate index chosen by the learner. */
export function analyzeGesture({ strokes, reference, canvas, selection }) {
  const lines = linesFromStrokes(strokes || []);
  if (!lines.length) {
    return baseAnalysis(ANALYSIS_STATUS.empty, { limitations: ['No pen lines were drawn.'] });
  }
  const line = reference && reference.actionLine;
  if (!line || line.length < 2 || !reference.width || !reference.height) {
    return baseAnalysis(ANALYSIS_STATUS.unavailable, {
      limitations: [
        'This reference has no verified line of action, so the gesture cannot be measured. Compare it yourself with the overlay.',
      ],
    });
  }
  const sx = canvas.w / reference.width,
    sy = canvas.h / reference.height;
  const refPts = line.map(p => ({ x: p[0] * sx, y: p[1] * sy }));

  const all = lines.flat();
  const bb = bbox(all);
  const diag = Math.hypot(bb.w, bb.h) || 1;
  const scored = buildCandidates(lines, diag)
    .map(c => scoreCandidate(c, diag))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return baseAnalysis(ANALYSIS_STATUS.unavailable, {
      limitations: ['No stroke was long and smooth enough to read as a line of action.'],
    });
  }

  const candidates = scored.map((c, i) => ({
    index: i,
    score: round(c.score, 3),
    points: resample(c.pts, CANDIDATE_PREVIEW_POINTS).map(p => toPair(p)),
  }));
  const userPick = Number.isInteger(selection) && scored[selection] ? selection : null;
  const chosenIndex = userPick == null ? 0 : userPick;
  const chosen = scored[chosenIndex];

  let ambiguous = false;
  if (userPick == null && scored.length > 1) {
    const runner = scored[1];
    const close = runner.score >= GESTURE_TOLERANCES.ambiguityRatio * chosen.score;
    const differs =
      Math.abs(angleDelta(chordAngleDeg(canonicalOrder(runner.pts)), chordAngleDeg(canonicalOrder(chosen.pts)))) >
      2 * GESTURE_TOLERANCES.orientationDeg;
    const sameStrokes = runner.parts.some(p => chosen.parts.includes(p));
    ambiguous = close && differs && !sameStrokes;
  }

  const { metrics, drawn, ref } = compareLines(chosen.pts, refPts);
  const limitations = LIMITATIONS.slice();
  if (ambiguous) {
    limitations.push('Two strokes could be your main line. Pick the one you meant so the measurement uses it.');
  }
  return baseAnalysis(ambiguous ? ANALYSIS_STATUS.ambiguous : ANALYSIS_STATUS.measured, {
    metrics,
    limitations,
    selection: {
      index: chosenIndex,
      source: userPick == null ? 'auto' : 'user',
      confidence: round(scored.length > 1 ? 1 - scored[1].score / chosen.score : 1, 3),
      candidates,
    },
    annotations: [
      { kind: 'polyline', role: 'reference-line', points: ref.map(p => toPair(p)) },
      { kind: 'polyline', role: 'analyzed-line', points: drawn.map(p => toPair(p)) },
    ],
    compact: { line: resample(drawn, STORED_POINTS).map(p => toPair(p)) },
  });
}
