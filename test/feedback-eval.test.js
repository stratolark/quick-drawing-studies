import { describe, it, expect } from 'vitest';
import { CASES, CANVAS, CATEGORY } from './fixtures/feedback-cases.js';
import { analyzeGesture } from '../src/analysis/gesture.js';
import { rankIssues } from '../src/analysis/issues.js';
import { OBJECTIVES } from '../src/learning/curriculum.js';

/* Runs every labelled case through measurement and issue ranking and checks the expected observation. */
describe('feedback-quality dataset', () => {
  it('covers every category the brief asks for', () => {
    expect(new Set(CASES.map(c => c.category))).toEqual(new Set(Object.values(CATEGORY)));
  });

  it.each(CASES.map(c => [c.id, c]))('%s', (_, c) => {
    const a = analyzeGesture({ strokes: c.strokes, reference: c.reference, canvas: CANVAS });
    expect(a.status).toBe(c.expect.status);
    if (!('primary' in c.expect)) {
      return;
    }
    const r = rankIssues(a, OBJECTIVES[c.objective]);
    expect(r.primary ? r.primary.id : null).toBe(c.expect.primary);
    if (c.expect.uncertainty) {
      expect(r.primary.uncertainty).toBeTruthy();
    }
  });
});
