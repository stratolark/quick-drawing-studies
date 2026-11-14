/* Home practice section, the progress panel on the start screen and the progress page.
   Recommendations show their reason; progress keeps activity, retries and independent results apart. */
import { OBJECTIVES, TRACKS, GUIDANCE_LEVELS, SESSION_TEMPLATES, SESSION_TYPE, STAGE, PLANNED_STAGES, buildPlan, planMinutes, objectivesForTrack, REF_SUBJECT } from '../learning/curriculum.js';
import { TREND, REFLECTION, RECOMMENDATION, ADAPT } from '../learning/progress.js';
import { setAccessCode, getAccessCode } from '../coach/client.js';
import { REF_SOURCE } from './references.js';
import { $, el, fmtDate, todayKey } from '../util.js';

const STAGE_NAME = {
  [STAGE.observe]: 'Observation',
  [STAGE.warmup]: 'Warm-up',
  [STAGE.focused]: 'Focused drawing',
  [STAGE.correction]: 'Correction',
  [STAGE.transfer]: 'Independent test',
};
const TREND_TEXT = {
  [TREND.insufficient]: 'Not enough tests for a trend yet',
  [TREND.improving]: 'Improving',
  [TREND.worsening]: 'Getting worse',
  [TREND.flat]: 'No clear change',
};
const RECENT_ITEMS = 6;

const sel = { type: null, objectiveId: null, objectiveTouched: false, source: REF_SOURCE.generated };

function overridesFor(L, type) {
  const o = L.data.prefs.overrides;
  if (!o[type]) o[type] = { stages: {} };
  if (!o[type].stages) o[type].stages = {};
  return o[type];
}

function numberInput(value, min, max, label, onchange) {
  const i = el('input', { type: 'number', min: String(min), max: String(max), value: String(value), 'aria-label': label });
  i.addEventListener('change', () => { const v = Math.round(Number(i.value)); if (v >= min && v <= max) onchange(v); else i.value = String(value); });
  return i;
}

function renderStages(L, plan) {
  const ov = overridesFor(L, sel.type);
  const set = (stage, patch) => { ov.stages[stage] = Object.assign({}, ov.stages[stage], patch); L.savePrefs(); renderPractice(L); };
  const rows = [el('span', { class: 'head', text: 'Stage' }), el('span', { class: 'head', text: 'Minutes' }), el('span', { class: 'head', text: 'Drawings' }), el('span', { class: 'head', text: 'Seconds each' })];
  for (const stage of PLANNED_STAGES) {
    const s = plan[stage];
    const id = 'stage-' + stage;
    const cb = el('input', { type: 'checkbox', id, onchange: e => set(stage, { enabled: e.target.checked }) });
    cb.checked = s.enabled;
    cb.disabled = !s.optional;
    rows.push(el('label', { class: 'toggle', for: id }, cb, el('span', { text: STAGE_NAME[stage] + (s.optional ? '' : ' (always on)') })));
    rows.push(numberInput(s.minutes, 1, 60, STAGE_NAME[stage] + ' minutes', v => set(stage, { minutes: v })));
    rows.push(stage === STAGE.warmup ? numberInput(s.count, 1, 20, 'Warm-up drawings', v => set(stage, { count: v })) : el('span', { class: 'na', text: stage === STAGE.correction ? 'up to ' + s.maxRetries : '' }));
    rows.push(s.secs ? el('span', { class: 'secs' }, numberInput(s.secs, 10, 1800, STAGE_NAME[stage] + ' seconds per drawing', v => set(stage, { secs: v }))) : el('span', { class: 'secs na', text: '' }));
  }
  const reset = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Reset to defaults', onclick: () => { L.data.prefs.overrides[sel.type] = { stages: {} }; L.savePrefs(); renderPractice(L); } });
  $('#stageRows').replaceChildren(...rows, reset);
  $('#stagesSummary').textContent = planMinutes(plan) + ' min, ' + PLANNED_STAGES.filter(s => plan[s].enabled).length + ' stages';
}

function coachSettings(L) {
  const c = L.coach;
  if (!c.available) return el('span', { text: 'AI coach not connected: measurements and self-checks still work.' });
  const cb = el('input', { type: 'checkbox', id: 'homeAiOptIn', onchange: e => { L.data.prefs.aiOptIn = e.target.checked; L.savePrefs(); } });
  cb.checked = L.data.prefs.aiOptIn;
  const kids = [el('label', { class: 'toggle', for: 'homeAiOptIn' }, cb, el('span', { text: 'Allow sending drawings to the AI coach when I ask' + (c.provider === 'mock' ? ' (mock coach)' : '') }))];
  if (c.needsAccess) {
    const input = el('input', { type: 'password', class: 'select', placeholder: 'Coach access code', 'aria-label': 'Coach access code', autocomplete: 'off' });
    input.value = getAccessCode();
    input.addEventListener('change', () => setAccessCode(input.value.trim()));
    kids.push(input);
  }
  return el('span', { class: 'reflect-row' }, ...kids);
}

export function renderPractice(L) {
  const api = L.api;
  const prefs = L.data.prefs;
  const rec = L.recommend();
  if (!sel.type) sel.type = SESSION_TEMPLATES[prefs.lastType] ? prefs.lastType : SESSION_TYPE.focused;
  if (!sel.objectiveTouched || !OBJECTIVES[sel.objectiveId]) sel.objectiveId = rec.objectiveId;
  const O = OBJECTIVES[sel.objectiveId];

  $('#todayCard').replaceChildren(...[
    el('span', { class: 'label', text: rec.kind === RECOMMENDATION.start ? 'Start here' : "Today's focus" }),
    el('span', { class: 'text', text: OBJECTIVES[rec.objectiveId].description }),
    el('span', { class: 'src', text: rec.reason }),
    sel.objectiveId !== rec.objectiveId ? el('button', { class: 'btn', type: 'button', text: 'Use this', onclick: () => { sel.objectiveTouched = false; renderPractice(L); } }) : null].filter(Boolean));

  $('#typeCards').replaceChildren(...Object.entries(SESSION_TEMPLATES).map(([id, T]) => el('button', {
    class: 'mode-card', type: 'button', role: 'radio', 'aria-checked': String(id === sel.type),
    onclick: () => { sel.type = id; renderPractice(L); },
  }, el('span', { class: 'm-name', text: T.name.split(' ')[0] }), el('span', { class: 'm-time', text: planMinutes(buildPlan(id, sel.objectiveId, prefs.overrides[id])) + ' min' }), el('span', { class: 'm-trains', text: T.about }))));

  const select = $('#objectiveSelect');
  select.replaceChildren(...Object.entries(TRACKS).map(([t, info]) => el('optgroup', { label: info.name },
    ...objectivesForTrack(t).map(id => { const o = el('option', { value: id, text: OBJECTIVES[id].description + (id === rec.objectiveId ? ' (recommended)' : '') }); o.selected = id === sel.objectiveId; return o; }))));
  select.onchange = () => { sel.objectiveId = select.value; sel.objectiveTouched = true; renderPractice(L); };
  const practicedIds = new Set(L.data.attempts.map(a => a.objectiveId));
  const missing = O.prerequisites.filter(p => !practicedIds.has(p));
  const tier = prefs.tier[O.track];
  $('#objectiveNote').textContent = [
    missing.length ? 'Builds on: ' + missing.map(m => OBJECTIVES[m].description.toLowerCase()).join('; ') + ' (you can still choose it).' : '',
    O.reference.subject === REF_SUBJECT.movement ? 'Pose difficulty ' + tier + ' of 3.' : '',
  ].filter(Boolean).join(' ');

  const g = prefs.guidance[O.track];
  api.seg($('#segGuidance'), Object.entries(GUIDANCE_LEVELS).map(([lvl, G]) => [Number(lvl), G.name]), g, v => { prefs.guidance[O.track] = v; L.savePrefs(); renderPractice(L); });
  const sug = L.suggestions(O.track).guidance;
  const gNote = $('#guidanceNote');
  gNote.replaceChildren(...[GUIDANCE_LEVELS[g].about + ' ', sug.change !== ADAPT.keep ? el('button', { class: 'btn btn-ghost', type: 'button', text: 'Suggested: ' + GUIDANCE_LEVELS[sug.level].name, title: sug.reason, onclick: () => { prefs.guidance[O.track] = sug.level; L.savePrefs(); renderPractice(L); } }) : null].filter(Boolean));

  const plan = buildPlan(sel.type, sel.objectiveId, prefs.overrides[sel.type]);
  renderStages(L, plan);

  const mine = api.S.refs.filter(r => r.category === O.reference.subject).length;
  if (!api.canGenerate()) sel.source = REF_SOURCE.mine;
  const start = $('#learnStart');
  start.textContent = 'Start ' + SESSION_TEMPLATES[sel.type].name;
  start.disabled = !api.canGenerate() && !mine;
  start.onclick = () => { prefs.lastType = sel.type; L.savePrefs(); sel.objectiveTouched = false; L.start({ type: sel.type, objectiveId: sel.objectiveId, source: sel.source }); };
  const noteKids = [];
  if (api.canGenerate() && mine) {
    const box = el('span', { class: 'seg', role: 'radiogroup', 'aria-label': 'References' });
    api.seg(box, [[REF_SOURCE.generated, 'Generated'], [REF_SOURCE.mine, 'My images']], sel.source, v => { sel.source = v; renderPractice(L); });
    noteKids.push(box, ' ');
    if (sel.source === REF_SOURCE.mine) noteKids.push(el('span', { text: 'Your images have no verified geometry, so measurements are limited to self-checks. ' }));
  }
  noteKids.push(coachSettings(L));
  $('#learnNote').replaceChildren(...noteKids);
}

/* ---------- progress ---------- */

function recentItems(L) {
  // Sessions with no finished drawing carry nothing worth listing; unfinished ones were interrupted (tab closed or reloaded).
  const v2 = L.data.sessions.filter(s => (s.attempts || []).length).map(s => ({ at: s.startedAt, title: (SESSION_TEMPLATES[s.type] ? SESSION_TEMPLATES[s.type].name : 'Session') + (s.endedEarly ? ' (ended early)' : s.stage === STAGE.summary || s.stage === STAGE.completed ? '' : ' (interrupted)'), sub: OBJECTIVES[s.objectiveId] ? OBJECTIVES[s.objectiveId].description : '', n: (s.attempts || []).length }));
  const classic = L.store.classicSessions().map(s => ({ at: s.startedAt, title: 'Timed studies, ' + s.count + ' × ' + (s.secs || '?') + ' s', sub: s.mode ? s.mode.charAt(0).toUpperCase() + s.mode.slice(1) : '', n: s.count }));
  return v2.concat(classic).filter(i => i.at).sort((a, b) => b.at - a.at).slice(0, RECENT_ITEMS);
}

function renderBrief(L) {
  const prog = L.progress();
  const tests = Object.values(prog).reduce((n, t) => n + t.independent.samples, 0);
  const recurring = Object.values(prog).flatMap(t => t.recurring).sort((a, b) => b.count - a.count)[0];
  const practiced = Object.values(prog).filter(t => t.activity.attempts).map(t => TRACKS[t.track].short);
  $('#progressBrief').replaceChildren(
    el('div', { class: 'stat-line' }, el('span', { text: 'Skills practiced' }), el('b', { text: practiced.join(', ') || 'None yet' })),
    el('div', { class: 'stat-line' }, el('span', { text: 'Measured independent tests' }), el('b', { text: String(tests) })),
    el('div', { class: 'stat-line' }, el('span', { text: 'Keeps coming up' }), el('b', { text: recurring ? recurring.label + ' (' + recurring.count + ' of ' + recurring.of + ')' : 'Not enough data' })));
  const items = recentItems(L);
  $('#historyList').replaceChildren(...(items.length ? items.map(i => el('li', null,
    el('span', { class: 'h-main', text: i.title }),
    el('span', { class: 'h-sub', text: [fmtDate(todayKey(new Date(i.at))), i.sub].filter(Boolean).join(' · ') }),
    el('span', { class: 'h-score', title: 'Finished drawings', text: String(i.n) }))) : [el('li', { class: 'empty', text: 'Finished sessions show up here.' })]));
}

function line(label, value) { return el('div', { class: 'stat-line' }, el('span', { text: label }), el('b', { text: value })); }

export function renderProgressPage(L) {
  const prog = L.progress();
  const rec = L.recommend();
  const panels = [el('section', { class: 'panel' }, el('h2', { text: 'Recommended next' }), el('p', { text: OBJECTIVES[rec.objectiveId].description }), el('p', { class: 'coach-note', text: rec.reason }))];
  for (const t of Object.values(prog)) {
    const ind = t.independent;
    const kids = [el('h2', { text: TRACKS[t.track].name })];
    if (!t.activity.attempts) { kids.push(el('p', { class: 'coach-note', text: 'Not practiced yet.' })); panels.push(el('section', { class: 'panel' }, ...kids)); continue; }
    kids.push(el('h3', { class: 'section-label', text: 'Practice activity' }),
      line('Drawings', String(t.activity.attempts)),
      line('Last practiced', t.activity.lastPracticedAt ? fmtDate(todayKey(new Date(t.activity.lastPracticedAt))) : '—'),
      line('Exercises covered', t.coverage.length + ' of ' + objectivesForTrack(t.track).length));
    kids.push(el('h3', { class: 'section-label', text: 'Independent performance (new references, no hints)' }));
    if (!ind.metric) kids.push(el('p', { class: 'coach-note', text: 'No measured independent tests yet.' }));
    else {
      kids.push(line('Measured tests', String(ind.samples)));
      kids.push(line('Median ' + ind.metric.label.toLowerCase(), ind.sufficient ? ind.medianDisplay : 'Needs 3 tests (' + ind.samples + ' so far)'));
      kids.push(line('Trend', TREND_TEXT[ind.trend.status]));
    }
    kids.push(el('h3', { class: 'section-label', text: 'Retries after feedback (assisted)' }),
      line('Retries', String(t.correction.retries)),
      line('Measurably better', t.correction.improvedRate == null ? (t.correction.measured ? 'Needs 3 measured retries' : '—') : Math.round(t.correction.improvedRate * 100) + '% of ' + t.correction.measured));
    kids.push(el('h3', { class: 'section-label', text: 'Recurring difficulties' }));
    kids.push(t.recurring.length ? el('ul', { class: 'questions' }, ...t.recurring.map(r => el('li', { text: r.label + ': ' + r.count + ' of last ' + r.of }))) : el('p', { class: 'coach-note', text: 'None recorded.' }));
    panels.push(el('section', { class: 'panel' }, ...kids));
  }
  const reflections = L.data.sessions.filter(s => s.reflection).slice(0, 3);
  if (reflections.length) panels.push(el('section', { class: 'panel' }, el('h2', { text: 'Your notes' }), el('p', { class: 'coach-note', text: 'Your own assessment, kept apart from measurements.' }),
    el('ul', { class: 'questions' }, ...reflections.map(s => el('li', { text: fmtDate(todayKey(new Date(s.startedAt))) + ': ' + [s.reflection.choice && REFLECTION[s.reflection.choice] ? REFLECTION[s.reflection.choice].label : '', s.reflection.note].filter(Boolean).join(', ') })))));
  panels.push(el('section', { class: 'panel' }, el('h2', { text: 'About these numbers' }),
    el('p', { class: 'coach-note', text: 'Only independent tests count as skill evidence. Medians need at least 3 tests and trends at least 6. Results from older analysis versions are left out. Measurements cover the main line, silhouette proportions and value placement only; they do not judge artistic quality.' })));
  $('#progressBody').replaceChildren(...panels);
}

export function renderHomeV2(L) {
  renderPractice(L);
  renderBrief(L);
}

