/**
 * WHICH TIER IS THIS CONSOLE TALKING TO?
 *
 * Three environments exist (engage.dev / engage.test / engage), they share an
 * archive service, and until now no admin screen said which one was loaded.
 * `AdminPage.jsx` read `window.API_BASE` and rendered it nowhere.
 *
 * The authority is `window.ENV`, and the thing to know about it is that the
 * deploy pipeline writes the LONG words:
 *
 *   buildspec-dev.yml:75    window.ENV = "development"
 *   buildspec-test.yml:75   window.ENV = "test"
 *   buildspec-prod.yml:52   window.ENV = "production"
 *
 * so any comparison against 'dev' or 'prod' matches nothing that was ever
 * deployed. `src/public/config.js` (the checked-in dev copy) agrees:
 * `window.ENV = 'development'`.
 *
 * When neither signal identifies a tier this returns `unknown`, deliberately.
 * Guessing 'dev' would put the word DEV in front of an operator who might be
 * on production, and the chip exists precisely so that cannot happen.
 */

/** The long word each buildspec writes → the short id the chip renders. */
const ENV_WORDS = {
  development: 'dev',
  dev: 'dev',
  test: 'test',
  testing: 'test',
  production: 'prod',
  prod: 'prod',
};

/** Stage segments an API Gateway URL is allowed to be read as a tier. */
const API_STAGES = { dev: 'dev', test: 'test', prod: 'prod' };

const LABELS = { dev: 'DEV', test: 'TEST', prod: 'PROD', unknown: 'ENV?' };

/** The last non-empty path segment of a URL, or '' if there is none. */
function lastPathSegment(url) {
  const withoutQuery = String(url).split(/[?#]/)[0];
  const afterScheme = withoutQuery.replace(/^[a-z]+:\/\//i, '');
  const segments = afterScheme.split('/').slice(1).filter(Boolean);
  return segments.length ? segments[segments.length - 1].toLowerCase() : '';
}

/** The host of a URL, or '' if it cannot be read as one. */
function hostOf(url) {
  const afterScheme = String(url).replace(/^[a-z]+:\/\//i, '');
  return afterScheme.split('/')[0] || '';
}

/**
 * @param {{env?: string, apiBase?: string}} config
 * @returns {{id: 'dev'|'test'|'prod'|'unknown', label: string, detail: string}}
 */
function describeEnvironment({ env, apiBase } = {}) {
  const word = String(env == null ? '' : env).trim().toLowerCase();
  let id = ENV_WORDS[word];

  if (!id && apiBase) {
    // Only the three known stage names are promoted. A custom domain whose
    // last segment happens to be 'v2' is not a tier, and reading it as one
    // would print a confident label for a console nobody can identify.
    id = API_STAGES[lastPathSegment(apiBase)];
  }

  if (!id) id = 'unknown';

  const host = apiBase ? hostOf(apiBase) : '';
  const detail = host ? `API ${host}` : 'API endpoint not configured';

  return { id, label: LABELS[id], detail };
}

module.exports = { describeEnvironment };
