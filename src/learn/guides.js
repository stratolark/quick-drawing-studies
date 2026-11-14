/* Drawing of verified annotations and procedural construction guides.
   Everything drawn here comes from reference metadata or measured analysis; nothing is estimated.
   Construction guides are generated from the 3D scene and are labelled as such, never as an artist's demo. */
import { EVALUATOR, TRACK, OBJECTIVES } from '../learning/curriculum.js';
import { TONE } from '../analysis/values.js';
import { ANALYSIS_STATUS } from '../analysis/gesture.js';

export const COLORS = Object.freeze({
  reference: '#2f7de1',
  mine: '#1c1f24',
  // Vermilion is reserved for the learner's own marks and drawing, so guides never use it.
  guide: '#1c1f24',
  darkFill: 'rgba(47, 125, 225, 0.32)',
  midFill: 'rgba(47, 125, 225, 0.12)',
});
export const GUIDE_STEP_MS = 1300;
export const GUIDE_LABEL = 'Construction Guide';
export const GUIDE_NOTE = 'Generated from the 3D scene. It shows one way to build the drawing, not a real artist\'s stroke order.';

const xy = p => (Array.isArray(p) ? p : [p.x, p.y]);

function partialPolyline(ctx, pts, t) {
  if (pts.length < 2) return;
  const P = pts.map(xy);
  let total = 0;
  for (let i = 1; i < P.length; i++) total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  let left = total * Math.max(0, Math.min(1, t));
  ctx.beginPath();
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length && left > 0; i++) {
    const seg = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const k = seg > left ? left / seg : 1;
    ctx.lineTo(P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k);
    left -= seg;
  }
  ctx.stroke();
}

function stroke(ctx, color, width, dash, fn) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  fn();
  ctx.restore();
}

function fillCells(ctx, tones, gw, gh, w, h, tone, color, t) {
  const cw = w / gw, ch = h / gh, rows = Math.ceil(gh * t);
  ctx.save();
  ctx.fillStyle = color;
  for (let y = 0; y < rows; y++) for (let x = 0; x < gw; x++) if (tones[y * gw + x] === tone) ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
  ctx.restore();
}

/* ---------- construction guides, in reference-image pixels ---------- */

function figureSteps(meta) {
  const g = meta.geometry || {};
  if (!g.actionLine || !g.landmarks) return [];
  const L = g.landmarks, R = g.massRadii || {};
  const W = Math.max(3, meta.width / 160);
  const limbs = [['shoulderL', 'elbowL', 'handL'], ['shoulderR', 'elbowR', 'handR'], ['hipL', 'kneeL', 'ankleL'], ['hipR', 'kneeR', 'ankleR']];
  const steps = [
    { label: 'Find the main movement axis', draw: (ctx, t) => stroke(ctx, COLORS.reference, W * 1.6, null, () => partialPolyline(ctx, g.actionLine, t)) },
    { label: 'Place the head, ribcage and pelvis', draw: (ctx, t) => stroke(ctx, COLORS.guide, W, null, () => {
      for (const k of ['head', 'chest', 'pelvis']) { if (!L[k] || !R[k]) continue; ctx.beginPath(); ctx.arc(L[k][0], L[k][1], R[k], -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t); ctx.stroke(); }
    }) },
    { label: 'Add the tilt of shoulders and hips, then the limb directions', draw: (ctx, t) => stroke(ctx, COLORS.guide, W * 0.8, null, () => {
      partialPolyline(ctx, [L.shoulderL, L.shoulderR], t);
      partialPolyline(ctx, [L.hipL, L.hipR], t);
      for (const chain of limbs) partialPolyline(ctx, chain.map(k => L[k]), t);
    }) },
  ];
  if (g.silhouette && g.silhouette.bbox) {
    const b = g.silhouette.bbox;
    steps.push({ label: 'Check the overall silhouette: height against width', draw: (ctx, t) => stroke(ctx, COLORS.mine, W * 0.6, [W * 3, W * 2], () => partialPolyline(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h], [b.x, b.y]], t)) });
  }
  return steps;
}

const BOX_EDGES = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function perspectiveSteps(meta) {
  const g = meta.geometry || {};
  if (!g.horizon) return [];
  const W = Math.max(2, meta.width / 250);
  const vps = g.vanishingPoints || [];
  const forms = g.forms || [];
  const steps = [{ label: 'Find the horizon', draw: (ctx, t) => stroke(ctx, COLORS.reference, W * 1.5, null, () => partialPolyline(ctx, [[0, g.horizon.y], [meta.width, g.horizon.y]], t)) }];
  if (vps.length) {
    const starts = forms.length ? forms.flatMap(f => [f.corners[0], f.corners[3], f.corners[4], f.corners[7]]) : [[0, 0], [meta.width, 0], [0, meta.height], [meta.width, meta.height]];
    steps.push({ label: 'Run the receding edges toward the vanishing points', draw: (ctx, t) => stroke(ctx, COLORS.reference, W * 0.7, [W * 3, W * 2], () => {
      for (const vp of vps) for (const s of starts) partialPolyline(ctx, [s, vp], t);
    }) });
  }
  if (forms.length) {
    steps.push({ label: 'Build each box as a see-through form', draw: (ctx, t) => stroke(ctx, COLORS.mine, W, null, () => {
      for (const f of forms) for (const [a, b] of BOX_EDGES) partialPolyline(ctx, [f.corners[a], f.corners[b]], t);
    }) });
  }
  return steps;
}

function valueSteps(meta, darkGrid) {
  const g = meta.geometry || {};
  const steps = [];
  if (g.light) {
    const fromRight = g.light.side === 'right';
    const a = [fromRight ? meta.width * 0.92 : meta.width * 0.08, meta.height * (g.light.fromAbove ? 0.08 : 0.92)];
    const b = [meta.width / 2, meta.height / 2];
    const W = Math.max(3, meta.width / 160);
    steps.push({ label: `Find the light: it comes from the ${g.light.side}${g.light.fromAbove ? ', above' : ''}`, draw: (ctx, t) => stroke(ctx, COLORS.reference, W, null, () => {
      partialPolyline(ctx, [a, b], t);
      if (t >= 1) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - W * 5 * Math.cos(ang - 0.4), b[1] - W * 5 * Math.sin(ang - 0.4)); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - W * 5 * Math.cos(ang + 0.4), b[1] - W * 5 * Math.sin(ang + 0.4)); ctx.stroke(); }
    }) });
  }
  if (darkGrid) {
    const { tones, w, h } = darkGrid;
    steps.push({ label: 'Block in the big dark shapes', draw: (ctx, t) => fillCells(ctx, tones, w, h, meta.width, meta.height, TONE.dark, COLORS.darkFill, t) });
    steps.push({ label: 'Add the mid tones; the rest stays paper', draw: (ctx, t) => fillCells(ctx, tones, w, h, meta.width, meta.height, TONE.mid, COLORS.midFill, t) });
  }
  return steps;
}

const STEPS_BY_TRACK = {
  [TRACK.gesture]: figureSteps,
  [TRACK.shape]: figureSteps,
  [TRACK.form]: perspectiveSteps,
  [TRACK.values]: valueSteps,
};

export function constructionSteps(objectiveId, meta, darkGrid) {
  if (!meta) return [];
  return STEPS_BY_TRACK[OBJECTIVES[objectiveId].track](meta, darkGrid);
}

export function drawSteps(ctx, steps, upto, t) {
  for (let i = 0; i < Math.min(upto, steps.length); i++) steps[i].draw(ctx, 1);
  if (upto < steps.length && t > 0) steps[upto].draw(ctx, t);
}

/* Animate steps one after another. frame(step, t) redraws; returns { stop }. */
export function playSteps(steps, frame, onDone) {
  let raf = 0, start = performance.now(), stopped = false;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick = now => {
    if (stopped) return;
    const el = reduce ? Infinity : now - start;
    const step = Math.floor(el / GUIDE_STEP_MS);
    if (step >= steps.length) { frame(steps.length, 0); if (onDone) onDone(); return; }
    frame(step, (el % GUIDE_STEP_MS) / GUIDE_STEP_MS);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}

/* ---------- review annotations, in drawing-canvas pixels ---------- */

/* Map points from canvas space into the composed compare view. The drawing moves with the learner's alignment. */
function panes(round, layout, gap) {
  const { cw, ch, align } = round;
  const refPane = (x, y) => [x, y]; // the reference always sits at the origin of the compare view
  const minePane = layout === 'h' ? (x, y) => [x + cw + gap, y]
    : layout === 'v' ? (x, y) => [x, y + ch + gap]
      : (x, y) => [cw / 2 + align.dx + (x - cw / 2) * align.s, ch / 2 + align.dy + (y - ch / 2) * align.s];
  return { refPane, minePane };
}

const mapPts = (pts, f) => pts.map(p => f(...xy(p)));

export function drawReviewAnnotations(ctx, { round, analysis, toggles, layout, gap, guide }) {
  if (!toggles.show) return;
  const { refPane, minePane } = panes(round, layout, gap);
  const W = Math.max(3, round.cw / 220);
  if (guide && guide.steps.length) {
    const k = round.cw / guide.width;
    ctx.save();
    ctx.translate(refPane(0, 0)[0], refPane(0, 0)[1]);
    ctx.scale(k, k);
    drawSteps(ctx, guide.steps, guide.upto, guide.t);
    ctx.restore();
  }
  if (!analysis) return;
  if (analysis.evaluator === EVALUATOR.gestureLine) {
    const refLine = analysis.annotations.find(a => a.role === 'reference-line');
    const mine = analysis.annotations.find(a => a.role === 'analyzed-line');
    if (toggles.reference && refLine) stroke(ctx, COLORS.reference, W, null, () => partialPolyline(ctx, mapPts(refLine.points, refPane), 1));
    if (toggles.mine && mine) stroke(ctx, COLORS.mine, W * 0.8, [W * 2.5, W * 1.6], () => partialPolyline(ctx, mapPts(mine.points, minePane), 1));
    if (toggles.mine && analysis.selection && analysis.status === ANALYSIS_STATUS.ambiguous) {
      ctx.save();
      ctx.font = `600 ${Math.round(W * 6)}px system-ui, sans-serif`;
      for (const c of analysis.selection.candidates.slice(0, 3)) {
        const [x, y] = minePane(...c.points[0]);
        ctx.fillStyle = COLORS.mine; ctx.beginPath(); ctx.arc(x, y, W * 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(c.index + 1), x, y + 1);
      }
      ctx.restore();
    }
  } else if (analysis.evaluator === EVALUATOR.shapeSilhouette) {
    const rect = (r, f, color, dash) => { const [x0, y0] = f(r[0] * round.cw, r[1] * round.ch); const [x1, y1] = f((r[0] + r[2]) * round.cw, (r[1] + r[3]) * round.ch); stroke(ctx, color, W * 0.8, dash, () => ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)); };
    const rb = analysis.annotations.find(a => a.role === 'reference-bbox');
    const db = analysis.annotations.find(a => a.role === 'drawn-bbox');
    if (toggles.reference && rb) rect(rb.rect, refPane, COLORS.reference, null);
    if (toggles.mine && db) rect(db.rect, minePane, COLORS.mine, [W * 2.5, W * 1.6]);
  } else if (analysis.evaluator === EVALUATOR.valueMasses && toggles.reference && analysis.refTones) {
    const [ox, oy] = refPane(0, 0);
    ctx.save();
    ctx.translate(ox, oy);
    fillCells(ctx, analysis.refTones, analysis.grid.w, analysis.grid.h, round.cw, round.ch, TONE.dark, COLORS.darkFill, 1);
    ctx.restore();
  }
}
