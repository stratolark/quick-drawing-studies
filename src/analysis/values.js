/* Values analysis: compare the learner's three-value study with the reference grouped into three tones.
   The reference is split by a two-threshold Otsu search on its own luminance, so the groups come from
   the image rather than fixed cut-offs. Comparison is cell by cell in canvas position. */
import { EVALUATOR } from '../learning/curriculum.js';
import { ANALYSIS_STATUS } from './gesture.js';
import { roundTo as round } from './geometry.js';

export const VALUES_ANALYSIS_VERSION = 'values-1';

export const TONE = Object.freeze({ light: 0, mid: 1, dark: 2 });

export const VALUE_TOLERANCES = Object.freeze({
  darkCoverageRatio: [0.6, 1.6], // drawn dark area / reference dark area inside this range counts as a match
  darkCentroidOffset: 0.12,      // offset of the dark mass, as a fraction of the grid diagonal
  minInk: 0.01,                  // fraction of non-light cells below this counts as empty
});

const HIST_BINS = 64;
const LIMITATIONS = [
  'Compares where light, mid and dark areas fall, cell by cell, in canvas position.',
  'If you drew smaller or shifted, placement scores drop; check the overlay before trusting them.',
  'The reference is split into three tones automatically; a different but valid grouping can disagree.',
];

/* Two thresholds that best split luminance values in [0, 1] into three groups (maximum between-class variance). */
export function otsu3(lum) {
  const hist = new Float64Array(HIST_BINS);
  for (const v of lum) hist[Math.min(HIST_BINS - 1, Math.max(0, Math.floor(v * HIST_BINS)))]++;
  const n = lum.length;
  const P = new Float64Array(HIST_BINS + 1), S = new Float64Array(HIST_BINS + 1);
  for (let i = 0; i < HIST_BINS; i++) { P[i + 1] = P[i] + hist[i]; S[i + 1] = S[i] + hist[i] * (i + 0.5); }
  const cls = (a, b) => { const w = P[b] - P[a]; return w > 0 ? (S[b] - S[a]) ** 2 / w : 0; };
  let best = -1, t1 = 21, t2 = 42;
  for (let a = 1; a < HIST_BINS - 1; a++) {
    for (let b = a + 1; b < HIST_BINS; b++) {
      const v = cls(0, a) + cls(a, b) + cls(b, HIST_BINS);
      if (v > best) { best = v; t1 = a; t2 = b; }
    }
  }
  return n ? [t1 / HIST_BINS, t2 / HIST_BINS] : [1 / 3, 2 / 3];
}

export function classifyLuminance(lum, [t1, t2]) {
  const out = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = lum[i] < t1 ? TONE.dark : lum[i] < t2 ? TONE.mid : TONE.light;
  return out;
}

function darkStats(tones, w, h) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tones[y * w + x] === TONE.dark) { n++; sx += x + 0.5; sy += y + 0.5; }
  return { frac: n / (w * h), cx: n ? sx / n : null, cy: n ? sy / n : null, n };
}


function base(status, extra) {
  return Object.assign({ version: VALUES_ANALYSIS_VERSION, evaluator: EVALUATOR.valueMasses, status, metrics: {}, tolerances: VALUE_TOLERANCES, limitations: LIMITATIONS.slice(), annotations: [], compact: null }, extra);
}

/* refLum: luminance grid of the reference (0..1). drawnTones: TONE grid of the study. Same w x h. */
export function analyzeValues({ refLum, drawnTones, w, h, lightSide }) {
  if (!refLum || refLum.length !== w * h) return base(ANALYSIS_STATUS.unavailable, { limitations: ['The reference pixels could not be read.'] });
  if (!drawnTones || drawnTones.length !== w * h) return base(ANALYSIS_STATUS.empty);
  let ink = 0;
  for (const t of drawnTones) if (t !== TONE.light) ink++;
  if (ink < VALUE_TOLERANCES.minInk * w * h) return base(ANALYSIS_STATUS.empty, { limitations: ['Almost nothing was blocked in.'] });

  const thresholds = otsu3(refLum);
  const refTones = classifyLuminance(refLum, thresholds);
  let agree = 0, inter = 0, union = 0;
  for (let i = 0; i < refTones.length; i++) {
    if (refTones[i] === drawnTones[i]) agree++;
    const rd = refTones[i] === TONE.dark, dd = drawnTones[i] === TONE.dark;
    if (rd && dd) inter++;
    if (rd || dd) union++;
  }
  const r = darkStats(refTones, w, h), d = darkStats(drawnTones, w, h);
  const diag = Math.hypot(w, h);
  const offset = r.n && d.n ? Math.hypot(d.cx - r.cx, d.cy - r.cy) / diag : null;
  const limitations = LIMITATIONS.slice();
  if (!r.n) limitations.push('The reference has almost no dark group, so dark placement is not measured.');
  return base(ANALYSIS_STATUS.measured, {
    metrics: {
      refDarkFrac: round(r.frac, 3),
      drawnDarkFrac: round(d.frac, 3),
      darkCoverageRatio: r.frac > 0 ? round(d.frac / r.frac, 2) : null,
      darkCentroidOffset: offset == null ? null : round(offset, 3),
      darkOffsetX: r.n && d.n ? round((d.cx - r.cx) / w, 3) : null,
      darkOffsetY: r.n && d.n ? round((d.cy - r.cy) / h, 3) : null,
      darkOverlap: union ? round(inter / union, 3) : null,
      toneAgreement: round(agree / refTones.length, 3),
      lightSide: lightSide || null,
    },
    thresholds: thresholds.map(t => round(t, 3)),
    grid: { w, h },
    refTones,
    compact: { darkFrac: round(d.frac, 3) },
  });
}
