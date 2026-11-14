/* Before-and-after comparison of two attempts on the same reference. A change only counts when it is larger
   than the metric's change threshold; everything smaller is reported as similar. */
import { ANALYSIS_STATUS } from './gesture.js';
import { METRICS, BETTER } from './metrics.js';

export const VERDICT = Object.freeze({
  improved: 'improved',
  worse: 'worse',
  similar: 'similar',
  unavailable: 'unavailable',
});

export function isComparable(a) {
  return !!a && a.status === ANALYSIS_STATUS.measured;
}

export function compareAnalyses(before, after) {
  if (!isComparable(before) || !isComparable(after)) {
    return {
      comparable: false,
      reason: 'One of the attempts could not be measured, so only a visual comparison is possible.',
      rows: [],
      counts: null,
    };
  }
  if (before.evaluator !== after.evaluator || before.version !== after.version) {
    return {
      comparable: false,
      reason: 'The attempts were measured differently, so their numbers are not compared.',
      rows: [],
      counts: null,
    };
  }
  const def = METRICS[before.evaluator];
  const rows = def.rows.map(r => {
    const b = r.value(before.metrics),
      a = r.value(after.metrics);
    if (b == null || a == null)
      return { key: r.key, label: r.label, before: null, after: null, verdict: VERDICT.unavailable };
    const gain = r.better === BETTER.lower ? b - a : a - b;
    const verdict = Math.abs(gain) < r.change ? VERDICT.similar : gain > 0 ? VERDICT.improved : VERDICT.worse;
    return {
      key: r.key,
      label: r.label,
      before: b,
      after: a,
      beforeDisplay: r.format(b),
      afterDisplay: r.format(a),
      verdict,
    };
  });
  const counts = { improved: 0, worse: 0, similar: 0, unavailable: 0 };
  for (const r of rows) counts[r.verdict]++;
  return { comparable: true, reason: null, rows, counts };
}
