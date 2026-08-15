/**
 * Jest config for `quiz-verify-import.test.js` ONLY.
 *
 * The repo's own suite lives under `src/` and is configured by `src/jest.config.js`,
 * whose `roots` never reach this directory — so these files are invisible to
 * `npm test` and cannot slow or break it. This config borrows that one's
 * transform and adds `demo-sets` as a second root.
 *
 * `testEnvironment` is node rather than jsdom: nothing here renders.
 *
 * Run from the repo root:
 *   npx --prefix src jest --config demo-sets/quiz-verify-jest.config.js
 */
const path = require('path');

const REPO = path.resolve(__dirname, '..');

module.exports = {
  rootDir: REPO,
  testEnvironment: 'node',
  roots: [path.join(REPO, 'demo-sets')],
  testMatch: ['<rootDir>/demo-sets/quiz-verify-import.test.js'],
  transform: {
    '^.+\\.(js|jsx)$': ['babel-jest', { configFile: path.join(REPO, 'src', 'babel.config.js') }],
  },
  moduleFileExtensions: ['js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/'],
};
