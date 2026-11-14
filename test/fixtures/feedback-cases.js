/* Feedback-quality dataset: drawing/reference pairs with the observation the app should make.
   Expected results are true by construction (the drawings are generated from the reference with a known
   change), not human judgments. humanLabel stays null until real learners or teachers label the cases. */

export const CANVAS = { w: 750, h: 1000 };

const DEG = Math.PI / 180;
/* Deterministic noise so the dataset never changes between runs. */
function noise(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; }

export function actionLine({ bow = 110, lean = 20, n = 32 } = {}) {
  return Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [400 - lean * t - bow * Math.sin(Math.PI * t), 120 + 760 * t]; });
}
const center = P => P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);
const rotate = (P, deg) => { const [cx, cy] = center(P), c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return P.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };
const scale = (P, k, dx = 0, dy = 0) => { const [cx, cy] = center(P); return P.map(([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy]); };
const mirror = P => { const [cx] = center(P); return P.map(([x, y]) => [2 * cx - x, y]); };
const jitter = (P, amp, seed) => { const r = noise(seed); return P.map(([x, y]) => [x + r() * 2 * amp, y + r() * 2 * amp]); };
/* A sketchy style: the same line drawn as several overlapping short strokes. */
const sketchy = (P, parts) => Array.from({ length: parts }, (_, i) => P.slice(Math.floor(i * P.length / parts), Math.min(P.length, Math.floor((i + 1) * P.length / parts) + 2)));
const stroke = P => ({ tool: 'pen', erase: false, pts: P.map(([x, y]) => ({ x, y, p: 0.6 })) });

const REF = actionLine();
const generated = { actionLine: REF, width: 750, height: 1000 };
const imported = { width: 750, height: 1000 }; // the learner's own image: no verified geometry

export const CATEGORY = Object.freeze({ correct: 'correct', incorrect: 'incorrect', ambiguous: 'ambiguous', exaggeration: 'exaggeration', style: 'style', imported: 'imported' });

export const CASES = [
  { id: 'exact-copy', category: CATEGORY.correct, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(REF)], expect: { status: 'measured', primary: null } },
  { id: 'smaller-offset', category: CATEGORY.correct, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(scale(REF, 0.5, -120, 60))], expect: { status: 'measured', primary: null } },
  { id: 'hand-wobble', category: CATEGORY.correct, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(jitter(REF, 5, 11))], expect: { status: 'measured', primary: null } },
  { id: 'tilted-25', category: CATEGORY.incorrect, objective: 'gesture.torso-tilt', reference: generated, strokes: [stroke(rotate(REF, 25))], expect: { status: 'measured', primary: 'gesture.orientation' } },
  { id: 'tilted-minus-15', category: CATEGORY.incorrect, objective: 'gesture.torso-tilt', reference: generated, strokes: [stroke(rotate(REF, -15))], expect: { status: 'measured', primary: 'gesture.orientation' } },
  { id: 'bend-reversed', category: CATEGORY.incorrect, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(mirror(REF))], expect: { status: 'measured', primary: 'gesture.curve-direction' } },
  { id: 'too-straight', category: CATEGORY.incorrect, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(actionLine({ bow: 0 }))], expect: { status: 'measured', primary: 'gesture.curvature-amount' } },
  { id: 'exaggerated-bend', category: CATEGORY.exaggeration, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(actionLine({ bow: 260 }))], expect: { status: 'measured', primary: 'gesture.curvature-amount', uncertainty: true } },
  { id: 'two-candidates', category: CATEGORY.ambiguous, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke([[380, 120], [380, 880]]), stroke([[620, 150], [160, 860]])], expect: { status: 'ambiguous' } },
  { id: 'sketchy-strokes', category: CATEGORY.style, objective: 'gesture.line-of-action', reference: generated, strokes: [...sketchy(jitter(REF, 3, 5), 2).map(stroke)], expect: { status: 'measured', primary: null } },
  { id: 'line-with-limbs', category: CATEGORY.style, objective: 'gesture.line-of-action', reference: generated, strokes: [stroke(REF), stroke([[330, 300], [250, 420]]), stroke([[420, 320], [520, 430]]), stroke([[360, 620], [300, 760]])], expect: { status: 'measured', primary: null } },
  { id: 'imported-reference', category: CATEGORY.imported, objective: 'gesture.line-of-action', reference: imported, strokes: [stroke(REF)], expect: { status: 'unavailable' } },
].map(c => Object.assign({ humanLabel: null }, c));
