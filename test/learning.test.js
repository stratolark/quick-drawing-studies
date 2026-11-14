import { describe, it, expect } from 'vitest';
import { computeProgress, trackProgress, recommendNext, suggestGuidance, suggestTier, dueReviewObjective, RECOMMENDATION, TREND, MIN_SAMPLES } from '../src/learning/progress.js';
import { GUIDANCE, TRACK } from '../src/learning/curriculum.js';
import { ATTEMPT_TYPE } from '../src/learning/session-engine.js';
import { createStorage, memoryBackend, KEYS, STORAGE_SCHEMA_VERSION, toAttemptRecord, normalizeClassicSession } from '../src/learning/storage.js';
import { GESTURE_ANALYSIS_VERSION } from '../src/analysis/gesture.js';

const DAY = 86400000;
const NOW = 100 * DAY;
let n = 0;
/* A stored gesture attempt with a measured tilt error and an optional primary issue. */
function attempt(type, tiltErr, opts = {}) {
  n++;
  return {
    id: 'a' + n, sessionId: opts.session || 's1', objectiveId: opts.objective || 'gesture.line-of-action', type,
    referenceId: 'r' + n, parentId: opts.parent || null, createdAt: opts.at || NOW - DAY + n * 1000,
    analysis: tiltErr == null ? { version: GESTURE_ANALYSIS_VERSION, evaluator: 'gesture-line', status: 'unavailable', metrics: {} }
      : { version: opts.version || GESTURE_ANALYSIS_VERSION, evaluator: 'gesture-line', status: 'measured', metrics: { orientationErrorDeg: tiltErr, bowError: 0.02, shapeError: 0.1 } },
    issues: { primary: opts.issue || null, others: [] },
    comparison: opts.comparison || null,
  };
}

describe('skill progress', () => {
  it('counts only independent transfer attempts as evidence of skill', () => {
    const atts = [attempt(ATTEMPT_TYPE.initial, 30), attempt(ATTEMPT_TYPE.correction, 2), attempt(ATTEMPT_TYPE.correction, 3), attempt(ATTEMPT_TYPE.transfer, 20)];
    const p = trackProgress(TRACK.gesture, atts, []);
    expect(p.independent.samples).toBe(1);
    expect(p.correction.retries).toBe(2);
    expect(p.activity.attempts).toBe(4);
  });

  it('withholds medians and trends with too few independent samples', () => {
    const p = trackProgress(TRACK.gesture, [attempt(ATTEMPT_TYPE.transfer, 10), attempt(ATTEMPT_TYPE.transfer, 5)], []);
    expect(p.independent.sufficient).toBe(false);
    expect(p.independent.median).toBe(null);
    expect(p.independent.trend.status).toBe(TREND.insufficient);
  });

  it('reports a trend only with enough samples and a real change', () => {
    const improving = [25, 22, 24, 6, 5, 7].map(v => attempt(ATTEMPT_TYPE.transfer, v));
    expect(trackProgress(TRACK.gesture, improving, []).independent.trend.status).toBe(TREND.improving);
    const flat = [10, 11, 9, 10, 9, 11].map(v => attempt(ATTEMPT_TYPE.transfer, v));
    expect(trackProgress(TRACK.gesture, flat, []).independent.trend.status).toBe(TREND.flat);
    const p = trackProgress(TRACK.gesture, improving.slice(0, MIN_SAMPLES), []);
    expect(p.independent.median).toBe(24);
  });

  it('ignores results from an older analysis version', () => {
    const p = trackProgress(TRACK.gesture, [attempt(ATTEMPT_TYPE.transfer, 10, { version: 'gesture-0' })], []);
    expect(p.independent.samples).toBe(0);
  });

  it('withholds a retry improvement rate until enough retries were measured', () => {
    const good = { comparable: true, counts: { improved: 1, worse: 0, similar: 2, unavailable: 0 } };
    const p = trackProgress(TRACK.gesture, [attempt(ATTEMPT_TYPE.correction, 3, { comparison: good })], []);
    expect(p.correction.improvedRate).toBe(null);
    const p3 = trackProgress(TRACK.gesture, [1, 2, 3].map(() => attempt(ATTEMPT_TYPE.correction, 3, { comparison: good })), []);
    expect(p3.correction.improvedRate).toBe(1);
  });

  it('finds recurring difficulties from measured attempts', () => {
    const atts = [attempt(ATTEMPT_TYPE.transfer, 20, { issue: 'gesture.orientation' }), attempt(ATTEMPT_TYPE.initial, 18, { issue: 'gesture.orientation' }), attempt(ATTEMPT_TYPE.initial, 4, { issue: 'gesture.curvature-amount' })];
    const p = trackProgress(TRACK.gesture, atts, []);
    expect(p.recurring).toHaveLength(1);
    expect(p.recurring[0]).toMatchObject({ issueId: 'gesture.orientation', count: 2, of: 3 });
  });
});

describe('recommendations', () => {
  it('does not invent a history for a new learner', () => {
    const r = recommendNext({ progress: computeProgress({ attempts: [], sessions: [] }), sessions: [], now: NOW });
    expect(r.kind).toBe(RECOMMENDATION.start);
    expect(r.evidence).toEqual([]);
    expect(r.reason).toMatch(/No practice/);
  });

  it('targets a recurring measured difficulty with its evidence', () => {
    const atts = [1, 2, 3].map(() => attempt(ATTEMPT_TYPE.transfer, 20, { issue: 'gesture.orientation' }));
    const r = recommendNext({ progress: computeProgress({ attempts: atts, sessions: [] }), sessions: [], now: NOW });
    expect(r.kind).toBe(RECOMMENDATION.weakness);
    expect(r.objectiveId).toBe('gesture.torso-tilt');
    expect(r.reason).toMatch(/3 times/);
  });

  it('labels a self-reported difficulty as subjective', () => {
    const atts = [attempt(ATTEMPT_TYPE.initial, null)];
    const sessions = [{ id: 's1', objectiveId: 'gesture.line-of-action', startedAt: NOW - DAY, reflection: { choice: 'light' } }];
    const r = recommendNext({ progress: computeProgress({ attempts: atts, sessions }), sessions, now: NOW });
    expect(r.kind).toBe(RECOMMENDATION.reflection);
    expect(r.reason).toMatch(/not a measurement/);
  });

  it('schedules a review of a skill that has gone quiet', () => {
    const atts = [attempt(ATTEMPT_TYPE.initial, null, { at: NOW - 9 * DAY })];
    const r = recommendNext({ progress: computeProgress({ attempts: atts, sessions: [] }), sessions: [], now: NOW });
    expect(r.kind).toBe(RECOMMENDATION.revisit);
    expect(r.reason).toMatch(/9 days ago/);
    expect(dueReviewObjective(computeProgress({ attempts: atts, sessions: [] }), TRACK.shape, NOW).track).toBe(TRACK.gesture);
    expect(dueReviewObjective(computeProgress({ attempts: atts, sessions: [] }), TRACK.gesture, NOW)).toBe(null);
  });

  it('moves on only after independent results sit within tolerance', () => {
    const atts = [3, 4, 5].map(v => attempt(ATTEMPT_TYPE.transfer, v));
    const r = recommendNext({ progress: computeProgress({ attempts: atts, sessions: [] }), sessions: [], now: NOW });
    expect(r.kind).toBe(RECOMMENDATION.progress);
    expect(r.objectiveId).toBe('gesture.torso-tilt');
  });
});

describe('guidance and difficulty', () => {
  const tp = vals => trackProgress(TRACK.gesture, vals.map(v => attempt(ATTEMPT_TYPE.transfer, v)), []);

  it('lowers guidance after repeated independent success and explains why', () => {
    const s = suggestGuidance(tp([3, 4, 5]), GUIDANCE.guided);
    expect(s).toMatchObject({ level: GUIDANCE.assisted, change: 'lower' });
    expect(s.reason).toMatch(/within tolerance/);
  });

  it('does not change guidance on drawing counts alone', () => {
    const many = Array.from({ length: 12 }, () => attempt(ATTEMPT_TYPE.correction, 2));
    const s = suggestGuidance(trackProgress(TRACK.gesture, many, []), GUIDANCE.guided);
    expect(s.change).toBe('keep');
    expect(s.reason).toMatch(/Needs 3 independent tests/);
  });

  it('raises guidance after repeated independent misses', () => {
    expect(suggestGuidance(tp([20, 25, 30]), GUIDANCE.independent)).toMatchObject({ level: GUIDANCE.assisted, change: 'raise' });
  });

  it('changes one difficulty dimension at a time', () => {
    expect(suggestTier(tp([3, 4, 5]), 1, GUIDANCE.assisted).change).toBe('keep');
    expect(suggestTier(tp([3, 4, 5]), 1, GUIDANCE.independent)).toMatchObject({ tier: 2, change: 'raise' });
    expect(suggestTier(tp([20, 25, 30]), 2, GUIDANCE.independent)).toMatchObject({ tier: 1, change: 'lower' });
  });
});

describe('storage migration', () => {
  const v1 = {
    [KEYS.v1Sessions]: JSON.stringify([{ id: 1700000000000, date: '2023-11-14', mode: 'gesture', secs: 15, subject: 'movement', count: 5, avg: 3.4 }, { nope: true }]),
    [KEYS.v1Profile]: JSON.stringify({ days: { '2023-11-14': 5 }, total: 5 }),
    [KEYS.v1Settings]: JSON.stringify({ mode: 'values' }),
  };

  it('migrates a V1 browser to schema 2 without touching V1 keys', () => {
    const backend = memoryBackend(v1);
    const data = createStorage(backend).load();
    expect(data.migrated).toBe(true);
    expect(data.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(data.sessions).toEqual([]);
    expect(data.prefs.aiOptIn).toBe(false);
    const dump = backend.dump();
    for (const k of [KEYS.v1Sessions, KEYS.v1Profile, KEYS.v1Settings]) expect(dump[k]).toBe(v1[k]);
    expect(JSON.parse(dump[KEYS.meta]).schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
  });

  it('is idempotent', () => {
    const backend = memoryBackend(v1);
    createStorage(backend).load();
    const again = createStorage(backend).load();
    expect(again.migrated).toBe(false);
  });

  it('reads old classic sessions through the adapter, keeping uncalibrated scores apart', () => {
    const list = createStorage(memoryBackend(v1)).classicSessions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'v1-1700000000000', type: 'classic', mode: 'gesture', count: 5, uncalibratedScore: 3.4 });
    expect(normalizeClassicSession(null)).toBe(null);
  });

  it('survives corrupt JSON and invalid preferences', () => {
    const backend = memoryBackend({ [KEYS.attempts]: '{not json', [KEYS.prefs]: JSON.stringify({ guidance: { gesture: 9 }, aiOptIn: 'yes' }), [KEYS.meta]: JSON.stringify({ schemaVersion: 2 }) });
    const data = createStorage(backend).load();
    expect(data.attempts).toEqual([]);
    expect(data.prefs.guidance.gesture).toBe(GUIDANCE.assisted);
    expect(data.prefs.aiOptIn).toBe(false);
  });

  it('caps stored attempts and keeps the newest first', () => {
    const store = createStorage(memoryBackend());
    store.load();
    for (let i = 0; i < 405; i++) store.saveAttempt(toAttemptRecord({ id: 'x' + i, sessionId: 's', referenceId: 'r', objectiveId: 'gesture.line-of-action', type: 'initial', createdAt: i }));
    const data = store.load();
    expect(data.attempts).toHaveLength(400);
    expect(data.attempts[0].id).toBe('x404');
  });

  it('keeps going when the store is full by dropping the oldest records', () => {
    let fail = true;
    const inner = memoryBackend();
    const backend = { get: inner.get, set: (k, v) => { if (fail && k === KEYS.attempts && v.length > 400) { fail = false; throw new Error('QuotaExceeded'); } inner.set(k, v); } };
    const store = createStorage(backend);
    store.load();
    expect(store.saveAttempt(toAttemptRecord({ id: 'big', sessionId: 's', referenceId: 'r', objectiveId: 'gesture.line-of-action', type: 'initial', createdAt: 1, feedback: { note: 'x'.repeat(500) } }))).toBe(true);
  });

  it('links a correction attempt record to the original attempt', () => {
    const rec = toAttemptRecord({ id: 'c1', sessionId: 's', referenceId: 'R1', objectiveId: 'gesture.line-of-action', type: ATTEMPT_TYPE.correction, parentId: 'a1', createdAt: 1 });
    expect(rec.parentId).toBe('a1');
    expect(rec.referenceId).toBe('R1');
  });
});
