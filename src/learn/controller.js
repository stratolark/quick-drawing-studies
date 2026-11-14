/* Learning-session controller: the only place that dispatches session-engine events. It reacts to each stage
   with one entry action, runs attempts on the shared drawing screen, analyzes and stores them, and keeps the
   optional AI coach strictly separate from the measured results. */
import { OBJECTIVES, STAGE, SESSION_TEMPLATES, GUIDANCE, buildPlan, EVALUATOR } from '../learning/curriculum.js';
import {
  createSession,
  transition,
  assistance,
  canRetry,
  reviewedAttempt,
  EVENT,
  ATTEMPT_TYPE,
  REF_ROLE,
  ATTEMPT_TYPE_FOR_STAGE,
} from '../learning/session-engine.js';
import { createStorage, toAttemptRecord, toSessionRecord, toReferenceRecord } from '../learning/storage.js';
import {
  computeProgress,
  dueReviewObjective,
  suggestGuidance,
  suggestTier,
  recommendNext,
} from '../learning/progress.js';
import { analyzeAttempt } from '../analysis/run.js';
import { rankIssues } from '../analysis/issues.js';
import { compareAnalyses } from '../analysis/compare.js';
import { evidenceFor } from '../analysis/metrics.js';
import { coachHealth, requestCoachFeedback, ERROR_TEXT } from '../coach/client.js';
import { ERROR_CODE, IMAGE_ROLE, STYLE } from '../coach/schema.js';
import { makeReference, loadReference, releaseReference, REF_SOURCE, REF_ERROR } from './references.js';
import { mkCanvas, uid } from '../util.js';

/* Short pause between warm-up drawings so the last stroke is not cut off by the next reference. */
const WARMUP_GAP_MS = 650;
const COACH_JPEG_QUALITY = 0.85;

export const REVIEW_FROM = Object.freeze({ session: 'session', summary: 'summary' });
export const DISAGREE_SOURCE = Object.freeze({ measured: 'measured', ai: 'ai' });
export const AI_STATUS = Object.freeze({ idle: 'idle', pending: 'pending', done: 'done', error: 'error' });

const STAGE_LABEL = {
  [STAGE.warmup]: 'Warm-up',
  [STAGE.focused]: 'Focused drawing',
  [STAGE.correction]: 'Correction',
  [STAGE.transfer]: 'Independent test',
};

export function createLearning(api, ui) {
  const store = createStorage();
  const L = { api, ui, store, data: store.load(), coach: { available: false }, live: null };

  coachHealth().then(h => {
    L.coach = h;
    api.renderHome();
  });

  const progress = () => computeProgress({ attempts: L.data.attempts, sessions: L.data.sessions });
  L.progress = progress;
  L.recommend = () => recommendNext({ progress: progress(), sessions: L.data.sessions, now: Date.now() });
  L.suggestions = track => {
    const tp = progress()[track];
    const g = L.data.prefs.guidance[track],
      t = L.data.prefs.tier[track];
    return { guidance: suggestGuidance(tp, g), tier: suggestTier(tp, t, g) };
  };
  L.savePrefs = () => {
    if (!store.savePrefs(L.data.prefs)) api.toast('Could not save your settings in this browser.');
  };

  /* ---------- session lifecycle ---------- */

  L.start = function start({ type, objectiveId, source }) {
    const O = OBJECTIVES[objectiveId];
    const prefs = L.data.prefs;
    const plan = buildPlan(type, objectiveId, prefs.overrides[type]);
    const state = createSession({
      id: uid('ls'),
      type,
      objectiveId,
      plan,
      guidance: prefs.guidance[O.track],
      now: Date.now(),
    });
    const review = dueReviewObjective(progress(), O.track, Date.now());
    L.live = {
      state,
      plan,
      type,
      objectiveId,
      source: source || REF_SOURCE.generated,
      tier: prefs.tier[O.track],
      // Distributed practice: warm-ups revisit a skill that is due, when there is one.
      warmObjectiveId: review ? review.objectiveId : objectiveId,
      warmIsReview: !!review,
      refs: {},
      extraRefs: [],
      entries: new Map(),
      observation: null,
      reflection: null,
      ss: null,
      annot: { show: true, reference: true, mine: true },
    };
    L.live.ss = {
      v2: true,
      mode: O.toolMode,
      secs: 0,
      ready: {},
      rounds: [],
      onRoundEnd: r => onAttemptDone(r),
      onQuit: () => L.quit(),
      onPause: () => togglePause(),
    };
    dispatch({ type: EVENT.start });
  };

  function dispatch(ev) {
    const live = L.live;
    if (!live) return false;
    const before = live.state.stage;
    const r = transition(live.state, ev, Date.now());
    if (!r.ok) {
      console.warn('[learn] ' + ev.type + ' rejected: ' + r.reason);
      return false;
    }
    live.state = r.state;
    persistSession();
    if (live.state.stage !== before) enterStage();
    return true;
  }
  L.dispatch = dispatch;

  function persistSession() {
    const live = L.live;
    const refs = {};
    for (const [role, ref] of Object.entries(live.refs)) refs[role] = toReferenceRecord(ref.meta);
    const transfer = live.state.attempts.find(a => a.type === ATTEMPT_TYPE.transfer);
    const rec = toSessionRecord(live.state, {
      references: refs,
      corrections: live.state.attempts
        .filter(a => a.type === ATTEMPT_TYPE.correction)
        .map(a => ({
          attemptId: a.id,
          parentId: a.parentId,
          objective: entryOf(a.id) && entryOf(a.id).correctionObjective,
        })),
      transfer: transfer ? { attemptId: transfer.id, referenceId: transfer.referenceId } : null,
      summary: live.summary || null,
      reflection: live.reflection,
    });
    rec.observation = live.observation;
    if (!store.saveSession(rec)) api.toast('Could not save this session in the browser. It is still on screen.');
    L.data.sessions = [rec].concat(L.data.sessions.filter(s => s.id !== rec.id));
  }

  L.persist = persistSession;

  const entryOf = id => L.live && L.live.entries.get(id);
  L.entryOf = entryOf;
  L.assist = () => assistance(L.live.state);
  L.canRetry = () => canRetry(L.live.state);

  /* One entry action per stage; review and summary render, the rest start a drawing. */
  const ENTER = {
    [STAGE.observe]: async () => {
      const ref = await ensureRef(REF_ROLE.focus);
      if (ref) ui.observe.open(L, ref);
    },
    [STAGE.warmup]: () => runWarmup(),
    [STAGE.focused]: async () => {
      const ref = await ensureRef(REF_ROLE.focus);
      if (ref) runAttempt(ref, L.live.objectiveId, L.live.plan[STAGE.focused].secs);
    },
    [STAGE.review]: () => openReview(reviewedAttempt(L.live.state).id, REVIEW_FROM.session),
    [STAGE.correction]: () =>
      runAttempt(L.live.refs[REF_ROLE.focus], L.live.objectiveId, L.live.plan[STAGE.correction].secs),
    [STAGE.transfer]: async () => {
      const ref = await ensureRef(REF_ROLE.transfer);
      if (ref) runAttempt(ref, L.live.objectiveId, L.live.plan[STAGE.transfer].secs);
    },
    [STAGE.summary]: () => {
      api.stopDrawing();
      ui.summary.open(L);
    },
    [STAGE.completed]: () => finishToHome(),
  };

  function enterStage() {
    const fn = ENTER[L.live.state.stage];
    if (fn) Promise.resolve(fn()).catch(err => failStage(err));
  }

  function failStage(err) {
    console.error('[learn] stage failed', err);
    dispatch({ type: EVENT.error, message: (err && err.message) || 'error' });
    api.toast(
      err && err.message === REF_ERROR.noRefs
        ? 'Add some references first.'
        : 'Something went wrong preparing this step. Your finished drawings are kept.',
    );
    dispatch({ type: EVENT.endEarly });
  }

  async function ensureRef(role) {
    const live = L.live;
    if (live.refs[role]) return live.refs[role];
    const ref = await makeReference(api, live.objectiveId, {
      source: live.source,
      tier: live.tier,
      exclude: role === REF_ROLE.transfer ? live.refs[REF_ROLE.focus].meta : null,
    });
    if (L.live !== live) {
      releaseReference(ref);
      return null;
    }
    if (!dispatch({ type: EVENT.setReference, role, referenceId: ref.meta.id })) {
      releaseReference(ref);
      throw new Error('reference-rejected');
    }
    live.refs[role] = ref;
    await loadReference(ref);
    return ref;
  }

  async function runWarmup() {
    const live = L.live;
    const ref = await makeReference(api, live.warmObjectiveId, { source: live.source, tier: live.tier });
    if (L.live !== live) {
      releaseReference(ref);
      return;
    }
    live.extraRefs.push(ref);
    await loadReference(ref);
    runAttempt(ref, live.warmObjectiveId, live.plan[STAGE.warmup].secs);
  }

  function labelsFor(stage, objectiveId) {
    const live = L.live;
    const a = assistance(live.state);
    const O = OBJECTIVES[objectiveId];
    const reviewed = reviewedAttempt(live.state);
    const correction = stage === STAGE.correction && reviewed ? entryOf(reviewed.id).correctionObjective : '';
    const n = live.state.warmupDone + 1;
    const title =
      stage === STAGE.warmup ? `${STAGE_LABEL[stage]} ${n} of ${live.plan[STAGE.warmup].count}` : STAGE_LABEL[stage];
    let sub = '';
    if (stage === STAGE.correction) sub = correction ? 'Fix: ' + correction : 'Same reference, second try';
    else if (a.objective) sub = O.description + (stage === STAGE.warmup && live.warmIsReview ? ' (review)' : '');
    const focus = stage === STAGE.correction ? correction : a.objective ? O.description : '';
    return {
      title,
      sub,
      badge: stage === STAGE.transfer ? 'Independent test: no hints' : '',
      ready: {
        round: title,
        mode: api.MODES[O.toolMode].name + ', ' + live.ss.secs + ' s',
        focus: stage === STAGE.transfer ? 'New reference. Draw it on your own.' : focus,
        focusLabel: stage === STAGE.correction ? 'Fix: ' : stage === STAGE.transfer ? '' : 'Goal: ',
      },
    };
  }

  function runAttempt(ref, objectiveId, secs) {
    const live = L.live;
    const ss = live.ss;
    ss.mode = OBJECTIVES[objectiveId].toolMode;
    ss.secs = secs;
    ss.objectiveId = objectiveId;
    ss.ref = ref;
    const labels = labelsFor(live.state.stage, objectiveId);
    ss.ready = labels.ready;
    api.startV2Attempt(ss, ref, ref.img, labels);
  }

  function togglePause() {
    const live = L.live;
    const paused = !live.state.paused;
    if (dispatch({ type: paused ? EVENT.pause : EVENT.resume })) api.pauseV2(live.ss, paused);
  }

  /* ---------- attempts ---------- */

  function onAttemptDone(round) {
    const live = L.live;
    if (!live) return;
    const stage = live.state.stage;
    const type = ATTEMPT_TYPE_FOR_STAGE(stage);
    const ref = live.ss.ref;
    const objectiveId = live.ss.objectiveId;
    const O = OBJECTIVES[objectiveId];
    const reviewed = reviewedAttempt(live.state);
    const parentEntry = type === ATTEMPT_TYPE.correction && reviewed ? entryOf(reviewed.id) : null;
    const analysis = analyzeAttempt(objectiveId, {
      strokes: round.strokes,
      drawing: round.drawing,
      refImg: round.refImg,
      cw: round.cw,
      ch: round.ch,
      reference: ref.meta,
      silhouetteMask: ref.silhouetteMask,
      empty: round.empty,
    });
    const issues = rankIssues(analysis, O);
    const comparison = parentEntry ? compareAnalyses(parentEntry.analysis, analysis) : null;
    const entry = {
      id: uid('at'),
      type,
      stage,
      objectiveId,
      ref,
      round,
      analysis,
      issues,
      comparison,
      parentId: parentEntry ? parentEntry.id : null,
      guidance: live.state.guidance,
      correctionObjective: issues.primary ? issues.primary.objective : '',
      ai: { status: AI_STATUS.idle, feedback: null, flags: [], error: '', ctl: null, history: [] },
      createdAt: Date.now(),
    };
    live.entries.set(entry.id, entry);
    saveAttempt(entry);
    api.recordDrawings(1);
    // Record at once, so ending the session early can never leave a saved drawing outside the session record.
    const recorded = dispatch({ type: EVENT.attemptRecorded, attempt: { id: entry.id, referenceId: ref.meta.id } });
    // Until the warm-up count is reached the stage does not change, so start the next warm-up here, after a short gap.
    if (recorded && type === ATTEMPT_TYPE.warmup && live.state.stage === STAGE.warmup) {
      setTimeout(() => {
        if (L.live === live && live.state.stage === STAGE.warmup) enterStage();
      }, WARMUP_GAP_MS);
    }
  }

  function saveAttempt(entry) {
    const live = L.live;
    const rec = toAttemptRecord({
      id: entry.id,
      sessionId: live.state.id,
      referenceId: entry.ref.meta.id,
      objectiveId: entry.objectiveId,
      mode: OBJECTIVES[entry.objectiveId].toolMode,
      durationSec: entry.round.used,
      guidance: entry.type === ATTEMPT_TYPE.transfer ? GUIDANCE.independent : entry.guidance,
      type: entry.type,
      parentId: entry.parentId,
      analysis: entry.analysis,
      issues: entry.issues,
      comparison: entry.comparison,
      feedback: entry.ai.feedback
        ? { model: entry.ai.model || null, mainIssue: entry.ai.feedback.mainIssue, flags: entry.ai.flags }
        : null,
      createdAt: entry.createdAt,
    });
    if (!store.saveAttempt(rec)) api.toast('Could not save this drawing in the browser.');
    L.data.attempts = [rec].concat(L.data.attempts.filter(a => a.id !== rec.id));
  }
  L.saveAttempt = saveAttempt;

  /* The learner picks which stroke was the main line; measurements are recomputed with that choice. */
  L.selectCandidate = function selectCandidate(entry, index) {
    const r = entry.round;
    entry.analysis = analyzeAttempt(entry.objectiveId, {
      strokes: r.strokes,
      drawing: r.drawing,
      refImg: r.refImg,
      cw: r.cw,
      ch: r.ch,
      reference: entry.ref.meta,
      silhouetteMask: entry.ref.silhouetteMask,
      selection: index,
    });
    entry.issues = rankIssues(entry.analysis, OBJECTIVES[entry.objectiveId]);
    entry.correctionObjective = entry.issues.primary ? entry.issues.primary.objective : '';
    const parent = entry.parentId && entryOf(entry.parentId);
    if (parent) entry.comparison = compareAnalyses(parent.analysis, entry.analysis);
    for (const child of L.live.entries.values())
      if (child.parentId === entry.id) child.comparison = compareAnalyses(entry.analysis, child.analysis);
    saveAttempt(entry);
  };

  /* ---------- review ---------- */

  function openReview(attemptId, from) {
    const entry = entryOf(attemptId);
    const r = entry.round;
    r.onReview = f => ui.review.render(L, entry, f);
    r.onNext = f => {
      if (f === REVIEW_FROM.summary) {
        ui.summary.open(L);
        return;
      }
      dispatch({ type: EVENT.continue });
    };
    r.annotate = (ctx, o) => ui.review.annotate(L, entry, ctx, o);
    api.openReview(r, from);
  }
  L.openReview = openReview;

  /* ---------- AI coach ---------- */

  function coachImages(entry) {
    const r = entry.round;
    const ref = mkCanvas(r.cw, r.ch);
    ref.getContext('2d').drawImage(r.refImg, 0, 0, r.cw, r.ch);
    const drawing = mkCanvas(r.cw, r.ch);
    const g = drawing.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, r.cw, r.ch);
    g.drawImage(r.drawing, 0, 0);
    const overlay = mkCanvas(r.cw, r.ch);
    api.compose(overlay.getContext('2d'), r, api.OVERLAY_OPTS, null, 0);
    const b64 = c => c.toDataURL('image/jpeg', COACH_JPEG_QUALITY).split(',')[1];
    return [
      { role: IMAGE_ROLE.reference, mediaType: 'image/jpeg', data: b64(ref) },
      { role: IMAGE_ROLE.drawing, mediaType: 'image/jpeg', data: b64(drawing) },
      { role: IMAGE_ROLE.overlay, mediaType: 'image/jpeg', data: b64(overlay) },
    ];
  }

  L.askCoach = async function askCoach(entry, style) {
    if (!L.data.prefs.aiOptIn || !L.coach.available || entry.ai.status === AI_STATUS.pending || entry.round.empty)
      return;
    const ai = entry.ai;
    ai.status = AI_STATUS.pending;
    ai.error = '';
    ai.ctl = new AbortController();
    ui.review.refresh(L, entry);
    const parent = entry.parentId && entryOf(entry.parentId);
    const evidence = evidenceFor(entry.analysis).map(e => ({
      key: e.key,
      label: e.label,
      value: e.value,
      display: e.display,
      within: e.within,
    }));
    const payload = {
      objectiveId: entry.objectiveId,
      attemptType: entry.type,
      guidance: entry.guidance,
      secs: entry.round.secs,
      style: style || STYLE.normal,
      evidence,
      measuredIssue: entry.issues.primary
        ? { id: entry.issues.primary.id, measured: entry.issues.primary.measured }
        : null,
      previousFeedback: parent && parent.ai.feedback ? { mainIssue: parent.ai.feedback.mainIssue.slice(0, 300) } : null,
      images: coachImages(entry),
    };
    try {
      const res = await requestCoachFeedback(payload, { signal: ai.ctl.signal });
      if (ai.feedback) ai.history.push(ai.feedback);
      ai.feedback = res.feedback;
      ai.flags = res.flags;
      ai.model = res.model;
      ai.status = AI_STATUS.done;
      saveAttempt(entry);
    } catch (e) {
      // A failed coach request never touches the measured results or the session state.
      const code = e && e.code;
      if (code === ERROR_CODE.unavailable) L.coach = { available: false };
      ai.status = ai.feedback ? AI_STATUS.done : code === ERROR_CODE.cancelled ? AI_STATUS.idle : AI_STATUS.error;
      ai.error = code === ERROR_CODE.cancelled ? '' : ERROR_TEXT[code] || ERROR_TEXT[ERROR_CODE.providerError];
    } finally {
      ai.ctl = null;
      ui.review.refresh(L, entry);
    }
  };

  L.logDisagreement = function logDisagreement(entry, source, reason, note) {
    const rec = {
      id: uid('fb'),
      attemptId: entry.id,
      sessionId: L.live ? L.live.state.id : null,
      objectiveId: entry.objectiveId,
      source,
      reason,
      note: String(note || '').slice(0, 300),
      measuredIssue: entry.issues.primary ? entry.issues.primary.id : null,
      aiMainIssue:
        source === DISAGREE_SOURCE.ai && entry.ai.feedback ? entry.ai.feedback.mainIssue.slice(0, 300) : null,
      analysisVersion: entry.analysis.version,
      at: Date.now(),
    };
    L.data.feedbackLog = [rec].concat(L.data.feedbackLog || []);
    return store.logFeedback(rec);
  };

  /* ---------- ending ---------- */

  L.quit = async function quit() {
    const live = L.live;
    if (!live) return;
    const drawing =
      live.ss.cur && !live.ss.cur.drawing && live.state.stage !== STAGE.review && live.state.stage !== STAGE.observe;
    const wasPaused = live.state.paused;
    if (drawing && !wasPaused) togglePause();
    const kept = live.state.attempts.length;
    const ok = await api.confirmDialog(
      'End this session?',
      kept
        ? `Your ${kept} finished ${kept === 1 ? 'drawing is' : 'drawings are'} kept and the summary shows what you did. A drawing in progress is dropped.`
        : 'Nothing has been finished yet, so nothing will be saved.',
      'End session',
    );
    if (L.live !== live) return;
    if (!ok) {
      if (drawing && !wasPaused) togglePause();
      return;
    }
    api.stopDrawing();
    live.ss.ended = true;
    ui.observe.close();
    dispatch({ type: EVENT.endEarly });
  };

  L.finish = function finish() {
    if (!dispatch({ type: EVENT.finish })) finishToHome();
  };

  function finishToHome() {
    const live = L.live;
    if (live) {
      for (const e of live.entries.values()) if (e.ai.ctl) e.ai.ctl.abort();
      for (const ref of Object.values(live.refs).concat(live.extraRefs)) releaseReference(ref);
    }
    L.live = null;
    api.S.session = null;
    api.show('home');
    api.renderHome();
  }
  L.finishToHome = finishToHome;

  L.sessionTitle = () => SESSION_TEMPLATES[L.live.type].name;
  L.EVALUATOR = EVALUATOR;
  return L;
}
