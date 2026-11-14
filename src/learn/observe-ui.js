/* Observation stage: study the reference, answer one or two questions, and mark one structure on it.
   The mark is checked only against verified reference geometry. Structural overlays and the construction
   guide unlock after the learner has tried, and only at guidance levels that allow them. */
import { OBJECTIVES, INTERACTION, INTERACTIONS, EVALUATOR, OVERLAYS, REF_NEED } from '../learning/curriculum.js';
import { EVENT } from '../learning/session-engine.js';
import { compareLines, GESTURE_TOLERANCES } from '../analysis/gesture.js';
import { otsu3, classifyLuminance, TONE } from '../analysis/values.js';
import { luminanceGrid, gridSize } from '../analysis/raster.js';
import { COLORS, GUIDE_LABEL, GUIDE_NOTE, constructionSteps, drawSteps, playSteps } from './guides.js';
import { $, el, pad2 } from '../util.js';

const TONE_GRID_COLS = 48;
const HORIZON_TOLERANCE = 0.05; // fraction of image height
const BOX_ASPECT_TOLERANCE = 0.12;
const TONE_NAME = { [TONE.dark]: 'dark', [TONE.mid]: 'mid', [TONE.light]: 'light' };

let O_ = null; // the open observation, null when closed

/* Whether the reference carries the verified data a mark is checked against. */
const HAS_NEED = {
  [REF_NEED.actionLine]: g => !!g.actionLine,
  [REF_NEED.silhouette]: g => !!(g.silhouette && g.silhouette.bbox),
  [REF_NEED.horizon]: g => !!(g.horizon && g.horizon.inFrame),
  [REF_NEED.pixels]: (g, toneGrid) => !!toneGrid,
};
const verifiedAvailable = (kind, meta, toneGrid) => HAS_NEED[INTERACTIONS[kind].needs](meta.geometry || {}, toneGrid);

function toneGridFor(ref) {
  try {
    const gs = gridSize(ref.w, ref.h, TONE_GRID_COLS);
    const lum = luminanceGrid(ref.img, gs.w, gs.h);
    return { tones: classifyLuminance(lum, otsu3(lum)), w: gs.w, h: gs.h };
  } catch (e) {
    return null;
  }
}

/* ---------- checking a mark against verified geometry ---------- */

const CHECKS = {
  [INTERACTION.traceActionLine]: (mark, meta) => {
    if (!mark.pts || mark.pts.length < 2) return null;
    const m = compareLines(
      mark.pts,
      meta.geometry.actionLine.map(([x, y]) => ({ x, y })),
    ).metrics;
    const tilt =
      m.orientationErrorDeg <= GESTURE_TOLERANCES.orientationDeg
        ? `Your line's tilt is within ${GESTURE_TOLERANCES.orientationDeg}° of the verified line of action.`
        : `Your line is tilted about ${Math.round(m.orientationErrorDeg)}° away from the verified line of action.`;
    const bend =
      m.curvatureDirectionMatch === false
        ? ' It bends the other way.'
        : m.curvatureDirectionMatch === true
          ? ' It bends the same way.'
          : '';
    return {
      text: tilt + bend,
      metrics: { orientationErrorDeg: m.orientationErrorDeg, curvatureDirectionMatch: m.curvatureDirectionMatch },
    };
  },
  [INTERACTION.boxSubject]: (mark, meta) => {
    const r = mark.rect;
    if (!r || r.w < 4 || r.h < 4) return null;
    const b = meta.geometry.silhouette.bbox;
    const aspectError = r.h / r.w / (b.h / b.w) - 1;
    const ix = Math.max(0, Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x)),
      iy = Math.max(0, Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y));
    const inter = ix * iy,
      overlap = inter / (r.w * r.h + b.w * b.h - inter);
    const ratio =
      Math.abs(aspectError) <= BOX_ASPECT_TOLERANCE
        ? 'Your box has about the right height-to-width ratio.'
        : `Your box is about ${Math.round(Math.abs(aspectError) * 100)}% ${aspectError > 0 ? 'too tall for its width' : 'too wide for its height'}.`;
    return {
      text: ratio + ` It overlaps the figure's real bounds by ${Math.round(overlap * 100)}%.`,
      metrics: { aspectError: Math.round(aspectError * 1000) / 1000, overlap: Math.round(overlap * 1000) / 1000 },
    };
  },
  [INTERACTION.markHorizon]: (mark, meta) => {
    if (mark.y == null) return null;
    const err = (mark.y - meta.geometry.horizon.y) / meta.height;
    const text =
      Math.abs(err) <= HORIZON_TOLERANCE
        ? 'Your horizon is within 5% of the image height of the real one.'
        : `Your horizon is about ${Math.round(Math.abs(err) * 100)}% of the image height too ${err > 0 ? 'low' : 'high'}.`;
    return { text, metrics: { horizonError: Math.round(err * 1000) / 1000 } };
  },
  [INTERACTION.tapDarkest]: (mark, meta, toneGrid) => {
    if (!mark.pt || !toneGrid) return null;
    const gx = Math.min(toneGrid.w - 1, Math.floor((mark.pt.x / meta.width) * toneGrid.w));
    const gy = Math.min(toneGrid.h - 1, Math.floor((mark.pt.y / meta.height) * toneGrid.h));
    const tone = toneGrid.tones[gy * toneGrid.w + gx];
    const text =
      tone === TONE.dark
        ? 'Yes: that spot is in the darkest of the three value groups.'
        : `That spot is in the ${TONE_NAME[tone]} group. The darkest group is elsewhere.`;
    return { text, metrics: { hitDark: tone === TONE.dark } };
  },
};

/* ---------- drawing ---------- */

function drawMark(ctx, kind, mark, W) {
  ctx.save();
  ctx.strokeStyle = '#ff5b3a';
  ctx.fillStyle = '#ff5b3a';
  ctx.lineWidth = W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === INTERACTION.traceActionLine && mark.pts && mark.pts.length > 1) {
    ctx.beginPath();
    mark.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else if (kind === INTERACTION.boxSubject && mark.rect) {
    ctx.strokeRect(mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h);
  } else if (kind === INTERACTION.markHorizon && mark.y != null) {
    ctx.beginPath();
    ctx.moveTo(0, mark.y);
    ctx.lineTo(ctx.canvas.width, mark.y);
    ctx.stroke();
  } else if (kind === INTERACTION.tapDarkest && mark.pt) {
    ctx.beginPath();
    ctx.arc(mark.pt.x, mark.pt.y, W * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnswer(ctx, kind, meta, toneGrid, W) {
  const g = meta.geometry;
  ctx.save();
  ctx.strokeStyle = COLORS.reference;
  ctx.lineWidth = W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === INTERACTION.traceActionLine) {
    ctx.beginPath();
    g.actionLine.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  }
  if (kind === INTERACTION.boxSubject) {
    const b = g.silhouette.bbox;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  if (kind === INTERACTION.markHorizon) {
    ctx.beginPath();
    ctx.moveTo(0, g.horizon.y);
    ctx.lineTo(meta.width, g.horizon.y);
    ctx.stroke();
  }
  if (kind === INTERACTION.tapDarkest && toneGrid) {
    const cw = meta.width / toneGrid.w,
      ch = meta.height / toneGrid.h;
    ctx.fillStyle = COLORS.darkFill;
    for (let y = 0; y < toneGrid.h; y++)
      for (let x = 0; x < toneGrid.w; x++)
        if (toneGrid.tones[y * toneGrid.w + x] === TONE.dark) ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
  }
  ctx.restore();
}

function redraw() {
  const o = O_;
  if (!o) return;
  const ctx = o.canvas.getContext('2d');
  ctx.clearRect(0, 0, o.canvas.width, o.canvas.height);
  if (o.showAnswer && o.verified) drawAnswer(ctx, o.kind, o.meta, o.toneGrid, o.W);
  if (o.guide) drawSteps(ctx, o.guide.steps, o.guide.upto, o.guide.t);
  drawMark(ctx, o.kind, o.mark, o.W);
}

function layout() {
  const o = O_;
  if (!o) return;
  const box = $('#observeStage').getBoundingClientRect();
  const aspect = o.meta.width / o.meta.height;
  let w = box.width,
    h = w / aspect;
  if (h > box.height) {
    h = box.height;
    w = h * aspect;
  }
  const pane = $('#observePane');
  pane.style.width = Math.floor(w) + 'px';
  pane.style.height = Math.floor(h) + 'px';
}

/* ---------- pointer input in reference pixels ---------- */

function toRef(e) {
  const r = O_.canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * O_.canvas.width) / r.width,
    y: ((e.clientY - r.top) * O_.canvas.height) / r.height,
  };
}

function bindPointer(canvas) {
  let active = null;
  canvas.onpointerdown = e => {
    const o = O_;
    if (!o || o.checked || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.pointerType === 'touch' && o.penSeen) return;
    if (e.pointerType === 'pen') o.penSeen = true;
    e.preventDefault();
    active = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture is best effort */
    }
    const p = toRef(e);
    if (o.kind === INTERACTION.traceActionLine) o.mark = { pts: [p] };
    else if (o.kind === INTERACTION.boxSubject) o.mark = { start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
    else if (o.kind === INTERACTION.markHorizon) o.mark = { y: p.y };
    else o.mark = { pt: p };
    redraw();
  };
  canvas.onpointermove = e => {
    const o = O_;
    if (!o || e.pointerId !== active) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const p = toRef(list.length ? list[list.length - 1] : e);
    if (o.kind === INTERACTION.traceActionLine) for (const ev of list.length ? list : [e]) o.mark.pts.push(toRef(ev));
    else if (o.kind === INTERACTION.boxSubject) {
      const s = o.mark.start;
      o.mark.rect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    } else if (o.kind === INTERACTION.markHorizon) o.mark.y = p.y;
    else o.mark.pt = p;
    redraw();
  };
  const end = e => {
    if (O_ && e.pointerId === active) {
      active = null;
      O_.tried = true;
      renderSide();
    }
  };
  canvas.onpointerup = end;
  canvas.onpointercancel = end;
}

/* ---------- side panel ---------- */

function renderSide() {
  const o = O_;
  if (!o) return;
  const { objective: O, assist } = o;
  const kids = [el('h2', { text: 'What to look for' })];
  if (assist.questions > 0)
    kids.push(
      el('ul', { class: 'questions' }, ...O.questions.slice(0, assist.questions).map(q => el('li', { text: q }))),
    );
  else
    kids.push(el('p', { text: 'Study the reference before you draw. There are no hints at the Independent level.' }));

  const markBlock = [
    el('h3', { class: 'section-label', text: 'Try it on the reference' }),
    el('p', { text: INTERACTIONS[o.kind].prompt }),
  ];
  if (!o.verified)
    markBlock.push(
      el('p', {
        class: 'coach-note',
        text: 'This reference has no verified answer to check against, so compare your mark with the image yourself.',
      }),
    );
  if (o.result) markBlock.push(el('div', { class: 'fb-block fix' }, el('p', { text: o.result.text })));
  const actions = el('div', { class: 'row-actions' });
  if (o.tried && !o.checked && o.verified)
    actions.append(el('button', { class: 'btn', type: 'button', text: 'Check', onclick: () => check() }));
  if (o.tried)
    actions.append(
      el('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: 'Clear',
        onclick: () => {
          o.mark = {};
          o.tried = false;
          o.checked = false;
          o.result = null;
          o.showAnswer = false;
          renderSide();
          redraw();
        },
      }),
    );
  if (actions.childNodes.length) markBlock.push(actions);
  kids.push(el('div', { class: 'fb-block' }, ...markBlock));

  // Hints come only after the learner has tried, and only at guidance levels that allow them.
  const hints = el('div', { class: 'row-actions' });
  const after = o.checked || (o.tried && !o.verified);
  if (after && o.verified && assist.guidesAfterObserve === OVERLAYS.onRequest && !o.showAnswer)
    hints.append(
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'Show the structure',
        onclick: () => {
          o.showAnswer = true;
          redraw();
          renderSide();
        },
      }),
    );
  if (after && assist.constructionGuide && o.steps.length)
    hints.append(
      el('button', {
        class: 'btn',
        type: 'button',
        text: (o.guide ? 'Replay ' : 'Play ') + GUIDE_LABEL.toLowerCase(),
        title: GUIDE_NOTE,
        onclick: () => playGuide(),
      }),
    );
  if (hints.childNodes.length) kids.push(hints);
  if (o.guide)
    kids.push(
      el('p', { class: 'coach-note', id: 'obsGuideStep', text: o.guide.label || '' }),
      el('p', { class: 'coach-note', text: GUIDE_LABEL + ': ' + GUIDE_NOTE }),
    );
  kids.push(
    el('p', {
      class: 'coach-note',
      text: 'When you are ready, start drawing. The drawing itself has no hints on screen.',
    }),
  );
  $('#observeSide').replaceChildren(...kids);
}

function check() {
  const o = O_;
  o.result = CHECKS[o.kind](o.mark, o.meta, o.toneGrid);
  if (!o.result) return;
  o.checked = true;
  if (o.assist.guidesAfterObserve === OVERLAYS.auto) o.showAnswer = true;
  o.L.live.observation = { interaction: o.kind, metrics: o.result.metrics, guidance: o.L.live.state.guidance };
  redraw();
  renderSide();
}

function playGuide() {
  const o = O_;
  if (o.guide && o.guide.player) o.guide.player.stop();
  o.guide = { steps: o.steps, upto: 0, t: 0, label: '' };
  o.guide.player = playSteps(o.steps, (i, t) => {
    if (!O_ || !o.guide) return;
    o.guide.upto = i;
    o.guide.t = t;
    o.guide.label =
      Math.min(i, o.steps.length - 1) +
      1 +
      '/' +
      o.steps.length +
      ': ' +
      o.steps[Math.min(i, o.steps.length - 1)].label;
    const n = $('#obsGuideStep');
    if (n) n.textContent = o.guide.label;
    redraw();
  });
  renderSide();
}

function tickClock() {
  const o = O_;
  if (!o) return;
  const left = Math.max(0, o.endsAt - Date.now());
  const s = Math.ceil(left / 1000);
  $('#observeClock').textContent =
    left > 0 ? 'Suggested: ' + Math.floor(s / 60) + ':' + pad2(s % 60) : 'Suggested time is up. Start when ready.';
}

export function open(L, ref) {
  close();
  const objective = OBJECTIVES[L.live.objectiveId];
  const kind = objective.interaction;
  const meta = ref.meta;
  const needsPixels = INTERACTIONS[kind].needs === REF_NEED.pixels || objective.evaluator === EVALUATOR.valueMasses;
  const toneGrid = needsPixels ? toneGridFor(ref) : null;
  const canvas = $('#observeCanvas');
  canvas.width = meta.width;
  canvas.height = meta.height;
  O_ = {
    L,
    ref,
    meta,
    objective,
    kind,
    canvas,
    toneGrid,
    assist: L.assist(),
    verified: verifiedAvailable(kind, meta, toneGrid),
    steps: constructionSteps(L.live.objectiveId, meta, toneGrid),
    W: Math.max(3, meta.width / 180),
    mark: {},
    tried: false,
    checked: false,
    result: null,
    showAnswer: false,
    guide: null,
    penSeen: false,
    endsAt: Date.now() + L.live.plan.observe.minutes * 60000,
  };
  O_.timer = setInterval(tickClock, 500);
  $('#observeImg').src = ref.url;
  $('#observeImg').alt = 'Reference to study: ' + ref.label;
  $('#observeSub').textContent = objective.description;
  bindPointer(canvas);
  L.api.show('observe');
  requestAnimationFrame(layout);
  tickClock();
  renderSide();
  redraw();
}

export function close() {
  if (!O_) return;
  clearInterval(O_.timer);
  if (O_.guide && O_.guide.player) O_.guide.player.stop();
  O_ = null;
}

export function bindObserveControls(getL) {
  $('#observeDone').addEventListener('click', () => {
    const L = getL();
    close();
    L.dispatch({ type: EVENT.complete });
  });
  $('#observeSkip').addEventListener('click', () => {
    const L = getL();
    close();
    L.dispatch({ type: EVENT.skip });
  });
  $('#observeQuit').addEventListener('click', () => getL().quit());
  window.addEventListener('resize', () => requestAnimationFrame(layout));
}
