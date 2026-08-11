/**
 * THE ADMIN CONSOLE'S API BASE, IN ONE PLACE.
 *
 * `UserManagement.jsx:21` used to read:
 *
 *   window.API_BASE?.replace(/\/$/, '') || 'https://h1jcmja0w1.execute-api...dev'
 *
 * — a hardcoded dev API Gateway id as the fallback for four calls, one of which
 * moves people between Cognito groups and one of which deletes accounts. If
 * `config.js` ever failed to load on production, the Users tab would have
 * listed, edited and deleted DEV's users while showing a PROD chrome, and
 * nothing on screen would have said so.
 *
 * A missing base now produces a same-origin path. That request fails, visibly,
 * against a console that has no API configured — which is the correct outcome:
 * the failure mode of a misconfigured console must not be "quietly operate on a
 * different environment". See utils/adminEnvironment.js for the other half of
 * this, the chip that names the tier.
 *
 * `window.API_BASE` is read at call time, not at module load: config.js is a
 * separate <script> and AdminPage.jsx's own module-scope `const API_BASE =
 * window.API_BASE` is a load-order bet this does not have to take.
 */

/**
 * Absolute URL for an admin/API path, from whatever `window.API_BASE` is now.
 * Tolerates a base with or without a trailing slash and a path with or without
 * a leading one, because both spellings exist in this codebase already.
 *
 * @param {string} path e.g. 'admin/users/list' or '/games'
 * @returns {string}
 */
export function adminApiUrl(path) {
  const base = String((typeof window !== 'undefined' && window.API_BASE) || '').replace(/\/+$/, '');
  const suffix = String(path == null ? '' : path).replace(/^\/+/, '');
  return base ? `${base}/${suffix}` : `/${suffix}`;
}

export default adminApiUrl;
