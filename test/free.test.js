import { describe, it, expect } from 'vitest';
import { normalizeFreePrefs, ANY, VIEW, TRACE_OPACITY } from '../src/free/practice.js';
import { REF_SUBJECT } from '../src/learning/curriculum.js';

const TOOLS = ['gesture', 'shapes', 'values'];

describe('free practice preferences', () => {
  it('starts with mannequin poses side by side when nothing is stored', () => {
    expect(normalizeFreePrefs(null, TOOLS)).toEqual({
      subject: REF_SUBJECT.movement,
      variant: { [REF_SUBJECT.movement]: ANY, [REF_SUBJECT.perspective]: ANY },
      view: VIEW.side,
      tools: 'gesture',
      opacity: TRACE_OPACITY.initial,
    });
  });

  it('keeps valid stored choices', () => {
    const p = normalizeFreePrefs(
      {
        subject: REF_SUBJECT.perspective,
        variant: { [REF_SUBJECT.movement]: 2, [REF_SUBJECT.perspective]: 'street' },
        view: VIEW.trace,
        tools: 'values',
        opacity: 0.5,
      },
      TOOLS,
    );
    expect(p).toMatchObject({ subject: REF_SUBJECT.perspective, view: VIEW.trace, tools: 'values', opacity: 0.5 });
    expect(p.variant).toEqual({ [REF_SUBJECT.movement]: 2, [REF_SUBJECT.perspective]: 'street' });
  });

  it('replaces unknown or out-of-range values with defaults', () => {
    const p = normalizeFreePrefs(
      {
        subject: 'dragons',
        variant: { [REF_SUBJECT.movement]: 9, [REF_SUBJECT.perspective]: 'moon' },
        view: 'upside-down',
        tools: 'spray',
        opacity: 3,
      },
      TOOLS,
    );
    expect(p).toEqual(normalizeFreePrefs(null, TOOLS));
  });
});
