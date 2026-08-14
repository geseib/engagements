/**
 * WHY THIS FILE EXISTS.
 *
 * Three product-down bugs in two days, every one of them a clean build:
 *
 *   - four calls to setters whose state a refactor had deleted, each one a
 *     dead control (Next Question, Switch game, the remote's big-screen key);
 *   - a hook dependency array naming a `const` declared 90 lines below it,
 *     which blanked the host page on every route;
 *   - a `useState` below five early returns, which blanked it on the Quick
 *     Start transition specifically.
 *
 * THERE WAS NO ESLINT IN THIS PROJECT AT ALL. The frontend builds with raw
 * webpack and babel-loader, which transpiles without resolving identifiers and
 * without understanding React, so all three compiled and shipped. The bespoke
 * source-scanning tests written after each one caught the bug already found and
 * never the next.
 *
 * THE RULE SET IS DELIBERATELY TINY, and that is the point. This is not a style
 * pass: there is no formatter here, and turning one on would bury the rules
 * that matter under thousands of spacing diffs nobody reads. These are the
 * three with a shipped outage behind them.
 *
 * `exhaustive-deps` IS A WARNING, NOT AN ERROR — a judgement, not an oversight.
 * This codebase has effects that deliberately omit dependencies, each with a
 * doc-block saying why; PlayerPage's resume handler even carries an
 * `eslint-disable-next-line react-hooks/exhaustive-deps` written when no ESLint
 * existed to read it. Making it an error would force either mass edits to
 * working code or mass suppressions, and both teach people to ignore the tool.
 * It stays visible and non-blocking.
 */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    es2022: true,
    /*
      `commonjs` DEFINES `require`, `module` AND `exports`, and this codebase
      genuinely uses all three in browser files. Webpack provides them at build
      time, and three modules — config/templateVariables.js,
      utils/adminEnvironment.js, utils/questionRows.js — are deliberately dual:
      imported by the bundle AND required by the node-run backend tests. Without
      this, `no-undef` flags correct code, which is the fastest way to get a
      linter switched off.
    */
    commonjs: true,
  },
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-undef': 'error',
  },
  globals: {
    process: 'readonly',
  },
  overrides: [
    {
      // Tests and the jest setup file run under jest, not in a browser.
      files: ['src/__tests__/**/*.js', 'src/__tests__/**/*.jsx', 'src/setupTests.js'],
      env: { jest: true, node: true },
    },
    {
      // Build tooling is Node, not browser.
      files: ['*.config.js', '.eslintrc.js', 'scripts/**/*.js'],
      env: { node: true, browser: false },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
};
