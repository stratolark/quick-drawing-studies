export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // IDs are camelCase to match the getElementById and $('#…') lookups in src/ (2026-11-14).
    'selector-id-pattern': null,
    // The flagged pairs style different components; the file is ordered by component, not by specificity (2026-11-14).
    'no-descending-specificity': null,
  },
};
