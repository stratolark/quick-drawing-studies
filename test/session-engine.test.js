import { describe, it, expect } from 'vitest';
import { createSession, transition, assistance, canRetry, EVENT, ATTEMPT_TYPE, REF_ROLE } from '../src/learning/session-engine.js';
import { buildPlan, planMinutes, SESSION_TYPE, STAGE, GUIDANCE, OBJECTIVES, OVERLAYS, objectiveIds } from '../src/learning/curriculum.js';
import { createStorage, memoryBackend, toSessionRecord } from '../src/learning/storage.js';

const OBJ = 'gesture.line-of-action';
const mk = (type = SESSION_TYPE.focused, overrides, guidance = GUIDANCE.assisted) =>
  createSession({ id: 's1', type, objectiveId: OBJ, plan: buildPlan(type, OBJ, overrides), guidance, now: 0 });

/* Apply events in order and fail loudly on any rejection. */
function run(state, events) {
  let s = state, t = 1;
  for (const ev of events) {
    const r = transition(s, ev, t++);
    if (!r.ok) throw new Error(`${ev.type} rejected in ${s.stage}: ${r.reason}`);
    s = r.state;
  }
  return s;
}
const att = (id, referenceId) => ({ type: EVENT.attemptRecorded, attempt: { id, referenceId } });

describe('curriculum plans', () => {
  it('builds the default 30-minute focused session from the brief', () => {
    const p = buildPlan(SESSION_TYPE.focused, OBJ);
    expect([p.observe.minutes, p.warmup.minutes, p.focused_practice.minutes, p.correction.minutes, p.transfer_test.minutes]).toEqual([3, 7, 10, 5, 5]);
    expect(planMinutes(p)).toBe(30);
    expect(p.warmup.count).toBeGreaterThanOrEqual(5);
    expect(p.transfer_test.enabled).toBe(true);
  });
  it('keeps the transfer test optional and off by default in quick practice', () => {
    expect(buildPlan(SESSION_TYPE.quick, OBJ).transfer_test.enabled).toBe(false);
    expect(buildPlan(SESSION_TYPE.quick, OBJ, { stages: { transfer_test: { enabled: true } } }).transfer_test.enabled).toBe(true);
  });
  it('lets the learner change durations but never disable the focused drawing', () => {
    const p = buildPlan(SESSION_TYPE.focused, OBJ, { stages: { focused_practice: { enabled: false, secs: 45 }, observe: { minutes: 1 } } });
    expect(p.focused_practice.enabled).toBe(true);
    expect(p.focused_practice.secs).toBe(45);
    expect(p.observe.minutes).toBe(1);
  });
  it('ignores corrupted stored overrides instead of producing NaN', () => {
    const p = buildPlan(SESSION_TYPE.focused, OBJ, { stages: { warmup: { secs: 'abc', count: null }, focused_practice: { secs: -5 }, observe: { minutes: 'x', enabled: 'yes' } } });
    expect(Number.isFinite(p.warmup.secs) && Number.isFinite(p.warmup.count)).toBe(true);
    expect(p.focused_practice.secs).toBe(90);
    expect(p.observe.minutes).toBe(3);
    expect(p.observe.enabled).toBe(true);
  });
  it('gives deep practice more retries and longer drawings', () => {
    const d = buildPlan(SESSION_TYPE.deep, OBJ), f = buildPlan(SESSION_TYPE.focused, OBJ);
    expect(d.correction.maxRetries).toBeGreaterThan(f.correction.maxRetries);
    expect(d.focused_practice.secs).toBeGreaterThan(f.focused_practice.secs);
  });
  it('every objective has a known evaluator, track, tool mode and timings', () => {
    for (const id of objectiveIds) {
      const O = OBJECTIVES[id];
      expect(O.secs.practice).toBeGreaterThan(0);
      for (const p of O.prerequisites) expect(OBJECTIVES[p]).toBeTruthy();
      expect(() => buildPlan(SESSION_TYPE.deep, id)).not.toThrow();
    }
  });
});

describe('session state machine', () => {
  it('runs a full Observe, Draw, Analyze, Correct, Transfer session', () => {
    const s0 = mk();
    const n = s0.plan.warmup.count;
    let s = run(s0, [{ type: EVENT.start }]);
    expect(s.stage).toBe(STAGE.observe);
    s = run(s, [{ type: EVENT.complete }]);
    expect(s.stage).toBe(STAGE.warmup);
    s = run(s, Array.from({ length: n }, (_, i) => att('w' + i, 'warm-' + i)));
    expect(s.stage).toBe(STAGE.focused);
    s = run(s, [{ type: EVENT.setReference, role: REF_ROLE.focus, referenceId: 'R1' }, att('a1', 'R1')]);
    expect(s.stage).toBe(STAGE.review);
    expect(s.reviewOf).toBe('a1');
    expect(canRetry(s)).toBe(true);
    s = run(s, [{ type: EVENT.retry }, att('a2', 'R1')]);
    const correction = s.attempts.find(a => a.id === 'a2');
    expect(correction.type).toBe(ATTEMPT_TYPE.correction);
    expect(correction.parentId).toBe('a1');
    expect(s.stage).toBe(STAGE.review);
    s = run(s, [{ type: EVENT.continue }]);
    expect(s.stage).toBe(STAGE.transfer);
    s = run(s, [{ type: EVENT.setReference, role: REF_ROLE.transfer, referenceId: 'R2' }, att('a3', 'R2')]);
    expect(s.attempts.find(a => a.id === 'a3').type).toBe(ATTEMPT_TYPE.transfer);
    expect(canRetry(s)).toBe(false);
    s = run(s, [{ type: EVENT.continue }]);
    expect(s.stage).toBe(STAGE.summary);
    s = run(s, [{ type: EVENT.finish }]);
    expect(s.stage).toBe(STAGE.completed);
    expect(s.endedAt).not.toBe(null);
    expect(s.attempts.map(a => a.type)).toEqual([...Array(n).fill('warmup'), 'initial', 'correction', 'transfer']);
  });

  it('skips optional stages and goes straight to the summary when the transfer test is off', () => {
    let s = run(mk(SESSION_TYPE.quick), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }]);
    expect(s.stage).toBe(STAGE.focused);
    s = run(s, [att('a1', 'R1'), { type: EVENT.continue }]);
    expect(s.stage).toBe(STAGE.summary);
  });

  it('starts at the first enabled stage when observation and warm-up are disabled', () => {
    const s = run(mk(SESSION_TYPE.focused, { stages: { observe: { enabled: false }, warmup: { enabled: false } } }), [{ type: EVENT.start }]);
    expect(s.stage).toBe(STAGE.focused);
  });

  it('refuses a retry once the retry budget is used', () => {
    let s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1'), { type: EVENT.retry }, att('a2', 'R1')]);
    const r = transition(s, { type: EVENT.retry });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('retry-not-available');
  });

  it('chains a second correction to the first in deep practice', () => {
    const s = run(mk(SESSION_TYPE.deep), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1'), { type: EVENT.retry }, att('a2', 'R1'), { type: EVENT.retry }, att('a3', 'R1')]);
    expect(s.attempts.find(a => a.id === 'a3').parentId).toBe('a2');
  });

  it('refuses a correction drawn from a different reference', () => {
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1'), { type: EVENT.retry }]);
    const r = transition(s, att('a2', 'OTHER'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('correction-must-use-same-reference');
  });

  it('requires the transfer test to use a new reference', () => {
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1'), { type: EVENT.continue }]);
    expect(transition(s, { type: EVENT.setReference, role: REF_ROLE.transfer, referenceId: 'R1' }).reason).toBe('transfer-reference-must-differ');
    expect(transition(s, att('t1', 'R1')).ok).toBe(false);
    const s2 = run(s, [{ type: EVENT.setReference, role: REF_ROLE.transfer, referenceId: 'R9' }]);
    expect(transition(s2, att('t1', 'R1')).reason).toBe('transfer-attempt-must-use-transfer-reference');
  });

  it('ends early into the summary and keeps finished work', () => {
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, att('w0', 'x'), { type: EVENT.endEarly }]);
    expect(s.stage).toBe(STAGE.summary);
    expect(s.endedEarly).toBe(true);
    expect(s.attempts).toHaveLength(1);
  });

  it('ends early with nothing drawn straight to completed', () => {
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.endEarly }]);
    expect(s.stage).toBe(STAGE.completed);
  });

  it('records errors without moving or dropping anything, and recovers', () => {
    const before = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1')]);
    const err = run(before, [{ type: EVENT.error, message: 'coach timeout' }]);
    expect(err.stage).toBe(before.stage);
    expect(err.attempts).toEqual(before.attempts);
    expect(err.error.message).toBe('coach timeout');
    const ok = run(err, [{ type: EVENT.recover }, { type: EVENT.retry }]);
    expect(ok.error).toBe(null);
    expect(ok.stage).toBe(STAGE.correction);
  });

  it('blocks drawing events while paused', () => {
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, { type: EVENT.pause }]);
    expect(transition(s, att('a1', 'R1')).reason).toBe('paused');
    expect(run(s, [{ type: EVENT.resume }, att('a1', 'R1')]).stage).toBe(STAGE.review);
  });

  it('rejects events that do not fit the stage', () => {
    const s = mk();
    expect(transition(s, { type: EVENT.continue }).ok).toBe(false);
    expect(transition(s, att('a', 'R')).ok).toBe(false);
    expect(transition(s, { type: 'NOPE' }).reason).toBe('unknown-event');
    expect(transition(run(s, [{ type: EVENT.start }]), { type: EVENT.start }).ok).toBe(false);
  });

  it('never mutates the previous state', () => {
    const s = mk();
    const snapshot = JSON.stringify(s);
    transition(s, { type: EVENT.start });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('assistance by stage', () => {
  it('shows nothing during the independent transfer test, whatever the guidance level', () => {
    for (const g of [GUIDANCE.independent, GUIDANCE.assisted, GUIDANCE.guided]) {
      const s = run(mk(SESSION_TYPE.focused, null, g), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1'), { type: EVENT.continue }]);
      expect(s.stage).toBe(STAGE.transfer);
      const a = assistance(s);
      expect(a).toEqual({ independent: true, questions: 0, objective: false, correction: false, guidesAfterObserve: OVERLAYS.none, constructionGuide: false, liveFeedback: false });
    }
  });
  it('scales observation help with the guidance level', () => {
    const at = g => assistance(run(mk(SESSION_TYPE.focused, null, g), [{ type: EVENT.start }]));
    expect(at(GUIDANCE.independent).questions).toBe(0);
    expect(at(GUIDANCE.assisted).questions).toBe(1);
    expect(at(GUIDANCE.guided).questions).toBe(2);
    expect(at(GUIDANCE.guided).guidesAfterObserve).toBe(OVERLAYS.auto);
    expect(at(GUIDANCE.assisted).guidesAfterObserve).toBe(OVERLAYS.onRequest);
  });
  it('shows the correction objective only during the correction', () => {
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }]);
    expect(assistance(s).correction).toBe(false);
    expect(assistance(run(s, [att('a1', 'R1'), { type: EVENT.retry }])).correction).toBe(true);
  });
  it('never gives live feedback while drawing', () => {
    let s = run(mk(SESSION_TYPE.focused, null, GUIDANCE.guided), [{ type: EVENT.start }, { type: EVENT.complete }]);
    expect(assistance(s).liveFeedback).toBe(false);
  });
});

describe('session persistence', () => {
  it('round-trips a session record through storage', () => {
    const backend = memoryBackend();
    const store = createStorage(backend);
    store.load();
    const s = run(mk(), [{ type: EVENT.start }, { type: EVENT.skip }, { type: EVENT.skip }, att('a1', 'R1'), { type: EVENT.endEarly }]);
    expect(store.saveSession(toSessionRecord(s, { summary: { note: 'x' } }))).toBe(true);
    const back = createStorage(backend).load().sessions[0];
    expect(back.id).toBe('s1');
    expect(back.attempts).toEqual(s.attempts);
    expect(back.endedEarly).toBe(true);
  });
});
