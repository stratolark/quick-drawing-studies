/* Session summary: what was practiced, what changed after feedback (only where measured), how the independent
   test went, what stayed difficult, and one recommended focus. No claim goes beyond the measurements. */
import { OBJECTIVES, GUIDANCE_LEVELS, SESSION_TEMPLATES, REF_SUBJECT } from '../learning/curriculum.js';
import { ATTEMPT_TYPE } from '../learning/session-engine.js';
import { REFLECTION, ADAPT } from '../learning/progress.js';
import { ISSUE_LABEL } from '../analysis/issues.js';
import { ANALYSIS_STATUS } from '../analysis/gesture.js';
import { VERDICT } from '../analysis/compare.js';
import { $, el } from '../util.js';

export const TYPE_LABEL = {
  [ATTEMPT_TYPE.warmup]: 'Warm-up',
  [ATTEMPT_TYPE.initial]: 'First try',
  [ATTEMPT_TYPE.correction]: 'Correction',
  [ATTEMPT_TYPE.transfer]: 'Independent test',
};

const panel = (title, ...kids) => el('section', { class: 'panel' }, el('h2', { text: title }), ...kids);
const p = text => el('p', { text });
const dim = text => el('p', { class: 'coach-note', text });

function changeText(c) {
  if (!c) return null;
  if (!c.comparable) return c.reason;
  const better = c.rows.filter(r => r.verdict === VERDICT.improved).map(r => r.label.toLowerCase());
  const worse = c.rows.filter(r => r.verdict === VERDICT.worse).map(r => r.label.toLowerCase());
  if (!better.length && !worse.length) return 'The measured values stayed about the same. Compare the two drawings to see what changed.';
  return [better.length ? 'Measurably better: ' + better.join(', ') + '.' : '', worse.length ? 'Measurably worse: ' + worse.join(', ') + '.' : ''].filter(Boolean).join(' ');
}

function suggestionRow(L, track, s, apply) {
  if (s.change === ADAPT.keep) return dim(s.reason);
  return el('div', { class: 'fb-block fb-next' }, el('p', { text: s.reason }),
    el('div', null, el('button', { class: 'btn', type: 'button', text: 'Apply', onclick: e => { apply(); L.savePrefs(); e.target.replaceWith(dim('Applied for your next session.')); } })));
}

function reflectionPanel(L) {
  const live = L.live;
  const state = { choice: live.reflection ? live.reflection.choice : null };
  const seg = el('div', { class: 'seg choices', role: 'radiogroup', 'aria-label': 'Hardest part' });
  const draw = () => L.api.seg(seg, Object.entries(REFLECTION).map(([k, v]) => [k, v.label]), state.choice, v => { state.choice = v; draw(); });
  draw();
  const text = el('input', { type: 'text', maxlength: '200', placeholder: 'Or in your own words (optional)', 'aria-label': 'Hardest part in your own words' });
  if (live.reflection && live.reflection.note) text.value = live.reflection.note;
  const saved = dim(live.reflection ? 'Saved.' : '');
  return panel('What was hardest today?', seg, el('div', { class: 'reflect-row' }, text,
    el('button', { class: 'btn', type: 'button', text: 'Save', onclick: () => {
      if (!state.choice && !text.value.trim()) return;
      live.reflection = { choice: state.choice, note: text.value.trim().slice(0, 200), at: Date.now() };
      L.persist();
      saved.textContent = 'Saved. This is used for suggestions and kept apart from measured results.';
    } })), saved);
}

export function open(L) {
  const live = L.live;
  const O = OBJECTIVES[live.objectiveId];
  const entries = [...live.entries.values()].sort((a, b) => a.createdAt - b.createdAt);
  const main = entries.filter(e => e.objectiveId === live.objectiveId);
  const corrections = main.filter(e => e.type === ATTEMPT_TYPE.correction);
  const transfer = main.find(e => e.type === ATTEMPT_TYPE.transfer);
  const lastCorrection = corrections[corrections.length - 1];

  $('#lsTitle').textContent = live.state.endedEarly ? 'Session ended' : 'Session done';
  $('#lsSub').textContent = SESSION_TEMPLATES[live.type].name + ': ' + O.description;

  const counts = Object.fromEntries(Object.keys(TYPE_LABEL).map(t => [t, entries.filter(e => e.type === t).length]));
  const practiced = panel('What you practiced',
    p(O.description),
    dim(Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `${n} ${TYPE_LABEL[t].toLowerCase()}${n > 1 && t !== ATTEMPT_TYPE.transfer ? 's' : ''}`).join(', ') || 'No finished drawings.'),
    live.warmIsReview ? dim('Warm-ups reviewed an earlier skill: ' + OBJECTIVES[live.warmObjectiveId].description) : null,
    live.observation ? dim('Observation check: ' + (live.observation.metrics && live.observation.metrics.orientationErrorDeg != null ? `your traced line was ${Math.round(live.observation.metrics.orientationErrorDeg)}° from the verified line of action.` : 'done.')) : null);

  const change = panel('After feedback', lastCorrection ? p(changeText(lastCorrection.comparison)) : p('You did not retry this reference, so there is nothing to compare.'),
    lastCorrection ? dim('This is the same reference drawn again with help, so it shows correction, not independent skill.') : null);

  let testBody;
  if (!transfer) testBody = [p(live.plan.transfer_test.enabled ? 'The independent test was skipped.' : 'This session type has no independent test. Turn it on under "Adjust stages" to check whether a fix carries over to a new reference.')];
  else if (transfer.analysis.status !== ANALYSIS_STATUS.measured) testBody = [p('The test drawing could not be measured.'), ...transfer.analysis.limitations.slice(0, 1).map(dim)];
  else if (transfer.issues.primary) testBody = [p(transfer.issues.primary.measured), dim('One test is a single sample; your progress page combines several before it shows a trend.')];
  else testBody = [p('The measured values were within tolerance on a reference you had not seen.'), dim('One test is a single sample; it does not prove the skill is settled.')];
  const test = panel('Independent test', ...testBody);

  const lastMeasured = [...main].reverse().find(e => e.issues && e.issues.measurable);
  const hard = lastMeasured && lastMeasured.issues.primary ? ISSUE_LABEL[lastMeasured.issues.primary.id] : null;
  const difficult = panel('Still difficult', p(hard ? 'The latest measured drawing still had trouble with ' + hard + '.' : lastMeasured ? 'Nothing measured stood out in the latest drawing.' : 'Nothing in this session could be measured.'));

  const rec = L.recommend();
  live.summary = { objectiveId: live.objectiveId, counts, transferIssue: transfer && transfer.issues.primary ? transfer.issues.primary.id : null, recommendation: { objectiveId: rec.objectiveId, reason: rec.reason } };
  L.persist();
  const s = L.suggestions(O.track);
  const prefs = L.data.prefs;
  const next = panel('Next time',
    el('div', { class: 'fb-block fb-next' }, el('h3', { text: 'Recommended focus' }), p(OBJECTIVES[rec.objectiveId].description), dim(rec.reason)),
    el('h3', { class: 'section-label', text: 'Guidance (' + GUIDANCE_LEVELS[prefs.guidance[O.track]].name + ')' }),
    suggestionRow(L, O.track, s.guidance, () => { prefs.guidance[O.track] = s.guidance.level; }),
    O.reference.subject === REF_SUBJECT.movement ? el('h3', { class: 'section-label', text: 'Pose difficulty (' + prefs.tier[O.track] + ' of 3)' }) : null,
    O.reference.subject === REF_SUBJECT.movement ? suggestionRow(L, O.track, s.tier, () => { prefs.tier[O.track] = s.tier.tier; }) : null);

  $('#lsBody').replaceChildren(practiced, change, test, difficult, next, reflectionPanel(L));
  $('#lsThumbs').replaceChildren(...entries.filter(e => e.round.drawing).map(e => el('button', { class: 'thumb', type: 'button', 'aria-label': 'Open ' + TYPE_LABEL[e.type], onclick: () => L.openReview(e.id, 'summary') },
    L.api.thumbCanvas(e.round),
    el('span', { class: 't-cap' }, el('span', { class: 't-type', text: TYPE_LABEL[e.type] }), el('span', { text: e.round.empty ? 'empty' : e.issues.primary ? 'one issue' : e.issues.measurable ? 'within tolerance' : 'not measured' })))));
  L.api.show('learnSummary');
}
