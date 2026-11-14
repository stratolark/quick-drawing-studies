/* Learning-session state machine. Pure: transition(state, event) returns a new state and never touches the
   DOM, storage, timers or any AI provider. The UI dispatches events and renders whatever stage results.

   setup -> observe -> warmup -> focused_practice -> review -> (correction -> review)* -> transfer_test -> review -> summary -> completed
   Optional stages can be disabled in the plan or skipped. END_EARLY keeps every finished attempt. */
import { GUIDANCE, GUIDANCE_LEVELS, STAGE, OVERLAYS } from './curriculum.js';

export const EVENT = Object.freeze({
  start: 'START',
  complete: 'COMPLETE',
  skip: 'SKIP',
  setReference: 'SET_REFERENCE',
  attemptRecorded: 'ATTEMPT_RECORDED',
  retry: 'RETRY',
  continue: 'CONTINUE',
  pause: 'PAUSE',
  resume: 'RESUME',
  endEarly: 'END_EARLY',
  error: 'ERROR',
  recover: 'RECOVER',
  finish: 'FINISH',
});

export const ATTEMPT_TYPE = Object.freeze({
  warmup: 'warmup',
  initial: 'initial',
  correction: 'correction',
  transfer: 'transfer',
});

export const REF_ROLE = Object.freeze({ focus: 'focus', transfer: 'transfer' });

/* Which attempt type each drawing stage produces. */
const ATTEMPT_TYPE_BY_STAGE = {
  [STAGE.warmup]: ATTEMPT_TYPE.warmup,
  [STAGE.focused]: ATTEMPT_TYPE.initial,
  [STAGE.correction]: ATTEMPT_TYPE.correction,
  [STAGE.transfer]: ATTEMPT_TYPE.transfer,
};
export const DRAWING_STAGES = Object.keys(ATTEMPT_TYPE_BY_STAGE);
const PAUSABLE = new Set([STAGE.observe, ...DRAWING_STAGES]);
const SKIPPABLE = new Set([STAGE.observe, STAGE.warmup, STAGE.transfer]);
const FINISHED = new Set([STAGE.summary, STAGE.completed]);

export function createSession({ id, type, objectiveId, plan, guidance, now }) {
  return {
    id,
    type,
    objectiveId,
    plan,
    guidance: guidance == null ? GUIDANCE.assisted : guidance,
    stage: STAGE.setup,
    paused: false,
    references: { [REF_ROLE.focus]: null, [REF_ROLE.transfer]: null },
    attempts: [],
    warmupDone: 0,
    retriesUsed: 0,
    reviewOf: null,
    error: null,
    endedEarly: false,
    startedAt: now,
    endedAt: null,
    history: [{ stage: STAGE.setup, at: now }],
  };
}

const ok = state => ({ state, ok: true, reason: null });
const reject = (state, reason) => ({ state, ok: false, reason });

function enter(state, stage, now, patch) {
  return Object.assign({}, state, patch, { stage, history: state.history.concat({ stage, at: now }) });
}

function firstEnabled(state, stages) {
  return stages.find(s => state.plan[s] && state.plan[s].enabled) || null;
}

function afterObserve(state) {
  return firstEnabled(state, [STAGE.warmup, STAGE.focused]);
}

export function reviewedAttempt(state) {
  return state.attempts.find(a => a.id === state.reviewOf) || null;
}

export function canRetry(state) {
  const a = reviewedAttempt(state);
  if (state.stage !== STAGE.review || !a || a.type === ATTEMPT_TYPE.transfer) return false;
  const c = state.plan[STAGE.correction];
  return !!(c && c.enabled && state.retriesUsed < c.maxRetries);
}

function recordAttempt(state, ev, now) {
  const a = ev.attempt;
  if (!a || !a.id || !a.referenceId) return reject(state, 'attempt-needs-id-and-reference');
  if (state.attempts.some(x => x.id === a.id)) return reject(state, 'duplicate-attempt');
  const type = ATTEMPT_TYPE_BY_STAGE[state.stage];
  const refs = state.references;
  let parentId = null;
  if (type === ATTEMPT_TYPE.initial && refs.focus && a.referenceId !== refs.focus)
    return reject(state, 'focused-attempt-must-use-observed-reference');
  if (type === ATTEMPT_TYPE.correction) {
    if (a.referenceId !== refs.focus) return reject(state, 'correction-must-use-same-reference');
    parentId = state.reviewOf;
  }
  if (type === ATTEMPT_TYPE.transfer) {
    if (!refs.transfer) return reject(state, 'transfer-reference-not-set');
    if (a.referenceId !== refs.transfer) return reject(state, 'transfer-attempt-must-use-transfer-reference');
  }
  const entry = { id: a.id, type, stage: state.stage, referenceId: a.referenceId, parentId, at: now };
  const next = Object.assign({}, state, { attempts: state.attempts.concat(entry) });
  if (type === ATTEMPT_TYPE.initial && !refs.focus) next.references = Object.assign({}, refs, { focus: a.referenceId });
  if (type === ATTEMPT_TYPE.warmup) {
    next.warmupDone = state.warmupDone + 1;
    return ok(next.warmupDone >= state.plan[STAGE.warmup].count ? enter(next, STAGE.focused, now) : next);
  }
  if (type === ATTEMPT_TYPE.correction) next.retriesUsed = state.retriesUsed + 1;
  return ok(enter(next, STAGE.review, now, { reviewOf: entry.id }));
}

export function transition(state, ev, now) {
  now = now == null ? Date.now() : now;
  const s = state.stage;
  if (state.paused && ev.type !== EVENT.resume && ev.type !== EVENT.endEarly) return reject(state, 'paused');

  switch (ev.type) {
    case EVENT.start:
      if (s !== STAGE.setup) return reject(state, 'already-started');
      return ok(enter(state, firstEnabled(state, [STAGE.observe, STAGE.warmup, STAGE.focused]), now));

    case EVENT.complete:
      if (s === STAGE.observe) return ok(enter(state, afterObserve(state), now));
      if (s === STAGE.warmup) return ok(enter(state, STAGE.focused, now));
      return reject(state, 'nothing-to-complete');

    case EVENT.skip:
      if (!SKIPPABLE.has(s)) return reject(state, 'stage-not-skippable');
      if (s === STAGE.observe) return ok(enter(state, afterObserve(state), now));
      if (s === STAGE.warmup) return ok(enter(state, STAGE.focused, now));
      return ok(enter(state, STAGE.summary, now));

    case EVENT.setReference: {
      const { role, referenceId } = ev;
      if (!referenceId || !(role in state.references)) return reject(state, 'bad-reference');
      if (role === REF_ROLE.focus && state.references.focus && state.references.focus !== referenceId)
        return reject(state, 'focus-reference-already-set');
      if (role === REF_ROLE.transfer && referenceId === state.references.focus)
        return reject(state, 'transfer-reference-must-differ');
      return ok(Object.assign({}, state, { references: Object.assign({}, state.references, { [role]: referenceId }) }));
    }

    case EVENT.attemptRecorded:
      if (!ATTEMPT_TYPE_BY_STAGE[s]) return reject(state, 'not-a-drawing-stage');
      return recordAttempt(state, ev, now);

    case EVENT.retry:
      if (!canRetry(state)) return reject(state, 'retry-not-available');
      return ok(enter(state, STAGE.correction, now));

    case EVENT.continue: {
      if (s !== STAGE.review) return reject(state, 'not-in-review');
      const a = reviewedAttempt(state);
      const toTransfer = a && a.type !== ATTEMPT_TYPE.transfer && state.plan[STAGE.transfer].enabled;
      return ok(enter(state, toTransfer ? STAGE.transfer : STAGE.summary, now));
    }

    case EVENT.pause:
      if (!PAUSABLE.has(s)) return reject(state, 'not-pausable');
      return ok(Object.assign({}, state, { paused: true }));

    case EVENT.resume:
      if (!state.paused) return reject(state, 'not-paused');
      return ok(Object.assign({}, state, { paused: false }));

    case EVENT.endEarly:
      if (FINISHED.has(s)) return reject(state, 'already-finished');
      if (!state.attempts.length)
        return ok(enter(state, STAGE.completed, now, { paused: false, endedEarly: true, endedAt: now }));
      return ok(enter(state, STAGE.summary, now, { paused: false, endedEarly: true }));

    case EVENT.error:
      // Errors are recorded beside the stage; they never drop attempts or move the learner backwards.
      return ok(Object.assign({}, state, { error: { message: String(ev.message || 'error'), stage: s, at: now } }));

    case EVENT.recover:
      return ok(Object.assign({}, state, { error: null }));

    case EVENT.finish:
      if (s !== STAGE.summary) return reject(state, 'not-in-summary');
      return ok(enter(state, STAGE.completed, now, { endedAt: now }));

    default:
      return reject(state, 'unknown-event');
  }
}

/* What the learner may see in the current stage. The transfer test always shows nothing. */
export function assistance(state) {
  const s = state.stage;
  const G = GUIDANCE_LEVELS[state.guidance];
  const none = {
    independent: true,
    questions: 0,
    objective: false,
    correction: false,
    guidesAfterObserve: OVERLAYS.none,
    constructionGuide: false,
    liveFeedback: false,
  };
  if (s === STAGE.transfer) return none;
  if (s === STAGE.observe) {
    return Object.assign({}, none, {
      independent: state.guidance === GUIDANCE.independent,
      questions: G.questions,
      guidesAfterObserve: G.overlaysAfterObserve,
      constructionGuide: state.guidance !== GUIDANCE.independent,
    });
  }
  if (s === STAGE.correction) return Object.assign({}, none, { independent: false, objective: true, correction: true });
  if (s === STAGE.focused || s === STAGE.warmup)
    return Object.assign({}, none, {
      independent: state.guidance === GUIDANCE.independent,
      objective: G.objectiveWhileDrawing,
    });
  if (s === STAGE.review || s === STAGE.summary)
    return Object.assign({}, none, { independent: false, constructionGuide: true });
  return none;
}

export const ATTEMPT_TYPE_FOR_STAGE = stage => ATTEMPT_TYPE_BY_STAGE[stage] || null;
