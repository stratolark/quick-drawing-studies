/* Deterministic stand-in for the coach, for local development and automated tests. It writes feedback from
   the measurements it is given, so its wording is checkable. QS_MOCK_MODE simulates failures:
   ok | slow | timeout | malformed | hallucinate | refuse | error. */
import { ERROR_CODE, VISUAL_EVIDENCE } from '../../src/coach/schema.js';
import { OBJECTIVES } from '../../src/learning/curriculum.js';

const SLOW_MS = 2500;

function wait(ms, signal) {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          rej({ code: signal.reason === 'timeout' ? ERROR_CODE.timeout : ERROR_CODE.cancelled });
        },
        { once: true },
      );
  });
}

export function mockFeedback(req) {
  const O = OBJECTIVES[req.objectiveId];
  const outside = req.evidence.filter(e => e.within === false);
  const inside = req.evidence.filter(e => e.within === true);
  const main = req.measuredIssue
    ? req.measuredIssue.measured
    : outside.length
      ? `${outside[0].label} is ${outside[0].display}, outside the tolerance.`
      : 'No measured problem stands out for this exercise.';
  return {
    whatWorked: inside.length
      ? `${inside[0].label} is within tolerance (${inside[0].display}).`
      : 'You committed to the drawing within the time limit.',
    mainIssue: main,
    whyItMatters: `This exercise trains: ${O.description.toLowerCase()}`,
    howToCorrect:
      req.style === 'simpler'
        ? 'Look at the reference for a few seconds, then draw only that one part again.'
        : 'Retry the same reference and fix only this one thing.',
    nextExercise: `Do three short studies focused on: ${O.description.toLowerCase()}`,
    evidence: req.evidence
      .slice(0, 2)
      .map(e => ({ source: e.key, observation: `${e.label}: ${e.display}.` }))
      .concat({ source: VISUAL_EVIDENCE, observation: 'Mock provider: no real visual inspection was made.' }),
    uncertainty: 'This is the mock coach. It repeats the measurements and does not look at the images.',
  };
}

export function createMockProvider(cfg) {
  const mode = cfg.mockMode || 'ok';
  return {
    name: 'mock',
    model: 'mock-coach',
    async review(req, { signal }) {
      if (mode === 'slow') await wait(SLOW_MS, signal);
      if (mode === 'timeout') await wait(cfg.timeoutMs * 2, signal);
      if (mode === 'error') throw { code: ERROR_CODE.providerError, log: 'mock error' };
      if (mode === 'refuse') throw { code: ERROR_CODE.refused };
      if (mode === 'malformed')
        return { raw: { mainIssue: 42 }, model: 'mock-coach', usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 };
      const raw = mockFeedback(req);
      if (mode === 'hallucinate') raw.mainIssue += ' Your torso is 37° off and the legs are 58% too long.';
      return { raw, model: 'mock-coach', usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 };
    },
  };
}
