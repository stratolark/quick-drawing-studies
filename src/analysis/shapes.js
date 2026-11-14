/* Shape analysis: compare the learner's filled silhouette with the reference silhouette mask.
   Both masks are binary grids. The drawing is fitted to the reference by translation and one uniform
   scale (from bounding-box area), never rotated or stretched, so proportion errors stay visible. */
import { EVALUATOR } from '../learning/curriculum.js';
import { ANALYSIS_STATUS } from './gesture.js';
import { roundTo as round } from './geometry.js';

export const SHAPES_ANALYSIS_VERSION = 'shapes-1';

export const SHAPE_TOLERANCES = Object.freeze({
  aspectError: 0.12, // relative height-to-width ratio difference treated as a match
  overlap: 0.55, // intersection over union above this counts as the same big masses
  minCoverage: 0.002, // drawn area below this fraction of the grid counts as empty
});

const LIMITATIONS = [
  'Compares the overall silhouette only: height-to-width ratio and how well the big masses overlap.',
  'Your drawing is moved and resized to fit the reference, but not rotated or stretched.',
  'Different valid simplifications of the same pose can score differently; treat overlap as a rough guide.',
];

/* Bounding box of a binary grid, in grid cells. */
export function gridBBox(mask, w, h) {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1,
    count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

function base(status, extra) {
  return Object.assign(
    {
      version: SHAPES_ANALYSIS_VERSION,
      evaluator: EVALUATOR.shapeSilhouette,
      status,
      metrics: {},
      tolerances: SHAPE_TOLERANCES,
      limitations: LIMITATIONS.slice(),
      annotations: [],
      compact: null,
    },
    extra,
  );
}

/* ref and drawn: { mask: Uint8Array|number[], w, h } on grids with the same aspect ratio as the canvas.
   ref may be null when the reference has no silhouette metadata. */
export function analyzeShapes({ ref, drawn }) {
  if (!ref || !ref.mask)
    return base(ANALYSIS_STATUS.unavailable, {
      limitations: [
        'This reference has no verified silhouette, so shapes cannot be measured. Compare it yourself with the overlay.',
      ],
    });
  const rb = gridBBox(ref.mask, ref.w, ref.h);
  const db = drawn && gridBBox(drawn.mask, drawn.w, drawn.h);
  if (!rb) return base(ANALYSIS_STATUS.unavailable, { limitations: ['The reference silhouette is empty.'] });
  if (!db || db.count < SHAPE_TOLERANCES.minCoverage * drawn.w * drawn.h)
    return base(ANALYSIS_STATUS.empty, { limitations: ['No filled shapes were drawn.'] });

  // Work in reference grid cells; the drawn grid may have another resolution with the same aspect.
  const kx = ref.w / drawn.w,
    ky = ref.h / drawn.h;
  const dbx = { x: db.x * kx, y: db.y * ky, w: db.w * kx, h: db.h * ky };
  const refAspect = rb.h / rb.w;
  const drawnAspect = dbx.h / dbx.w;
  const aspectError = drawnAspect / refAspect - 1;

  const s = Math.sqrt((rb.w * rb.h) / (dbx.w * dbx.h));
  const rcx = rb.x + rb.w / 2,
    rcy = rb.y + rb.h / 2;
  const dcx = dbx.x + dbx.w / 2,
    dcy = dbx.y + dbx.h / 2;
  let inter = 0,
    union = 0;
  for (let y = 0; y < ref.h; y++) {
    for (let x = 0; x < ref.w; x++) {
      const r = !!ref.mask[y * ref.w + x];
      const gx = Math.floor(((x + 0.5 - rcx) / s + dcx) / kx);
      const gy = Math.floor(((y + 0.5 - rcy) / s + dcy) / ky);
      const d = gx >= 0 && gy >= 0 && gx < drawn.w && gy < drawn.h && !!drawn.mask[gy * drawn.w + gx];
      if (r && d) inter++;
      if (r || d) union++;
    }
  }
  const overlap = union ? inter / union : 0;
  return base(ANALYSIS_STATUS.measured, {
    metrics: {
      refAspect: round(refAspect, 3),
      drawnAspect: round(drawnAspect, 3),
      aspectError: round(aspectError, 3),
      overlap: round(overlap, 3),
      fitScale: round(s, 3),
    },
    annotations: [
      { kind: 'rect', role: 'reference-bbox', rect: [rb.x / ref.w, rb.y / ref.h, rb.w / ref.w, rb.h / ref.h] },
      { kind: 'rect', role: 'drawn-bbox', rect: [dbx.x / ref.w, dbx.y / ref.h, dbx.w / ref.w, dbx.h / ref.h] },
    ],
    compact: { aspect: round(drawnAspect, 3) },
  });
}
