import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**/*.js', 'test/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Leading underscore marks a parameter kept for its position in a callback signature (2026-11-14).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  prettier,
  {
    rules: {
      // After eslint-config-prettier, which turns curly off. With 'all', Prettier never conflicts (2026-11-14).
      curly: ['error', 'all'],
    },
  },
];
