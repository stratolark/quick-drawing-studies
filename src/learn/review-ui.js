/* Review panel for one attempt: measured results first, then the before-and-after comparison, then the optional
   AI coach, which is labelled as suggestions and can never change the measured part. */
import { OBJECTIVES, STAGE, GUIDANCE, EVALUATOR } from '../learning/curriculum.js';
import { ATTEMPT_TYPE, EVENT } from '../learning/session-engine.js';
import { ANALYSIS_STATUS } from '../analysis/gesture.js';
import { evidenceFor, BETTER } from '../analysis/metrics.js';
import { VERDICT } from '../analysis/compare.js';
import { STYLE } from '../coach/schema.js';
import { AI_STATUS, REVIEW_FROM, DISAGREE_SOURCE } from './controller.js';
import { COLORS, GUIDE_LABEL, GUIDE_NOTE, constructionSteps, drawReviewAnnotations, playSteps } from './guides.js';
import { $, el } from '../util.js';

const TITLE = {
  [ATTEMPT_TYPE.warmup]: 'Warm-up',
  [ATTEMPT_TYPE.initial]: 'Review',
  [ATTEMPT_TYPE.correction]: 'Before and after',
  [ATTEMPT_TYPE.transfer]: 'Independent test',
};
const VERDICT_TEXT = {
  [VERDICT.improved]: 'Better, by measurement',
  [VERDICT.worse]: 'Worse, by measurement',
  [VERDICT.similar]: 'About the same',
  [VERDICT.unavailable]: 'Not measured',
};
const DISAGREE_REASONS = [
  ['not-there', 'That mistake is not in my drawing'],
  ['off-topic', 'Not what this exercise is about'],
  ['unclear', 'I do not understand it'],
  ['other', 'Something else'],
];
const ANNOTATION_LABELS = {
  [EVALUATOR.gestureLine]: { reference: 'Reference line of action', mine: 'Your main line, as measured' },
  [EVALUATOR.shapeSilhouette]: { reference: 'Reference silhouette box', mine: 'Your silhouette box' },
  [EVALUATOR.valueMasses]: { reference: 'Reference dark group', mine: null },
  [EVALUATOR.none]: { reference: null, mine: null },
};

const block = (cls, title, ...kids) =>
  el('div', { class: 'fb-block' + (cls ? ' ' + cls : '') }, title ? el('h3', { text: title }) : null, ...kids);
const note = text => el('p', { class: 'coach-note', text });

function isCurrentReview(L, entry) {
  const live = L.live;
  return live && live.state.stage === STAGE.review && live.state.reviewOf === entry.id;
}

function continueLabel(L, entry) {
  const live = L.live;
  if (entry.type === ATTEMPT_TYPE.transfer || !live.plan[STAGE.transfer].enabled) {
    return 'See summary';
  }
  return 'Continue to the test';
}

/* ---------- measured section ---------- */

function evidenceTable(analysis) {
  const rows = evidenceFor(analysis);
  if (!rows.length) {
    return null;
  }
  return el(
    'table',
    { class: 'ev-table' },
    el(
      'thead',
      null,
      el(
        'tr',
        null,
        el('th', { text: 'Measured' }),
        el('th', { text: 'Yours' }),
        el('th', { text: 'Tolerance' }),
        el('th', { text: '' }),
      ),
    ),
    el(
      'tbody',
      null,
      ...rows.map(r =>
        el(
          'tr',
          null,
          el('td', { text: r.label }),
          el('td', { text: r.display }),
          el('td', {
            text: r.toleranceDisplay ? (r.better === BETTER.higher ? 'at least ' : 'up to ') + r.toleranceDisplay : '',
          }),
          el('td', {
            class: r.within === true ? 'ok' : r.within === false ? 'off' : null,
            text: r.within === true ? 'within' : r.within === false ? 'outside' : '',
          }),
        ),
      ),
    ),
  );
}

function candidatePicker(L, entry) {
  const sel = entry.analysis.selection;
  if (!sel) {
    return null;
  }
  const shown = sel.candidates.slice(0, 3);
  return el(
    'div',
    { class: 'fb-block fix' },
    el('h3', { text: 'Which stroke was your main line?' }),
    el('p', {
      text: 'Two strokes could be the line of action. The numbers on your drawing mark each one. Pick the one you meant and the measurement uses it.',
    }),
    el(
      'div',
      { class: 'candidates' },
      ...shown.map(c =>
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Line ' + (c.index + 1),
          onclick: () => {
            L.selectCandidate(entry, c.index);
            refresh(L, entry);
            L.api.recompose();
          },
        }),
      ),
    ),
  );
}

function disagreeForm(L, entry, source) {
  let reason = DISAGREE_REASONS[0][0];
  const radios = el('div', { class: 'seg choices', role: 'radiogroup', 'aria-label': 'Why' });
  const draw = () =>
    L.api.seg(
      radios,
      DISAGREE_REASONS.map(([v]) => [v, DISAGREE_REASONS.find(d => d[0] === v)[1]]),
      reason,
      v => {
        reason = v;
        draw();
      },
    );
  draw();
  const text = el('textarea', {
    'aria-label': 'Anything to add (optional)',
    maxlength: '300',
    placeholder: 'Anything to add (optional)',
  });
  return el(
    'div',
    { class: 'disagree' },
    el('h3', {
      class: 'section-label',
      text:
        source === DISAGREE_SOURCE.ai
          ? "What is wrong with the coach's suggestion?"
          : 'What is wrong with this correction?',
    }),
    radios,
    text,
    el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'Save',
        onclick: () => {
          const ok = L.logDisagreement(entry, source, reason, text.value);
          entry.disagreeOpen = null;
          entry.disagreeSaved = ok ? source : null;
          refresh(L, entry);
        },
      }),
      el('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: 'Cancel',
        onclick: () => {
          entry.disagreeOpen = null;
          refresh(L, entry);
        },
      }),
    ),
    note('Saved in this browser only, to help check how accurate the feedback is.'),
  );
}

function measuredSection(L, entry) {
  const a = entry.analysis;
  const O = OBJECTIVES[entry.objectiveId];
  const out = [el('h3', { class: 'section-label', text: 'Measured' })];
  if (a.status === ANALYSIS_STATUS.empty) {
    out.push(
      el('p', {
        text: 'The canvas was empty when time ran out. Next time, put down one big line in the first few seconds, even if it is rough.',
      }),
    );
    return out;
  }
  if (a.status === ANALYSIS_STATUS.unavailable) {
    for (const l of a.limitations) {
      out.push(el('p', { text: l }));
    }
    out.push(
      el('p', { text: 'Check it yourself against the overlay:' }),
      el('ul', { class: 'questions' }, ...O.selfCheck.map(q => el('li', { text: q }))),
    );
    return out;
  }
  if (a.status === ANALYSIS_STATUS.ambiguous) {
    out.push(candidatePicker(L, entry));
  }
  const p = entry.issues.primary;
  if (p) {
    out.push(block('fix', 'Main issue', el('p', { text: p.measured }), el('p', { class: 'coach-note', text: p.why })));
    out.push(block(null, 'How to correct it', el('p', { text: p.fix })));
    if (p.uncertainty) {
      out.push(note(p.uncertainty));
    }
  } else if (a.status === ANALYSIS_STATUS.measured) {
    out.push(
      el('p', {
        text: 'The measured differences are within tolerance for this exercise. That covers only what is measured below, so still compare the overlay yourself.',
      }),
    );
  }
  out.push(evidenceTable(a));
  if (entry.issues.others.length) {
    out.push(
      el(
        'details',
        { class: 'more' },
        el('summary', { text: 'More observations (' + entry.issues.others.length + ')' }),
        ...entry.issues.others.map(i =>
          block(null, null, el('p', { text: i.measured }), el('p', { class: 'coach-note', text: i.fix })),
        ),
      ),
    );
  }
  out.push(
    el(
      'details',
      { class: 'more' },
      el('summary', { text: 'What this measurement can and cannot tell you' }),
      ...a.limitations.map(l => note(l)),
    ),
  );
  if (p) {
    if (entry.disagreeOpen === DISAGREE_SOURCE.measured) {
      out.push(disagreeForm(L, entry, DISAGREE_SOURCE.measured));
    } else if (entry.disagreeSaved === DISAGREE_SOURCE.measured) {
      out.push(note('Thanks. Your note was saved.'));
    } else {
      out.push(
        el(
          'div',
          null,
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: 'This correction seems wrong',
            onclick: () => {
              entry.disagreeOpen = DISAGREE_SOURCE.measured;
              refresh(L, entry);
            },
          }),
        ),
      );
    }
  }
  return out;
}

function comparisonSection(L, entry) {
  const c = entry.comparison;
  if (!c) {
    return [];
  }
  const out = [el('h3', { class: 'section-label', text: 'Compared with your first try on this reference' })];
  if (!c.comparable) {
    out.push(el('p', { text: c.reason }));
    return out;
  }
  out.push(
    el(
      'table',
      { class: 'ev-table' },
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          el('th', { text: 'Measured' }),
          el('th', { text: 'Before' }),
          el('th', { text: 'After' }),
          el('th', { text: '' }),
        ),
      ),
      el(
        'tbody',
        null,
        ...c.rows.map(r =>
          el(
            'tr',
            null,
            el('td', { text: r.label }),
            el('td', { text: r.beforeDisplay || '' }),
            el('td', { text: r.afterDisplay || '' }),
            el('td', { class: 'verdict-' + r.verdict, text: VERDICT_TEXT[r.verdict] }),
          ),
        ),
      ),
    ),
  );
  out.push(note('Small changes count as about the same: they are within normal drawing variation.'));
  return out;
}

/* ---------- AI section ---------- */

function aiSection(L, entry) {
  const out = [el('h3', { class: 'section-label', text: 'AI coach: suggestions, not measurements' })];
  const ai = entry.ai;
  if (!L.coach.available) {
    out.push(note('The AI coach is not connected. Everything above works without it.'));
    return out;
  }
  if (entry.round.empty) {
    return [];
  }
  if (!L.data.prefs.aiOptIn) {
    const cb = el('input', {
      type: 'checkbox',
      id: 'aiOptIn',
      onchange: e => {
        L.data.prefs.aiOptIn = e.target.checked;
        L.savePrefs();
        refresh(L, entry);
      },
    });
    out.push(
      el(
        'label',
        { class: 'toggle', for: 'aiOptIn' },
        cb,
        el('span', { text: 'Allow sending the reference and my drawing to the AI coach' }),
      ),
    );
    out.push(note('Nothing is sent until you turn this on and ask. You can turn it off again on the start screen.'));
    return out;
  }
  if (ai.status === AI_STATUS.pending) {
    out.push(el('div', { class: 'thinking' }, el('i'), 'The coach is looking at your drawing…'));
    out.push(
      el(
        'div',
        null,
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Stop',
          onclick: () => {
            if (ai.ctl) {
              ai.ctl.abort();
            }
          },
        }),
      ),
    );
    return out;
  }
  if (ai.error) {
    out.push(el('p', { class: 'status is-error', text: ai.error }));
  }
  if (ai.feedback) {
    const f = ai.feedback;
    out.push(block(null, 'What worked', el('p', { text: f.whatWorked })));
    out.push(block(null, 'Main issue', el('p', { text: f.mainIssue })));
    out.push(block(null, 'Why it matters', el('p', { text: f.whyItMatters })));
    out.push(block(null, 'How to correct it', el('p', { text: f.howToCorrect })));
    out.push(block(null, 'Next exercise', el('p', { text: f.nextExercise })));
    if (f.evidence.length) {
      out.push(
        block(
          null,
          'What the coach points to',
          el(
            'ul',
            { class: 'questions' },
            ...f.evidence.map(e =>
              el('li', { text: (e.source === 'visual' ? 'Seen: ' : 'From the measurements: ') + e.observation }),
            ),
          ),
        ),
      );
    }
    if (f.uncertainty) {
      out.push(block(null, 'How sure', el('p', { text: f.uncertainty })));
    }
    if (ai.flags.includes('unverified-number')) {
      out.push(
        note('The coach mentioned numbers that were not measured. They were removed and replaced with "(unmeasured)".'),
      );
    }
    if (entry.disagreeOpen === DISAGREE_SOURCE.ai) {
      out.push(disagreeForm(L, entry, DISAGREE_SOURCE.ai));
    } else {
      out.push(
        el(
          'div',
          { class: 'row-actions' },
          el('button', {
            class: 'btn',
            type: 'button',
            text: 'Explain it more simply',
            onclick: () => L.askCoach(entry, STYLE.simpler),
          }),
          entry.disagreeSaved === DISAGREE_SOURCE.ai
            ? note('Thanks. Your note was saved.')
            : el('button', {
                class: 'btn btn-ghost',
                type: 'button',
                text: 'I disagree',
                onclick: () => {
                  entry.disagreeOpen = DISAGREE_SOURCE.ai;
                  refresh(L, entry);
                },
              }),
        ),
      );
    }
    return out;
  }
  out.push(
    el(
      'div',
      null,
      el('button', {
        class: 'btn',
        type: 'button',
        text: ai.error ? 'Try again' : 'Ask the coach',
        onclick: () => L.askCoach(entry),
      }),
    ),
  );
  out.push(note('Sends the reference, your drawing, the overlay and the measurements above.'));
  return out;
}

/* ---------- panel ---------- */

function build(L, entry, from) {
  const O = OBJECTIVES[entry.objectiveId];
  const kids = [el('h2', { text: TITLE[entry.type] })];
  if (entry.type === ATTEMPT_TYPE.transfer) {
    kids.push(note('Drawn on a new reference without hints. This is the result that counts toward your progress.'));
  }
  // At the Independent level, the learner judges the drawing before seeing any measurement.
  const selfFirst =
    entry.guidance === GUIDANCE.independent && !entry.revealed && entry.analysis.status !== ANALYSIS_STATUS.empty;
  if (selfFirst) {
    kids.push(
      el('p', { text: 'Check it yourself first:' }),
      el('ul', { class: 'questions' }, ...O.selfCheck.map(q => el('li', { text: q }))),
    );
    kids.push(
      el(
        'div',
        null,
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Show the measurements',
          onclick: () => {
            entry.revealed = true;
            refresh(L, entry);
          },
        }),
      ),
    );
  } else {
    kids.push(...measuredSection(L, entry), ...comparisonSection(L, entry));
    kids.push(el('div', { class: 'ai-block' }, ...aiSection(L, entry)));
  }
  const actions = el('div', { class: 'coach-actions' });
  if (from === REVIEW_FROM.session && isCurrentReview(L, entry) && L.canRetry()) {
    const label = entry.issues.primary ? 'Practice this correction' : 'Draw it again';
    actions.append(
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: label,
        onclick: () => L.dispatch({ type: EVENT.retry }),
      }),
    );
  }
  if (actions.childNodes.length) {
    kids.push(actions);
  }
  return kids;
}

export function refresh(L, entry) {
  const v = L.api.S.view;
  if (!v || v.round !== entry.round || !$('#review').classList.contains('is-active')) {
    return;
  }
  $('#coach').replaceChildren(...build(L, entry, v.from).filter(Boolean));
}

function renderAnnotControls(L, entry) {
  const box = $('#annotCtl');
  const toggles = L.live.annot;
  const labels = ANNOTATION_LABELS[entry.analysis.evaluator] || ANNOTATION_LABELS[EVALUATOR.none];
  const check = (key, text, color, dashed) => {
    const id = 'annot-' + key;
    const cb = el('input', {
      type: 'checkbox',
      id,
      onchange: e => {
        toggles[key] = e.target.checked;
        renderAnnotControls(L, entry);
        L.api.recompose();
      },
    });
    cb.checked = !!toggles[key];
    if (key !== 'show' && !toggles.show) {
      cb.disabled = true;
    }
    return el(
      'label',
      { class: 'ctl', for: id },
      cb,
      color ? el('span', { class: 'key', style: `background:${color};${dashed ? 'opacity:.7' : ''}` }) : null,
      text,
    );
  };
  const kids = [check('show', 'Annotations')];
  const measured =
    entry.analysis.status === ANALYSIS_STATUS.measured || entry.analysis.status === ANALYSIS_STATUS.ambiguous;
  if (measured && labels.reference) {
    kids.push(check('reference', labels.reference, COLORS.reference));
  }
  if (measured && labels.mine) {
    kids.push(check('mine', labels.mine, COLORS.mine, true));
  }
  const steps = constructionSteps(
    entry.objectiveId,
    entry.ref.meta,
    entry.analysis.refTones
      ? { tones: entry.analysis.refTones, w: entry.analysis.grid.w, h: entry.analysis.grid.h }
      : null,
  );
  if (steps.length && !(entry.type === ATTEMPT_TYPE.transfer && L.live.state.stage === STAGE.transfer)) {
    kids.push(
      el('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: entry.guide ? 'Hide ' + GUIDE_LABEL.toLowerCase() : 'Play ' + GUIDE_LABEL.toLowerCase(),
        title: GUIDE_NOTE,
        onclick: () => {
          if (entry.guide) {
            if (entry.guide.player) {
              entry.guide.player.stop();
            }
            entry.guide = null;
            renderAnnotControls(L, entry);
            L.api.recompose();
            return;
          }
          toggles.show = true;
          entry.guide = { steps, width: entry.ref.meta.width, upto: 0, t: 0 };
          entry.guide.player = playSteps(steps, (i, t) => {
            if (!entry.guide) {
              return;
            }
            entry.guide.upto = i;
            entry.guide.t = t;
            entry.guide.label = steps[Math.min(i, steps.length - 1)].label;
            L.api.recompose();
            const n = $('#guideStep');
            if (n) {
              n.textContent = Math.min(i, steps.length - 1) + 1 + '/' + steps.length + ' ' + entry.guide.label;
            }
          });
          renderAnnotControls(L, entry);
        },
      }),
    );
    if (entry.guide) {
      kids.push(el('span', { class: 'coach-note', id: 'guideStep', title: GUIDE_NOTE, text: entry.guide.label || '' }));
    }
  }
  box.replaceChildren(...kids);
  box.hidden = false;
}

export function render(L, entry, from) {
  const O = OBJECTIVES[entry.objectiveId];
  $('#reviewTitle').textContent = TITLE[entry.type];
  $('#reviewSub').textContent = O.description;
  const next = $('#nextBtn');
  if (from === REVIEW_FROM.summary) {
    next.textContent = 'Back to summary';
  } else {
    next.textContent = continueLabel(L, entry);
  }
  // When a retry is offered it is the main action, so "continue" steps back visually.
  next.className =
    from === REVIEW_FROM.session && isCurrentReview(L, entry) && L.canRetry() ? 'btn' : 'btn btn-primary';
  renderAnnotControls(L, entry);
  refresh(L, entry);
}

export function annotate(L, entry, ctx, o) {
  drawReviewAnnotations(ctx, {
    round: entry.round,
    analysis: entry.analysis,
    toggles: L.live ? L.live.annot : { show: true, reference: true, mine: true },
    layout: o.layout,
    gap: o.gap,
    guide: entry.guide,
  });
}
