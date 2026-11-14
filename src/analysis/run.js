/* Run the evaluator an objective names on a finished attempt. Runs once, after drawing ends, never per pen event. */
import { EVALUATOR, OBJECTIVES } from '../learning/curriculum.js';
import { analyzeGesture, ANALYSIS_STATUS } from './gesture.js';
import { analyzeShapes } from './shapes.js';
import { analyzeValues } from './values.js';
import { luminanceGrid, toneGrid, paintMask, gridSize } from './raster.js';

const VALUE_GRID_COLS = 48;

const NONE = {
  version: 'none-1',
  evaluator: EVALUATOR.none,
  status: ANALYSIS_STATUS.unavailable,
  metrics: {},
  tolerances: {},
  limitations: ['This exercise has no automatic measurement yet. Use the overlay and the self-check questions.'],
  annotations: [],
  compact: null,
};

/* input: { strokes, drawing (canvas), refImg, cw, ch, reference (meta|null), silhouetteMask|null, selection } */
const RUNNERS = {
  [EVALUATOR.gestureLine]: i =>
    analyzeGesture({
      strokes: i.strokes,
      reference:
        i.reference && i.reference.geometry && i.reference.geometry.actionLine
          ? { actionLine: i.reference.geometry.actionLine, width: i.reference.width, height: i.reference.height }
          : null,
      canvas: { w: i.cw, h: i.ch },
      selection: i.selection,
    }),
  [EVALUATOR.shapeSilhouette]: i => {
    const sm = i.silhouetteMask;
    return analyzeShapes({
      ref: sm ? { mask: sm.mask, w: sm.w, h: sm.h } : null,
      drawn: sm ? { mask: paintMask(i.drawing, sm.w, sm.h), w: sm.w, h: sm.h } : null,
    });
  },
  [EVALUATOR.valueMasses]: i => {
    const g = gridSize(i.cw, i.ch, VALUE_GRID_COLS);
    const light = i.reference && i.reference.geometry && i.reference.geometry.light;
    return analyzeValues({
      refLum: luminanceGrid(i.refImg, g.w, g.h),
      drawnTones: toneGrid(i.drawing, g.w, g.h),
      w: g.w,
      h: g.h,
      lightSide: light ? light.side : null,
    });
  },
  [EVALUATOR.none]: () => NONE,
};

export function analyzeAttempt(objectiveId, input) {
  const O = OBJECTIVES[objectiveId];
  const run = RUNNERS[O ? O.evaluator : EVALUATOR.none];
  if (input.empty)
    return Object.assign({}, NONE, {
      evaluator: O ? O.evaluator : EVALUATOR.none,
      status: ANALYSIS_STATUS.empty,
      limitations: ['The canvas was empty when time ran out.'],
    });
  try {
    return run(input);
  } catch (e) {
    // A failed analysis must not lose the drawing; report it as unavailable and keep going.
    return Object.assign({}, NONE, {
      evaluator: O.evaluator,
      limitations: [
        'The measurement failed on this drawing (' + ((e && e.message) || 'error') + '). Compare it with the overlay.',
      ],
    });
  }
}
