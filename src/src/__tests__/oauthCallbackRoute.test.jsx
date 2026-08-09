/**
 * @jest-environment-options {"url": "http://localhost/auth/callback"}
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import App from '../App';
import { RETURN_KEY } from '../auth/returnPath';
import { navigateTo } from '../auth/navigate';

/**
 * THE CALL SITE, not the module.
 *
 * `authReturnPath.test.js` proves `takeReturnPath()` returns the right string,
 * and all twelve of its tests passed while every Google sign-in still landed
 * on `/`: the route in App.jsx passed an `onSuccess` that hardcoded
 * `window.location.href = '/'`, so the computed destination was logged and
 * thrown away and the branch that used it was dead. No module test can see
 * that. This one renders the REAL route — App's router → OAuthCallback → the
 * stored return path → the navigation — and only passes if the destination
 * reaches the browser.
 *
 * The harm it stands for: a host scans the side panel's remote QR, signs in
 * with Google, and lands on the HOST page instead of /remote — a second host
 * page and a second host WebSocket on their phone, which deterministically
 * evicts the projector.
 *
 * Only the final `window.location.href =` is stubbed, and only because jsdom
 * makes it unobservable: `Location` is unforgeable (no delete, no defineProperty,
 * no spyOn) and cross-document navigation is not implemented. Everything
 * upstream of that one line is the real code.
 */

jest.mock('../auth/navigate', () => ({
  navigateTo: jest.fn(),
  default: jest.fn(),
}));

const APPROVED_HOST = { username: 'Google_1', groups: ['hosts'], attributes: { name: 'Host' } };

let mockGetCurrentUser;

jest.mock('../auth/AuthContext', () => {
  // ONE object, not a fresh one per render: OAuthCallback's effect depends on
  // `getCurrentUser`, so a new identity each render re-runs the whole callback
  // — and the second pass finds the return path already consumed and falls
  // back to '/', which would make this file's central assertion pass for the
  // wrong reason. The real context provider hands back a stable value too.
  const stableAuth = {
    getCurrentUser: (...args) => mockGetCurrentUser(...args),
    currentUser: null,
    loading: false,
  };
  return {
    AuthProvider: ({ children }) => children,
    useAuth: () => stableAuth,
  };
});

jest.mock('../GameHostPage', () => function MockGameHostPage() { return <div />; });
jest.mock('../PlayerPage', () => function MockPlayerPage() { return <div />; });
jest.mock('../AdminPage', () => function MockAdminPage() { return <div />; });

const USER_POOL_ID = 'us-east-1_TESTPOOL';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '');
const jwt = (payload) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.signature`;

/** A Cognito implicit-flow return, in the hash, exactly as the callback reads it. */
function putTokensInTheHash() {
  const accessToken = jwt({
    iss: `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`,
    token_use: 'access',
    scope: 'aws.cognito.signin.user.admin',
  });
  const idToken = jwt({ sub: 'abc-123', email: 'host@example.com', 'cognito:username': 'Google_1' });
  // Hash changes are the one navigation jsdom does implement.
  window.location.hash = `#access_token=${accessToken}&id_token=${idToken}&token_type=Bearer`;
}

beforeEach(() => {
  mockGetCurrentUser = jest.fn().mockResolvedValue(APPROVED_HOST);
  navigateTo.mockClear();
  window.USER_POOL_ID = USER_POOL_ID;
  window.USER_POOL_CLIENT_ID = 'testclientid';
  localStorage.clear();
  sessionStorage.clear();
  putTokensInTheHash();
});

describe('the /auth/callback route', () => {
  test('the route really is the OAuth callback, not a fallback render', () => {
    // Guards the rest of this file: if the router stopped matching, every
    // assertion below would be vacuously about a page that never ran.
    expect(window.location.pathname).toBe('/auth/callback');
  });

  test('an approved host lands on the path they were headed for', async () => {
    // rejects: the shipped code — App.jsx supplying an onSuccess that hardcodes
    // '/', which reduced takeReturnPath() to a side effect that only cleared
    // storage. Also rejects re-introducing any onSuccess override at this route.
    sessionStorage.setItem(RETURN_KEY, '/remote?gameId=4821');

    render(<App />);

    await waitFor(
      () => expect(navigateTo).toHaveBeenCalledWith('/remote?gameId=4821'),
      { timeout: 4000 }
    );
    expect(navigateTo).not.toHaveBeenCalledWith('/');
  }, 10000);

  test('with nothing remembered it falls back to the app root', async () => {
    // rejects: a fix that navigates to the stored value unconditionally and
    // sends the host to "null"/"undefined" when there was no return path.
    render(<App />);

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'), { timeout: 4000 });
  }, 10000);

  test('a pending user still goes to the approval screen, return path or not', async () => {
    // rejects: honouring the return path for someone with no approved account,
    // which drops them on /remote's sign-in wall and loops them back here.
    mockGetCurrentUser = jest.fn().mockResolvedValue({ username: 'New', groups: ['pending'] });
    sessionStorage.setItem(RETURN_KEY, '/remote?gameId=4821');

    render(<App />);

    await waitFor(
      () => expect(navigateTo).toHaveBeenCalledWith('/auth?status=pending'),
      { timeout: 4000 }
    );
    expect(navigateTo).not.toHaveBeenCalledWith('/remote?gameId=4821');
  }, 10000);
});
