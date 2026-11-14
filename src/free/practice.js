/* Free practice: untimed drawing from generated mannequin poses or perspective objects, next to the reference or
   traced over it. Nothing is measured or stored except the drawing count and these preferences (2026-11-14). */
import { PERSPECTIVE_SCENES, POSE_TIERS } from '../refs/refs3d.js';
import { REF_SUBJECT } from '../learning/curriculum.js';
import { loadReference, randomSeed, releaseReference } from '../learn/references.js';
import { $, lsGet, lsSet } from '../util.js';

export const FREE_PREFS_KEY = 'qs.free';
export const ANY = 'any';
export const VIEW = Object.freeze({ side: 'side', trace: 'trace' });
const VIEW_OPTS = [
  [VIEW.side, 'Side by side'],
  [VIEW.trace, 'Tracing'],
];
const VIEW_NOTE = {
  [VIEW.side]: 'The reference sits next to your canvas.',
  [VIEW.trace]: 'The reference shows faintly under your canvas.',
};

/* Tracing opacity as a fraction of full; the slider in index.html works in percent between these bounds (2026-11-14). */
export const TRACE_OPACITY = Object.freeze({ min: 0.1, max: 0.8, initial: 0.35 });
const PERCENT = 100;

const SCENE_LABEL = { boxes: 'Boxes', street: 'Street', still: 'Still life', colonnade: 'Colonnade' };
const TIER_LABEL = { 1: 'Simple', 2: 'Medium', 3: 'Hard' };

/* Per-subject behavior. Each subject has one extra choice ("variant"): pose difficulty or scene type (2026-11-14). */
const SUBJECTS = {
  [REF_SUBJECT.movement]: {
    label: 'Mannequin poses',
    next: 'New pose',
    variantLabel: 'Poses',
    variants: [ANY, ...POSE_TIERS],
    variantName: v => TIER_LABEL[v],
    generateOptions: v => ({ tier: v === ANY ? null : v }),
  },
  [REF_SUBJECT.perspective]: {
    label: 'Objects in perspective',
    next: 'New scene',
    variantLabel: 'Scene',
    variants: [ANY, ...PERSPECTIVE_SCENES],
    variantName: v => SCENE_LABEL[v],
    generateOptions: v => ({ scene: v === ANY ? null : v }),
  },
};
const variantOptions = S => S.variants.map(v => [v, v === ANY ? 'Any' : S.variantName(v)]);

/* Stored preferences are untrusted: anything unknown falls back to the default (2026-11-14). */
export function normalizeFreePrefs(p, toolModes) {
  const o = p && typeof p === 'object' ? p : {};
  const subject = SUBJECTS[o.subject] ? o.subject : REF_SUBJECT.movement;
  const variant = Object.fromEntries(Object.keys(SUBJECTS).map(s => [s, ANY]));
  for (const [id, S] of Object.entries(SUBJECTS)) {
    if (o.variant && S.variants.includes(o.variant[id])) {
      variant[id] = o.variant[id];
    }
  }
  const opacity = Number(o.opacity);
  return {
    subject,
    variant,
    view: Object.values(VIEW).includes(o.view) ? o.view : VIEW.side,
    tools: toolModes.includes(o.tools) ? o.tools : toolModes[0],
    opacity: opacity >= TRACE_OPACITY.min && opacity <= TRACE_OPACITY.max ? opacity : TRACE_OPACITY.initial,
  };
}

export function createFreePractice(api) {
  const toolModes = Object.keys(api.MODES);
  const prefs = normalizeFreePrefs(lsGet(FREE_PREFS_KEY, null), toolModes);
  let live = null;

  const save = () => lsSet(FREE_PREFS_KEY, prefs);

  function renderSetup() {
    const S = SUBJECTS[prefs.subject];
    const pick = (field, rerender) => v => {
      prefs[field] = v;
      save();
      rerender();
    };
    api.seg(
      $('#segFreeSubject'),
      Object.entries(SUBJECTS).map(([id, s]) => [id, s.label]),
      prefs.subject,
      pick('subject', renderSetup),
    );
    $('#lblFreeVariant').textContent = S.variantLabel;
    api.seg($('#segFreeVariant'), variantOptions(S), prefs.variant[prefs.subject], v => {
      prefs.variant[prefs.subject] = v;
      save();
      renderSetup();
    });
    api.seg($('#segFreeView'), VIEW_OPTS, prefs.view, pick('view', renderSetup));
    api.seg(
      $('#segFreeTools'),
      toolModes.map(id => [id, api.MODES[id].name]),
      prefs.tools,
      pick('tools', renderSetup),
    );
    const can = api.canGenerate();
    $('#freeStart').disabled = !can;
    $('#freeNote').textContent = can
      ? VIEW_NOTE[prefs.view] + ' Change the view any time while you draw.'
      : 'This browser cannot draw generated references, so free practice is not available.';
  }

  function renderBar() {
    api.seg($('#segDrawView'), VIEW_OPTS, prefs.view, v => {
      prefs.view = v;
      save();
      renderBar();
    });
    $('#traceCtl').hidden = prefs.view !== VIEW.trace;
    $('#traceOpacity').value = String(Math.round(prefs.opacity * PERCENT));
    $('#freeNext').textContent = SUBJECTS[prefs.subject].next;
    api.setTrace(prefs.view === VIEW.trace, prefs.opacity);
  }

  async function generateRef() {
    const S = SUBJECTS[prefs.subject];
    const g = await api.QSRefs.generate(prefs.subject, randomSeed(), S.generateOptions(prefs.variant[prefs.subject]));
    return { url: g.url, w: g.w, h: g.h, label: g.label, objectUrl: true };
  }

  const hasDrawing = ss => !!ss.cur && !api.sketch.isEmpty();

  async function next() {
    const ss = live;
    if (!ss || ss.loading) {
      return;
    }
    const drawn = ss.drawn + (hasDrawing(ss) ? 1 : 0);
    ss.loading = true;
    const previous = ss.cur ? ss.cur.ref : null;
    try {
      const round = await api.startFreeAttempt(
        ss,
        async () => {
          const ref = await generateRef();
          return { ref, img: await loadReference(ref) };
        },
        {
          title: 'Free practice',
          sub: 'Drawing ' + (drawn + 1) + ' · ' + SUBJECTS[prefs.subject].label,
        },
      );
      if (round) {
        ss.drawn = drawn;
        // Only the drawing on screen matters; older rounds would keep their decoded images alive (2026-11-14).
        ss.rounds = [round];
        releaseReference(previous);
        renderBar();
      }
    } catch (e) {
      console.error('[free] could not prepare a reference', e);
      api.toast('Could not prepare a reference. Try again.');
      if (!ss.cur) {
        finish();
      }
    } finally {
      ss.loading = false;
    }
  }

  function finish() {
    const ss = live;
    if (!ss) {
      return;
    }
    ss.drawn += hasDrawing(ss) ? 1 : 0;
    live = null;
    ss.ended = true;
    api.stopDrawing();
    api.setTrace(false);
    if (ss.cur) {
      releaseReference(ss.cur.ref);
    }
    api.recordDrawings(ss.drawn);
    api.S.session = null;
    api.show('home');
    api.renderHome();
  }

  function start() {
    if (live) {
      return;
    }
    live = { free: true, mode: prefs.tools, secs: 0, rounds: [], drawn: 0, onRoundEnd: finish, onQuit: finish };
    next();
  }

  $('#freeStart').addEventListener('click', start);
  $('#freeNext').addEventListener('click', next);
  $('#traceOpacity').addEventListener('input', e => {
    prefs.opacity = Number(e.target.value) / PERCENT;
    save();
    api.setTrace(prefs.view === VIEW.trace, prefs.opacity);
  });

  return { renderSetup, start, finish };
}
