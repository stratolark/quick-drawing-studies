/* Skill progress, recommendations and adaptive suggestions, derived on demand from stored attempts.
   Nothing here is stored separately, so progress can never drift out of sync with the attempts.
   Only measured independent (transfer) attempts count as evidence of skill; retries after feedback are
   tracked as their own category. Small samples report "not enough evidence" instead of a trend. */
import { OBJECTIVES, TRACKS, TRACK, GUIDANCE, GUIDANCE_LEVELS, objectivesForTrack, firstObjectiveOf } from './curriculum.js';
import { ATTEMPT_TYPE } from './session-engine.js';
import { METRICS, BETTER, withinTolerance } from '../analysis/metrics.js';
import { ISSUE_FOCUS, ISSUE_LABEL } from '../analysis/issues.js';
import { ANALYSIS_STATUS } from '../analysis/gesture.js';

export const MIN_SAMPLES = 3;        // fewest measured attempts before a median is shown
export const TREND_MIN_SAMPLES = 6;  // fewest before comparing the earliest and latest three
export const RECENT_WINDOW = 10;     // attempts examined for recurring difficulties
export const RECURRING_MIN = 2;      // an issue must appear at least this often to count as recurring
export const REVISIT_AFTER_DAYS = 5; // a practiced track not seen for this long is due for review
export const ADAPT_WINDOW = 3;       // consecutive independent attempts used for guidance and difficulty changes
export const MAX_TIER = 3;
export const MIN_TIER = 1;
const DAY_MS = 86400000;

export const ADAPT = Object.freeze({ keep: 'keep', lower: 'lower', raise: 'raise' });
export const TREND = Object.freeze({ insufficient: 'insufficient', improving: 'improving', worsening: 'worsening', flat: 'flat' });
export const RECOMMENDATION = Object.freeze({ weakness: 'weakness', reflection: 'reflection', revisit: 'revisit', progress: 'progress', continue: 'continue', start: 'start' });

/* Self-reflection answers. Subjective: used for suggestions, never mixed into measured progress. */
export const REFLECTION = {
  seeing: { label: 'Seeing the angles and shapes', track: TRACK.gesture },
  proportion: { label: 'Getting proportions right', track: TRACK.shape },
  space: { label: 'Making it look three-dimensional', track: TRACK.form },
  light: { label: 'Deciding what is light and dark', track: TRACK.values },
  speed: { label: 'Working within the time', track: null },
};

const median = xs => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const trackOf = a => (OBJECTIVES[a.objectiveId] || {}).track;

/* The comparable number for an attempt: the evaluator's primary metric, current analysis version only. */
export function primaryValue(a) {
  const an = a.analysis;
  if (!an || an.status !== ANALYSIS_STATUS.measured) return null;
  const def = METRICS[an.evaluator];
  if (!def || !def.primary || def.version !== an.version) return null;
  const row = def.rows.find(r => r.key === def.primary);
  const v = row.value(an.metrics || {});
  return v == null ? null : { value: v, row };
}

function trendOf(values, row) {
  if (values.length < TREND_MIN_SAMPLES) return { status: TREND.insufficient, early: null, recent: null };
  const early = median(values.slice(0, 3)), recent = median(values.slice(-3));
  const gain = row.better === BETTER.lower ? early - recent : recent - early;
  return { status: Math.abs(gain) < row.change ? TREND.flat : gain > 0 ? TREND.improving : TREND.worsening, early, recent };
}

export function trackProgress(track, attempts, sessions) {
  const mine = attempts.filter(a => trackOf(a) === track).sort((a, b) => a.createdAt - b.createdAt);
  const independent = mine.filter(a => a.type === ATTEMPT_TYPE.transfer).map(a => Object.assign({ a }, primaryValue(a))).filter(x => x.value != null);
  const row = independent.length ? independent[0].row : null;
  const values = independent.map(x => x.value);
  const corrections = mine.filter(a => a.type === ATTEMPT_TYPE.correction);
  const measuredRetries = corrections.filter(a => a.comparison && a.comparison.comparable);
  const improvedRetries = measuredRetries.filter(a => a.comparison.counts.improved > 0 && a.comparison.counts.worse === 0);
  const recent = mine.filter(a => a.type === ATTEMPT_TYPE.initial || a.type === ATTEMPT_TYPE.transfer).filter(a => a.analysis && a.analysis.status === ANALYSIS_STATUS.measured).slice(-RECENT_WINDOW);
  const counts = {};
  for (const a of recent) if (a.issues && a.issues.primary) counts[a.issues.primary] = (counts[a.issues.primary] || 0) + 1;
  const recurring = Object.entries(counts).filter(([, n]) => n >= RECURRING_MIN).sort((x, y) => y[1] - x[1])
    .map(([issueId, count]) => ({ issueId, label: ISSUE_LABEL[issueId] || issueId, count, of: recent.length }));
  const lastAt = mine.length ? mine[mine.length - 1].createdAt : null;
  return {
    track,
    activity: { attempts: mine.length, sessions: sessions.filter(s => s.objectiveId && OBJECTIVES[s.objectiveId] && OBJECTIVES[s.objectiveId].track === track).length, lastPracticedAt: lastAt },
    independent: {
      samples: values.length,
      sufficient: values.length >= MIN_SAMPLES,
      metric: row ? { key: row.key, label: row.label, tolerance: row.tolerance } : null,
      median: values.length >= MIN_SAMPLES ? median(values) : null,
      medianDisplay: values.length >= MIN_SAMPLES ? row.format(median(values)) : null,
      lastWithin: independent.slice(-ADAPT_WINDOW).map(x => withinTolerance(x.row, x.value)),
      trend: row ? trendOf(values, row) : { status: TREND.insufficient, early: null, recent: null },
    },
    correction: {
      retries: corrections.length,
      measured: measuredRetries.length,
      improvedRate: measuredRetries.length >= MIN_SAMPLES ? improvedRetries.length / measuredRetries.length : null,
    },
    recurring,
    coverage: [...new Set(mine.map(a => a.objectiveId))],
  };
}

export function computeProgress({ attempts, sessions }) {
  const out = {};
  for (const t of Object.keys(TRACKS)) out[t] = trackProgress(t, attempts || [], sessions || []);
  return out;
}

const prerequisitesMet = (id, practiced) => OBJECTIVES[id].prerequisites.every(p => practiced.has(p));

function objectiveFor(track, focus) {
  return objectivesForTrack(track).find(id => OBJECTIVES[id].focusMetric === focus) || firstObjectiveOf(track);
}

/* Next exercise, with the evidence behind it. Never invents history: with no data it says so. */
export function recommendNext({ progress, sessions, now }) {
  const tracks = Object.values(progress);
  const practiced = new Set(tracks.flatMap(t => t.coverage));
  if (!practiced.size) {
    return { kind: RECOMMENDATION.start, objectiveId: firstObjectiveOf(TRACK.gesture), reason: 'No practice is recorded yet, so start with the line of action.', evidence: [] };
  }
  // 1. A measured difficulty that keeps coming back.
  const weak = tracks.filter(t => t.recurring.length).sort((a, b) => b.recurring[0].count - a.recurring[0].count)[0];
  if (weak) {
    const r = weak.recurring[0];
    return {
      kind: RECOMMENDATION.weakness, track: weak.track, objectiveId: objectiveFor(weak.track, ISSUE_FOCUS[r.issueId]),
      reason: `Your last ${r.of} measured ${TRACKS[weak.track].short.toLowerCase()} studies showed trouble with ${r.label} ${r.count} times.`,
      evidence: [`${r.count} of ${r.of} measured attempts had "${r.label}" as the main issue.`],
    };
  }
  // 2. What the learner said was hardest (self-assessment, labelled as such).
  const lastReflection = (sessions || []).filter(s => s.reflection && s.reflection.choice).sort((a, b) => b.startedAt - a.startedAt)[0];
  const rf = lastReflection && REFLECTION[lastReflection.reflection.choice];
  if (rf && rf.track && now - lastReflection.startedAt < REVISIT_AFTER_DAYS * DAY_MS) {
    return { kind: RECOMMENDATION.reflection, track: rf.track, objectiveId: firstObjectiveOf(rf.track), reason: `You said "${rf.label.toLowerCase()}" was the hardest part last time. This is your own assessment, not a measurement.`, evidence: [] };
  }
  // 3. Spaced review of a track that has gone quiet.
  const due = tracks.filter(t => t.activity.lastPracticedAt && now - t.activity.lastPracticedAt > REVISIT_AFTER_DAYS * DAY_MS).sort((a, b) => a.activity.lastPracticedAt - b.activity.lastPracticedAt)[0];
  if (due) {
    const days = Math.floor((now - due.activity.lastPracticedAt) / DAY_MS);
    return { kind: RECOMMENDATION.revisit, track: due.track, objectiveId: due.coverage[0] || firstObjectiveOf(due.track), reason: `You last practiced ${TRACKS[due.track].short.toLowerCase()} ${days} days ago. A short review keeps it from fading.`, evidence: [] };
  }
  // 4. Progress to the next objective once independent results sit within tolerance.
  for (const t of tracks) {
    const ind = t.independent;
    if (!ind.sufficient || ind.metric == null) continue;
    const within = ind.lastWithin.length >= ADAPT_WINDOW && ind.lastWithin.every(Boolean);
    if (!within) continue;
    const next = objectivesForTrack(t.track).find(id => !practiced.has(id) && prerequisitesMet(id, practiced));
    const nextOther = Object.keys(OBJECTIVES).find(id => !practiced.has(id) && prerequisitesMet(id, practiced));
    const target = next || nextOther;
    if (target) {
      return { kind: RECOMMENDATION.progress, track: OBJECTIVES[target].track, objectiveId: target, reason: `Your last ${ADAPT_WINDOW} independent ${TRACKS[t.track].short.toLowerCase()} tests were within tolerance (median ${ind.metric.label.toLowerCase()} ${ind.medianDisplay}). Try something new.`, evidence: [] };
    }
  }
  // 5. Keep going with the most recent objective; there is not enough evidence to change course.
  const last = tracks.filter(t => t.activity.lastPracticedAt).sort((a, b) => b.activity.lastPracticedAt - a.activity.lastPracticedAt)[0];
  return { kind: RECOMMENDATION.continue, track: last.track, objectiveId: last.coverage[last.coverage.length - 1] || firstObjectiveOf(last.track), reason: 'Not enough independent results yet to suggest a change. Keep practicing the same skill.', evidence: [] };
}

/* Guidance changes only follow independent results on comparable exercises, never drawing counts or AI ratings. */
export function suggestGuidance(tp, level) {
  const last = tp.independent.lastWithin;
  const keep = reason => ({ level, change: ADAPT.keep, reason });
  if (last.length < ADAPT_WINDOW) return keep(`Needs ${ADAPT_WINDOW} independent tests on this skill before changing guidance (${last.length} so far).`);
  if (last.every(Boolean) && level > GUIDANCE.independent) {
    return { level: level - 1, change: ADAPT.lower, reason: `Your last ${ADAPT_WINDOW} independent tests were within tolerance, so try ${GUIDANCE_LEVELS[level - 1].name.toLowerCase()} mode.` };
  }
  if (last.every(v => v === false) && level < GUIDANCE.guided) {
    return { level: level + 1, change: ADAPT.raise, reason: `Your last ${ADAPT_WINDOW} independent tests were outside tolerance, so more guidance may help for now.` };
  }
  return keep('Recent independent results are mixed, so guidance stays the same.');
}

/* Difficulty moves one dimension at a time: guidance comes down first, then reference complexity goes up. */
export function suggestTier(tp, tier, guidance) {
  const last = tp.independent.lastWithin;
  const keep = reason => ({ tier, change: ADAPT.keep, reason });
  if (last.length < ADAPT_WINDOW) return keep('Not enough independent tests yet to change difficulty.');
  if (guidance > GUIDANCE.independent) return keep('Guidance is reduced before references get harder.');
  if (last.every(Boolean) && tier < MAX_TIER) return { tier: tier + 1, change: ADAPT.raise, reason: `Your last ${ADAPT_WINDOW} independent tests were within tolerance, so poses get more complex.` };
  if (last.every(v => v === false) && tier > MIN_TIER) return { tier: tier - 1, change: ADAPT.lower, reason: `Your last ${ADAPT_WINDOW} independent tests were outside tolerance, so poses get simpler for now.` };
  return keep('Recent results are mixed, so difficulty stays the same.');
}

/* A different, previously practiced track that is due for review, to interleave into warm-ups. */
export function dueReviewObjective(progress, currentTrack, now) {
  const due = Object.values(progress)
    .filter(t => t.track !== currentTrack && t.activity.lastPracticedAt && now - t.activity.lastPracticedAt > REVISIT_AFTER_DAYS * DAY_MS)
    .sort((a, b) => a.activity.lastPracticedAt - b.activity.lastPracticedAt)[0];
  return due ? { objectiveId: due.coverage[0] || firstObjectiveOf(due.track), track: due.track } : null;
}
