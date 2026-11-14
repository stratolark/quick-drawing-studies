/* Turn measurements into ranked, explainable issues. Each rule reads metrics only and returns one issue
   with its measured evidence, why it matters, one concrete fix and a short retry objective.
   The objective's focusMetric raises matching issues so feedback stays on what the exercise trains. */
import { EVALUATOR } from '../learning/curriculum.js';
import { ANALYSIS_STATUS, GESTURE_TOLERANCES } from './gesture.js';
import { SHAPE_TOLERANCES } from './shapes.js';
import { VALUE_TOLERANCES } from './values.js';
import { CURVE } from './geometry.js';

export const FOCUS_WEIGHT = 1.5;

/* Which focus metric each issue belongs to (matches OBJECTIVES[*].focusMetric). */
export const ISSUE_FOCUS = {
  'gesture.curve-direction': 'curvature',
  'gesture.curvature-amount': 'curvature',
  'gesture.curve-type': 'curvature',
  'gesture.orientation': 'orientation',
  'shapes.proportion': 'proportion',
  'shapes.masses': 'proportion',
  'values.dark-coverage': 'darkCoverage',
  'values.dark-placement': 'darkPlacement',
};

const pct = v => Math.round(Math.abs(v) * 100) + '%';
const sideWord = (bow, vertical) => (vertical ? (bow > 0 ? 'left' : 'right') : bow > 0 ? 'down' : 'up');

const RULES = {
  [EVALUATOR.gestureLine]: [
    m =>
      m.curvatureDirectionMatch === false && {
        id: 'gesture.curve-direction',
        severity: 1.2,
        measured: `Your main line bends to the ${sideWord(m.drawnBow, m.refMostlyVertical)}; the reference bends to the ${sideWord(m.refBow, m.refMostlyVertical)}.`,
        why: 'The bend carries the movement. Bending the other way changes what the pose is doing.',
        fix: `Put down the main line first and bow it to the ${sideWord(m.refBow, m.refMostlyVertical)}, like the reference, before anything else.`,
        objective: `Bend the main line to the ${sideWord(m.refBow, m.refMostlyVertical)}.`,
      },
    m =>
      m.orientationErrorDeg > GESTURE_TOLERANCES.orientationDeg &&
      (() => {
        const cw = m.orientationDeltaDeg > 0;
        const deg = Math.round(m.orientationErrorDeg);
        const lean = m.refMostlyVertical ? ` Lean the top of the line further ${cw ? 'left' : 'right'}.` : '';
        return {
          id: 'gesture.orientation',
          severity: m.orientationErrorDeg / 20,
          measured: `Your main line is tilted about ${deg}° ${cw ? 'clockwise' : 'counter-clockwise'} compared with the reference.`,
          why: 'The tilt of the main line sets the balance of the pose. A few degrees off can make a figure look stiff or about to fall.',
          fix:
            'Compare the line against an imaginary vertical through the reference before you draw, then match that angle.' +
            lean,
          objective: `Tilt the main line about ${deg}° ${cw ? 'counter-clockwise' : 'clockwise'}.` + lean,
        };
      })(),
    m =>
      m.curvatureDirectionMatch !== false &&
      m.bowError > GESTURE_TOLERANCES.bow &&
      (() => {
        const flatter = Math.abs(m.drawnBow) < Math.abs(m.refBow);
        return {
          id: 'gesture.curvature-amount',
          severity: m.bowError / 0.12,
          measured: `Your line bends ${flatter ? 'less' : 'more'} than the reference (bend ${pct(m.drawnBow)} of its length against ${pct(m.refBow)}).`,
          why: flatter
            ? 'A line straighter than the pose reads as stiff and loses the movement.'
            : 'Extra bend pushes the action further than the pose goes.',
          fix: flatter
            ? 'Find the point where the reference line bends most and push your line out to that depth.'
            : 'Keep the bend only as deep as the reference; let the line run straighter through the legs.',
          objective: flatter ? 'Give the main line more bend.' : 'Bend the main line less.',
          uncertainty: flatter ? null : 'If you exaggerated on purpose, this is a choice, not a mistake.',
        };
      })(),
    m =>
      m.curvatureDirectionMatch !== false &&
      m.refCurveType !== m.drawnCurveType &&
      m.refCurveType !== CURVE.straight &&
      m.drawnCurveType !== CURVE.straight && {
        id: 'gesture.curve-type',
        severity: 0.7,
        measured: `The reference line is ${m.refCurveType === CURVE.s ? 'an S-curve' : 'a single C-curve'}; yours is ${m.drawnCurveType === CURVE.s ? 'an S-curve' : 'a single C-curve'}.`,
        why: 'Whether the line reverses its bend decides how the torso and legs answer each other.',
        fix:
          m.refCurveType === CURVE.s
            ? 'Let the line reverse its bend where the torso meets the legs.'
            : 'Keep the line bending one way from head to foot.',
        objective:
          m.refCurveType === CURVE.s ? 'Draw the main line as an S-curve.' : 'Draw the main line as one C-curve.',
      },
  ],
  [EVALUATOR.shapeSilhouette]: [
    m =>
      Math.abs(m.aspectError) > SHAPE_TOLERANCES.aspectError &&
      (() => {
        const taller = m.aspectError > 0;
        return {
          id: 'shapes.proportion',
          severity: Math.abs(m.aspectError) / 0.25,
          measured: `Your silhouette is about ${pct(m.aspectError)} ${taller ? 'taller and narrower' : 'shorter and wider'} than the reference, for its size.`,
          why: 'Height against width is the first proportion the eye reads; when it drifts, every part inside it drifts too.',
          fix: 'Before filling, mark the top, bottom and widest points, and check the height against the width.',
          objective: taller ? 'Make the silhouette wider for its height.' : 'Make the silhouette taller for its width.',
        };
      })(),
    m =>
      m.overlap < SHAPE_TOLERANCES.overlap && {
        id: 'shapes.masses',
        severity: 0.3 + (SHAPE_TOLERANCES.overlap - m.overlap) / 0.3,
        measured: `After matching size and position, your shapes overlap ${pct(m.overlap)} with the reference silhouette.`,
        why: 'Low overlap means the big masses or the gaps between them sit in different places.',
        fix: 'Block in the two or three biggest masses first, then cut out the largest gap.',
        objective: 'Match the big masses and the largest gap.',
        uncertainty: 'A different but valid simplification can also lower the overlap.',
      },
  ],
  [EVALUATOR.valueMasses]: [
    m =>
      m.darkCoverageRatio != null &&
      (m.darkCoverageRatio < VALUE_TOLERANCES.darkCoverageRatio[0] ||
        m.darkCoverageRatio > VALUE_TOLERANCES.darkCoverageRatio[1]) &&
      (() => {
        const few = m.darkCoverageRatio < VALUE_TOLERANCES.darkCoverageRatio[0];
        return {
          id: 'values.dark-coverage',
          severity:
            0.3 +
            (few
              ? VALUE_TOLERANCES.darkCoverageRatio[0] / Math.max(m.darkCoverageRatio, 0.05) - 1
              : m.darkCoverageRatio / VALUE_TOLERANCES.darkCoverageRatio[1] - 1),
          measured: `Your darks cover ${pct(m.drawnDarkFrac)} of the canvas; the reference's dark group covers about ${pct(m.refDarkFrac)}.`,
          why: few
            ? 'Without enough dark, the light has nothing to read against and the forms flatten.'
            : 'Too much dark swallows the half-tones and the light side.',
          fix: few
            ? 'Squint at the reference and fill every connected shadow shape with dark.'
            : 'Keep dark for the shadow shapes only and move the half-tones into mid grey.',
          objective: few ? 'Block in more of the dark shapes.' : 'Use dark only for the shadow shapes.',
        };
      })(),
    m =>
      m.darkCentroidOffset != null &&
      m.darkCentroidOffset > VALUE_TOLERANCES.darkCentroidOffset &&
      (() => {
        const h = Math.abs(m.darkOffsetX) >= Math.abs(m.darkOffsetY);
        const dir = h ? (m.darkOffsetX > 0 ? 'right' : 'left') : m.darkOffsetY > 0 ? 'lower' : 'higher';
        return {
          id: 'values.dark-placement',
          severity: m.darkCentroidOffset / 0.25,
          measured: `The centre of your dark mass sits ${h ? 'to the ' + dir : dir} than in the reference.`,
          why: 'Where the darks sit tells the viewer where the light comes from.',
          fix:
            (m.lightSide ? `The light comes from the ${m.lightSide}; ` : '') +
            'place the darks on the side turned away from the light first.',
          objective: 'Move the dark shapes to the shadow side.',
          uncertainty: 'If your study is smaller or shifted on the canvas, this offset includes that.',
        };
      })(),
  ],
  [EVALUATOR.none]: [],
};

/* Ranked issues for a measured analysis. Returns { primary, others, measurable }. */
export function rankIssues(analysis, objective) {
  const measurable = !!analysis && analysis.status === ANALYSIS_STATUS.measured;
  if (!measurable) {
    return { primary: null, others: [], measurable: false };
  }
  const focus = objective && objective.focusMetric;
  const found = (RULES[analysis.evaluator] || [])
    .map(rule => rule(analysis.metrics))
    .filter(Boolean)
    .map(i =>
      Object.assign({ uncertainty: null }, i, {
        focus: ISSUE_FOCUS[i.id] === focus,
        rank: i.severity * (ISSUE_FOCUS[i.id] === focus ? FOCUS_WEIGHT : 1),
      }),
    )
    .sort((a, b) => b.rank - a.rank);
  return { primary: found[0] || null, others: found.slice(1), measurable: true };
}

/* Short names for recurring-difficulty lists and recommendations. */
export const ISSUE_LABEL = {
  'gesture.curve-direction': 'bending the main line the wrong way',
  'gesture.curvature-amount': 'the amount of bend in the main line',
  'gesture.curve-type': 'C-curve versus S-curve',
  'gesture.orientation': 'the tilt of the main line',
  'shapes.proportion': 'height-to-width proportion',
  'shapes.masses': 'placing the big masses',
  'values.dark-coverage': 'how much area is dark',
  'values.dark-placement': 'where the dark shapes sit',
};
