import { CognitoUserPool } from 'amazon-cognito-identity-js';

// Standalone token access for non-hook call sites (mirrors AuthContext's
// lazy pool init so config.js has loaded before the pool is created).
const getUserPool = () => {
  const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID || 'us-east-1_PLACEHOLDER';
  const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';
  return new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
};

/**
 * WHICH ORGANISATION THIS REQUEST IS ABOUT.
 *
 * `auth/authorizer.js` resolves `X-Engage-Org` on every authenticated request.
 * A requested org the caller is not a member of resolves to NO org — never a
 * fallback — so a stale id in localStorage costs an empty console and never
 * somebody else's content. That is why this can be stored client-side at all.
 *
 * IT IS NOT SENT WITHOUT A TOKEN. `PlayerPage` and `RootPage` join sessions
 * with plain `fetch` and no credentials; a participant's browser has no
 * business naming an organisation, and an unauthenticated request carrying one
 * is a header the API would have to decide to ignore. Here it is simply never
 * attached: no token, no org.
 */
export const ORG_HEADER = 'X-Engage-Org';

/** localStorage key. One constant so the reader and the writer cannot drift. */
export const ACTIVE_ORG_STORAGE_KEY = 'engage.activeOrg';

/**
 * The one non-org value this header may carry: "I am acting as Engage."
 *
 * Duplicated from `config/consoleSections.js` rather than imported, because
 * this module is the transport and must not depend on the console's
 * configuration. `__tests__/platformModeWiring.test.jsx` asserts the two agree.
 */
export const PLATFORM_MODE_HEADER = '~platform';

/* Read at call time rather than cached in a module variable: the switcher can
   change it in another component, and a cached copy would send the previous
   org for the rest of the page's life. localStorage access is wrapped because
   Safari's private mode throws on it, and a console that cannot render because
   a storage read threw is worse than a console with no org selected. */

/** The active organisation id, or '' when none has been chosen. */
export function getActiveOrgId() {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

/** Remember the active organisation. A falsy id clears it. */
export function setActiveOrgId(orgId) {
  try {
    if (orgId) window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, String(orgId));
    else window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
  } catch (err) {
    /* Storage refused. The choice lasts this page load and no longer, which is
       a degraded console rather than a broken one. */
  }
  return getActiveOrgId();
}

// Resolve the current user's ID token, or null when signed out / expired.
export const getAuthToken = () => new Promise((resolve) => {
  try {
    const cognitoUser = getUserPool().getCurrentUser();
    if (!cognitoUser) return resolve(null);
    cognitoUser.getSession((err, session) => {
      if (err || !session || !session.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  } catch (err) {
    console.error('getAuthToken failed:', err);
    resolve(null);
  }
});

// fetch() that attaches the Cognito ID token as a Bearer Authorization
// header, and the active organisation as X-Engage-Org. Used for /admin/*
// routes, which the API's Lambda authorizer protects; falls back to an
// unauthenticated request when signed out, and then sends no org either.
export const authFetch = async (url, options = {}) => {
  const token = await getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    /* An explicit header on the call wins: a screen acting on a named org —
       the switcher's own GET /orgs, a platform grant — must not be silently
       redirected to whatever this browser last selected. */
    /*
      A MINTED ORG ID, OR THE PLATFORM SENTINEL. Nothing else.

      This used to drop `~platform` and send no header at all, reasoning that a
      sentinel masquerading as an org id was a fail-open waiting to happen. That
      reasoning was sound about the VALUE and wrong about the CONSEQUENCE:
      sending nothing does not mean "no organisation". `auth/pick-active-org.js`
      falls back to the single membership, then to `defaultOrgId` — and every
      approved account has a personal org — so platform mode arrived at the
      server indistinguishable from standing in your own space.

      That is how an Engage admin acting as a host in TeamG edited Engage's
      shared library: the server had no way to know which hat was on, and
      `canManageScope(PLATFORM)` now requires that it does.

      The sentinel is safe to send precisely because it can never match a
      membership: `pickActiveOrg` returns null for any requested org the caller
      does not belong to, so it resolves to NO organisation rather than to some
      other one. The fail-open the old comment feared would need a fallback on
      the REQUESTED path, which is the one place that must never have one.
    */
    const orgId = getActiveOrgId();
    const sendable = /^org_[1-9A-HJ-NP-Za-km-z]+$/.test(orgId) || orgId === PLATFORM_MODE_HEADER;
    if (sendable && !headers[ORG_HEADER]) {
      headers[ORG_HEADER] = orgId;
    }
  }
  return fetch(url, { ...options, headers });
};
