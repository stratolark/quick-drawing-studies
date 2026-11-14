/* Versioned browser storage for V2 learning data, with migrations.
   V1 keys (qs.settings, qs.profile, qs.sessions) stay owned by the classic flow and are never rewritten;
   V2 reads old classic sessions through classicSessions() instead of copying them, so nothing drifts.
   Raw strokes are not stored; attempts keep a compact analysis (for gesture, a 24-point line). */
import { GUIDANCE, TRACKS } from './curriculum.js';

export const STORAGE_SCHEMA_VERSION = 2;

export const KEYS = Object.freeze({
  meta: 'qs.v2.meta',
  sessions: 'qs.v2.sessions',
  attempts: 'qs.v2.attempts',
  prefs: 'qs.v2.prefs',
  feedbackLog: 'qs.v2.feedback',
  v1Sessions: 'qs.sessions',
  v1Profile: 'qs.profile',
  v1Settings: 'qs.settings',
});

/* Caps keep localStorage well under its usual 5 MB limit. */
export const LIMITS = Object.freeze({ sessions: 80, attempts: 400, feedbackLog: 200 });

export const DEFAULT_PREFS = Object.freeze({
  guidance: Object.fromEntries(Object.keys(TRACKS).map(t => [t, GUIDANCE.assisted])),
  tier: Object.fromEntries(Object.keys(TRACKS).map(t => [t, 1])),
  aiOptIn: false,
  overrides: {},
  lastType: 'focused',
});

/* Migrations from schema N to N+1. Schema 1 is the V1 app, which had no V2 keys at all. */
const MIGRATIONS = {
  1: data => Object.assign({}, data, { sessions: [], attempts: [], prefs: clonePrefs(DEFAULT_PREFS), feedbackLog: [] }),
};

function clonePrefs(p) { return JSON.parse(JSON.stringify(p)); }

/* localStorage-shaped backend; tests pass a Map-backed one. */
export function browserBackend() {
  return {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { localStorage.setItem(k, v); },
  };
}

export function memoryBackend(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); }, dump: () => Object.fromEntries(m) };
}

function readJSON(backend, key, fallback) {
  const raw = backend.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

const asArray = v => (Array.isArray(v) ? v : []);

function normalizePrefs(p) {
  const base = clonePrefs(DEFAULT_PREFS);
  if (!p || typeof p !== 'object') return base;
  for (const t of Object.keys(TRACKS)) {
    if (p.guidance && Number.isInteger(p.guidance[t]) && p.guidance[t] >= GUIDANCE.independent && p.guidance[t] <= GUIDANCE.guided) base.guidance[t] = p.guidance[t];
    if (p.tier && Number.isInteger(p.tier[t]) && p.tier[t] >= 1 && p.tier[t] <= 3) base.tier[t] = p.tier[t];
  }
  base.aiOptIn = p.aiOptIn === true;
  if (p.overrides && typeof p.overrides === 'object') base.overrides = p.overrides;
  if (typeof p.lastType === 'string') base.lastType = p.lastType;
  return base;
}

export function createStorage(backend) {
  backend = backend || browserBackend();

  function write(key, value) {
    try { backend.set(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function load() {
    const meta = readJSON(backend, KEYS.meta, null);
    let version = meta && Number.isInteger(meta.schemaVersion) ? meta.schemaVersion : 1;
    let data = {
      sessions: asArray(readJSON(backend, KEYS.sessions, [])),
      attempts: asArray(readJSON(backend, KEYS.attempts, [])),
      prefs: readJSON(backend, KEYS.prefs, null),
      feedbackLog: asArray(readJSON(backend, KEYS.feedbackLog, [])),
    };
    const migrated = version < STORAGE_SCHEMA_VERSION;
    while (version < STORAGE_SCHEMA_VERSION) {
      const step = MIGRATIONS[version];
      if (!step) throw new Error('no migration from schema ' + version);
      data = step(data);
      version++;
    }
    data.prefs = normalizePrefs(data.prefs);
    data.sessions = data.sessions.filter(s => s && s.id);
    data.attempts = data.attempts.filter(a => a && a.id && a.sessionId);
    if (migrated) {
      write(KEYS.sessions, data.sessions);
      write(KEYS.attempts, data.attempts);
      write(KEYS.prefs, data.prefs);
      write(KEYS.feedbackLog, data.feedbackLog);
      write(KEYS.meta, { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: Date.now(), from: meta ? meta.schemaVersion : 1 });
    }
    return Object.assign({ schemaVersion: STORAGE_SCHEMA_VERSION, migrated }, data);
  }

  /* Insert or replace by id, newest first, capped. On a full store, drop the oldest half and retry once. */
  function upsert(key, record, limit) {
    const all = asArray(readJSON(backend, key, [])).filter(x => x && x.id !== record.id);
    all.unshift(record);
    let list = all.slice(0, limit);
    if (write(key, list)) return true;
    list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
    return write(key, list);
  }

  return {
    load,
    saveSession: s => upsert(KEYS.sessions, s, LIMITS.sessions),
    saveAttempt: a => upsert(KEYS.attempts, a, LIMITS.attempts),
    savePrefs: p => write(KEYS.prefs, normalizePrefs(p)),
    logFeedback: entry => upsert(KEYS.feedbackLog, entry, LIMITS.feedbackLog),
    classicSessions: () => asArray(readJSON(backend, KEYS.v1Sessions, [])).map(normalizeClassicSession).filter(Boolean),
  };
}

/* V1 session records, read as-is and normalized for display. Missing fields become null, not guesses. */
export function normalizeClassicSession(h) {
  if (!h || typeof h !== 'object' || h.id == null) return null;
  return {
    id: 'v1-' + h.id,
    type: 'classic',
    mode: typeof h.mode === 'string' ? h.mode : null,
    date: typeof h.date === 'string' ? h.date : null,
    startedAt: Number(h.id) || null,
    count: Number(h.count) || 0,
    secs: Number(h.secs) || null,
    subject: typeof h.subject === 'string' ? h.subject : null,
    // V1 coach scores were never calibrated; they are kept only so old history still displays.
    uncalibratedScore: typeof h.avg === 'number' ? h.avg : null,
  };
}

/* ---------- record builders: the documented JSON shapes (see docs/DATA_MODEL.md) ---------- */

export const RECORD_VERSION = 1;

/* DrawingReference without blobs or URLs. Generated references can be re-rendered from seed and options. */
export function toReferenceRecord(meta) {
  if (!meta) return null;
  const g = meta.geometry || {};
  return {
    recordVersion: RECORD_VERSION,
    id: meta.id, source: meta.source, metaVersion: meta.metaVersion || null,
    generator: meta.generator || null, kind: meta.kind || null, scene: meta.scene || null,
    seed: meta.seed == null ? null : meta.seed, options: meta.options || null,
    width: meta.width, height: meta.height, label: meta.label || '',
    difficulty: meta.difficulty || null,
    camera: meta.camera || null,
    geometry: {
      coordinateSystem: g.coordinateSystem || null,
      actionLine: g.actionLine || null,
      landmarks: g.landmarks || null,
      silhouetteBBox: g.silhouette ? g.silhouette.bbox : null,
      horizon: g.horizon || null,
      vanishingPoints: g.vanishingPoints || null,
      light: g.light ? { side: g.light.side, fromAbove: g.light.fromAbove } : null,
    },
  };
}

/* DrawingAttempt. analysis is reduced to what progress and history need. */
export function toAttemptRecord({ id, sessionId, referenceId, objectiveId, mode, durationSec, guidance, type, parentId, analysis, issues, comparison, feedback, createdAt }) {
  return {
    recordVersion: RECORD_VERSION,
    id, sessionId, referenceId, objectiveId, mode,
    durationSec: Math.round(durationSec || 0),
    guidance, type, parentId: parentId || null,
    analysis: analysis ? {
      version: analysis.version, evaluator: analysis.evaluator, status: analysis.status,
      metrics: analysis.metrics || {}, tolerances: analysis.tolerances || {},
      limitations: analysis.limitations || [],
      selection: analysis.selection ? { index: analysis.selection.index, source: analysis.selection.source } : null,
      compact: analysis.compact || null,
    } : null,
    issues: issues ? { primary: issues.primary ? issues.primary.id : null, others: (issues.others || []).map(i => i.id) } : null,
    comparison: comparison ? { comparable: comparison.comparable, counts: comparison.counts, rows: (comparison.rows || []).map(r => ({ key: r.key, before: r.before, after: r.after, verdict: r.verdict })) } : null,
    feedback: feedback || null,
    createdAt,
  };
}

/* LearningSession: the engine state plus the summary and the reference records it used. */
export function toSessionRecord(state, extras) {
  const e = extras || {};
  return {
    recordVersion: RECORD_VERSION,
    schemaVersion: state.schemaVersion,
    id: state.id, type: state.type, objectiveId: state.objectiveId,
    guidance: state.guidance, plan: state.plan,
    stage: state.stage, endedEarly: state.endedEarly,
    attempts: state.attempts,
    references: e.references || {},
    corrections: e.corrections || [],
    transfer: e.transfer || null,
    summary: e.summary || null,
    reflection: e.reflection || null,
    startedAt: state.startedAt, endedAt: state.endedAt,
  };
}
