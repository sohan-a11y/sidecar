const globals = require('globals');

/**
 * Deliberately minimal. The point is to catch real mistakes — undefined variables,
 * dead bindings, accidental globals — not to reformat 3k lines of working code and
 * destroy git blame. Formatting lives in .prettierrc and is applied to files as they
 * are touched, never in a tree-wide sweep.
 */
module.exports = [
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**']
  },
  {
    // Main and preload: CommonJS on Node.
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error'
    }
  },
  {
    // Renderer: ESM with JSX in the browser.
    files: ['src/renderer/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    rules: {
      // No react plugin (one less dependency), so PascalCase bindings used only in JSX
      // are exempt — otherwise every imported component reads as unused.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]', caughtErrors: 'none' }],
      'no-undef': 'error',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error'
    }
  },
  {
    // vite.config.js is ESM.
    files: ['vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }] }
  }
];
