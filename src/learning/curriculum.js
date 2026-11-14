/* Curriculum: skill tracks, learning objectives, evaluators, guidance levels and session templates.
   Every table here is keyed by its id so per-variant behaviour lives in data, not in branches.
   Prerequisites and durations are adjustable guidance, not established rules of art education. */

export const CURRICULUM_VERSION = 1;

/* ---------- skill tracks ---------- */
export const TRACK = Object.freeze({
  gesture: 'gesture',
  shape: 'shape',
  form: 'form',
  values: 'values',
});

export const TRACKS = {
  [TRACK.gesture]: { name: 'Gesture and movement', short: 'Gesture', about: 'Rhythm, pose, weight and direction.' },
  [TRACK.shape]: { name: 'Shape and proportion', short: 'Shapes', about: 'Silhouettes, negative space and relative size.' },
  [TRACK.form]: { name: 'Form and perspective', short: 'Form', about: 'Three-dimensional construction and space.' },
  [TRACK.values]: { name: 'Values and lighting', short: 'Values', about: 'Tonal groups and basic light behaviour.' },
};

/* ---------- reference metadata an evaluator or interaction depends on ---------- */
export const REF_NEED = Object.freeze({ actionLine: 'actionLine', silhouette: 'silhouette', horizon: 'horizon', pixels: 'pixels' });

/* ---------- evaluators: which local analysis can measure an attempt ---------- */
export const EVALUATOR = Object.freeze({
  gestureLine: 'gesture-line',
  shapeSilhouette: 'shape-silhouette',
  valueMasses: 'value-masses',
  none: 'none',
});

/* `needs` names the reference metadata an evaluator requires; without it the analysis reports itself unavailable. */
export const EVALUATORS = {
  [EVALUATOR.gestureLine]: { needs: REF_NEED.actionLine, label: 'Line of action' },
  [EVALUATOR.shapeSilhouette]: { needs: REF_NEED.silhouette, label: 'Silhouette proportions' },
  [EVALUATOR.valueMasses]: { needs: REF_NEED.pixels, label: 'Value grouping' },
  [EVALUATOR.none]: { needs: null, label: 'Self-check only' },
};

/* ---------- observation interactions ---------- */
export const INTERACTION = Object.freeze({
  traceActionLine: 'trace-action-line',
  boxSubject: 'box-subject',
  markHorizon: 'mark-horizon',
  tapDarkest: 'tap-darkest',
});

export const INTERACTIONS = {
  [INTERACTION.traceActionLine]: { prompt: 'Trace the line of action on the reference with one stroke.', needs: REF_NEED.actionLine },
  [INTERACTION.boxSubject]: { prompt: 'Drag a box around the whole figure.', needs: REF_NEED.silhouette },
  [INTERACTION.markHorizon]: { prompt: 'Click where you think the horizon is.', needs: REF_NEED.horizon },
  [INTERACTION.tapDarkest]: { prompt: 'Click inside the largest dark region.', needs: REF_NEED.pixels },
};

/* ---------- guidance levels ---------- */
export const GUIDANCE = Object.freeze({ independent: 0, assisted: 1, guided: 2 });
export const OVERLAYS = Object.freeze({ none: 'none', onRequest: 'on-request', auto: 'auto' });
export const GUIDANCE_LEVELS = {
  [GUIDANCE.independent]: { name: 'Independent', about: 'No hints before or during drawing.', questions: 0, overlaysAfterObserve: OVERLAYS.none, objectiveWhileDrawing: false },
  [GUIDANCE.assisted]: { name: 'Assisted', about: 'Brief questions, overlays only when you ask.', questions: 1, overlaysAfterObserve: OVERLAYS.onRequest, objectiveWhileDrawing: true },
  [GUIDANCE.guided]: { name: 'Guided', about: 'Questions and structural overlays after you try.', questions: 2, overlaysAfterObserve: OVERLAYS.auto, objectiveWhileDrawing: true },
};

/* ---------- reference requests: what kind of reference an objective draws from ---------- */
export const REF_SUBJECT = Object.freeze({ movement: 'movement', perspective: 'perspective' });

/* ---------- learning objectives ---------- */
/* toolMode picks the existing drawing tool set (gesture: pen; shapes: lasso/cut/pen; values: three greys).
   focusMetric says which measured issue matters most for this objective, so feedback stays on topic.
   secs are default seconds per attempt by stage role; templates scale them. */
export const OBJECTIVES = {
  'gesture.line-of-action': {
    // Direction and curvature both count here, so neither is boosted; a large tilt error must not hide behind a small bend error (2026-11-14).
    track: TRACK.gesture, toolMode: 'gesture', evaluator: EVALUATOR.gestureLine, focusMetric: null,
    description: 'Capture the direction and curvature of the main line of action.',
    criteria: ['The main line leans the same way as the reference.', 'It bends in the same direction and about as much.'],
    exercises: ['Single-line gesture', 'Line of action first, then masses'],
    reference: { subject: REF_SUBJECT.movement },
    interaction: INTERACTION.traceActionLine,
    questions: ['What is the main direction of movement?', 'Which way does the line of action bend?', 'Where is the weight?'],
    selfCheck: ['Does your main line lean and curve the same way as the reference?', 'Is the weight over the same foot?'],
    secs: { warmup: 30, practice: 90, transfer: 60 },
    prerequisites: [],
  },
  'gesture.torso-tilt': {
    track: TRACK.gesture, toolMode: 'gesture', evaluator: EVALUATOR.gestureLine, focusMetric: 'orientation',
    description: 'Match the lean of the torso and the overall tilt of the pose.',
    criteria: ['The main axis is tilted like the reference.', 'Shoulders and hips tilt the same way.'],
    exercises: ['Torso-axis studies', 'Shoulder and hip tilt lines'],
    reference: { subject: REF_SUBJECT.movement },
    interaction: INTERACTION.traceActionLine,
    questions: ['Is the torso leaning left or right?', 'How do the shoulders and hips tilt against each other?'],
    selfCheck: ['Is your main axis tilted the same amount?', 'Do the shoulders and hips tilt the same way?'],
    secs: { warmup: 30, practice: 90, transfer: 60 },
    prerequisites: ['gesture.line-of-action'],
  },
  'shape.silhouette': {
    track: TRACK.shape, toolMode: 'shapes', evaluator: EVALUATOR.shapeSilhouette, focusMetric: 'proportion',
    description: 'Block in the silhouette as two or three big shapes with the right height-to-width ratio.',
    criteria: ['Height-to-width ratio is close.', 'The big masses and gaps are in the same places.'],
    exercises: ['Silhouette fills', 'Negative space cut-outs'],
    reference: { subject: REF_SUBJECT.movement },
    interaction: INTERACTION.boxSubject,
    questions: ['Is the subject taller or wider?', 'What are the two or three largest shapes?', 'Which gaps matter most?'],
    selfCheck: ['Does your silhouette have the same big masses?', 'Do the gaps match in size and angle?', 'Is the height-to-width ratio close?'],
    secs: { warmup: 45, practice: 120, transfer: 90 },
    prerequisites: [],
  },
  'form.simple-forms': {
    track: TRACK.form, toolMode: 'gesture', evaluator: EVALUATOR.none, focusMetric: null,
    description: 'Draw the boxes as see-through forms with edges that converge consistently.',
    criteria: ['Parallel edges converge toward shared points.', 'Hidden edges are drawn so each box reads as a solid.'],
    exercises: ['Transparent boxes', 'Boxes in two-point perspective'],
    reference: { subject: REF_SUBJECT.perspective, scene: 'boxes' },
    interaction: INTERACTION.markHorizon,
    questions: ['Where is the horizon?', 'Which edges appear to converge?', 'What are the largest forms?'],
    selfCheck: ['Do parallel edges head toward the same vanishing point?', 'Does each box look solid, not flat?'],
    secs: { warmup: 60, practice: 300, transfer: 240 },
    prerequisites: ['shape.silhouette'],
  },
  'form.perspective-space': {
    track: TRACK.form, toolMode: 'gesture', evaluator: EVALUATOR.none, focusMetric: null,
    description: 'Place the horizon and build the space with lines that converge to it.',
    criteria: ['The horizon sits at the same height.', 'Receding lines meet on the horizon.'],
    exercises: ['One-point streets', 'Colonnades'],
    reference: { subject: REF_SUBJECT.perspective, scene: 'street' },
    interaction: INTERACTION.markHorizon,
    questions: ['Where is the horizon?', 'Where do the receding lines meet?'],
    selfCheck: ['Is your horizon at the same height?', 'Do your receding lines meet on it?'],
    secs: { warmup: 60, practice: 300, transfer: 240 },
    prerequisites: ['form.simple-forms'],
  },
  'values.three-values': {
    track: TRACK.values, toolMode: 'values', evaluator: EVALUATOR.valueMasses, focusMetric: 'darkCoverage',
    description: 'Group the image into three values: the paper as light, one mid grey and one dark.',
    criteria: ['Dark areas cover about as much as in the reference.', 'Texture and detail are left out.'],
    exercises: ['Three-value thumbnails', 'Shadow shapes only'],
    reference: { subject: REF_SUBJECT.perspective, scene: 'still' },
    interaction: INTERACTION.tapDarkest,
    questions: ['Where are the largest dark regions?', 'Which details can be ignored?'],
    selfCheck: ['Did the darkest areas land in the same places?', 'Did you keep it to three values?'],
    secs: { warmup: 45, practice: 120, transfer: 90 },
    prerequisites: [],
  },
  'values.light-direction': {
    track: TRACK.values, toolMode: 'values', evaluator: EVALUATOR.valueMasses, focusMetric: 'darkPlacement',
    description: 'Place the shadow shapes so all the light comes from one direction.',
    criteria: ['Dark shapes sit where the reference has them.', 'Shadows are consistent with one light.'],
    exercises: ['Form and cast shadows', 'Light-direction thumbnails'],
    reference: { subject: REF_SUBJECT.movement },
    interaction: INTERACTION.tapDarkest,
    questions: ['What direction does the light come from?', 'Where are the cast shadows?'],
    selfCheck: ['Does all the light come from one side?', 'Are the shadow shapes in the same places?'],
    secs: { warmup: 45, practice: 150, transfer: 120 },
    prerequisites: ['values.three-values'],
  },
};

export const objectiveIds = Object.keys(OBJECTIVES);
export const objectivesForTrack = track => objectiveIds.filter(id => OBJECTIVES[id].track === track);
export const firstObjectiveOf = track => objectivesForTrack(track).find(id => OBJECTIVES[id].prerequisites.length === 0) || objectivesForTrack(track)[0];

/* ---------- session types and stages ---------- */
export const SESSION_TYPE = Object.freeze({ quick: 'quick', focused: 'focused', deep: 'deep' });

export const STAGE = Object.freeze({
  setup: 'setup',
  observe: 'observe',
  warmup: 'warmup',
  focused: 'focused_practice',
  review: 'review',
  correction: 'correction',
  transfer: 'transfer_test',
  summary: 'summary',
  completed: 'completed',
});

/* Stages a learner works through, in order. review and summary are entered by the engine, not planned. */
export const PLANNED_STAGES = [STAGE.observe, STAGE.warmup, STAGE.focused, STAGE.correction, STAGE.transfer];

/* Seconds a warm-up drawing costs beyond its own timer: countdown, glance at the overlay. */
export const WARMUP_OVERHEAD_S = 15;

/* Defaults from the brief. They are configurable starting points, not validated optimal values. */
export const SESSION_TEMPLATES = {
  [SESSION_TYPE.quick]: {
    name: 'Quick Practice', minutes: 8, about: 'A few short drawings, one comparison, one retry.',
    practiceScale: 0.67,
    stages: {
      [STAGE.observe]: { enabled: true, optional: true, minutes: 1 },
      [STAGE.warmup]: { enabled: true, optional: true, minutes: 2, count: 3 },
      [STAGE.focused]: { enabled: true, optional: false, minutes: 3 },
      [STAGE.correction]: { enabled: true, optional: true, minutes: 2, maxRetries: 1 },
      [STAGE.transfer]: { enabled: false, optional: true, minutes: 2 },
    },
  },
  [SESSION_TYPE.focused]: {
    name: 'Focused Practice', minutes: 30, about: 'Observe, draw, analyze, correct, then a test on a new reference.',
    practiceScale: 1,
    stages: {
      [STAGE.observe]: { enabled: true, optional: true, minutes: 3 },
      [STAGE.warmup]: { enabled: true, optional: true, minutes: 7 },
      [STAGE.focused]: { enabled: true, optional: false, minutes: 10 },
      [STAGE.correction]: { enabled: true, optional: true, minutes: 5, maxRetries: 1 },
      [STAGE.transfer]: { enabled: true, optional: true, minutes: 5 },
    },
  },
  [SESSION_TYPE.deep]: {
    name: 'Deep Practice', minutes: 45, about: 'Longer studies with more attempts and deeper analysis.',
    practiceScale: 2,
    stages: {
      [STAGE.observe]: { enabled: true, optional: true, minutes: 4 },
      [STAGE.warmup]: { enabled: true, optional: true, minutes: 6 },
      [STAGE.focused]: { enabled: true, optional: false, minutes: 15 },
      [STAGE.correction]: { enabled: true, optional: true, minutes: 12, maxRetries: 2 },
      [STAGE.transfer]: { enabled: true, optional: true, minutes: 8 },
    },
  },
};

export const MIN_ATTEMPT_SECS = 10;
export const MAX_ATTEMPT_SECS = 1800;
const clampSecs = s => Math.max(MIN_ATTEMPT_SECS, Math.min(MAX_ATTEMPT_SECS, Math.round(s)));
/* Stored overrides are untrusted: anything that is not a positive number falls back to the template. */
const positive = v => (Number.isFinite(v) && v > 0 ? v : null);

/* Build a concrete plan from a template, an objective and the learner's overrides.
   overrides: { stages: { [stage]: { enabled?, minutes?, secs?, count? } } } */
export function buildPlan(type, objectiveId, overrides) {
  const T = SESSION_TEMPLATES[type];
  const O = OBJECTIVES[objectiveId];
  if (!T) throw new Error('unknown session type: ' + type);
  if (!O) throw new Error('unknown objective: ' + objectiveId);
  const ov = (overrides && overrides.stages) || {};
  const plan = {};
  for (const stage of PLANNED_STAGES) {
    const base = T.stages[stage];
    const raw = ov[stage] || {};
    const o = { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : null, minutes: positive(raw.minutes), secs: positive(raw.secs), count: positive(raw.count), maxRetries: positive(raw.maxRetries) };
    const enabled = base.optional ? (o.enabled != null ? !!o.enabled : base.enabled) : true;
    const minutes = o.minutes || base.minutes;
    const entry = { stage, enabled, optional: base.optional, minutes };
    if (stage === STAGE.warmup) {
      entry.secs = clampSecs(o.secs || O.secs.warmup);
      const fit = Math.floor(minutes * 60 / (entry.secs + WARMUP_OVERHEAD_S));
      entry.count = Math.max(1, Math.round(o.count || base.count || fit));
    } else if (stage === STAGE.focused || stage === STAGE.correction) {
      entry.secs = clampSecs(o.secs || O.secs.practice * T.practiceScale);
      if (stage === STAGE.correction) entry.maxRetries = Math.max(1, o.maxRetries || base.maxRetries);
    } else if (stage === STAGE.transfer) {
      entry.secs = clampSecs(o.secs || O.secs.transfer * T.practiceScale);
    }
    plan[stage] = entry;
  }
  return plan;
}

export function planMinutes(plan) {
  return PLANNED_STAGES.reduce((n, s) => n + (plan[s].enabled ? plan[s].minutes : 0), 0);
}
