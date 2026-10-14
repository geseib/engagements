/**
 * @jest-environment-options {"url": "http://localhost/host?gameId=5479"}
 */
/**
 * A SIGN-IN THAT RUNS OUT WHILE THE HOST SCREEN IS OPEN (owner, 2026-10-12).
 *
 * "When the host screen login expired, I get this error when clicking on
 * 'Next Round': … Failed to get next question: Unauthorized (HTTP 401).
 * Shouldn't it just go to the login page and come back?"
 *
 * The 401 meant authFetch had sent the request with NO Authorization header:
 * `getSession` could not produce a valid session, and for a Google sign-in it
 * never could after an hour, because the implicit grant returns no refresh
 * token. These tests pin the three halves of the fix:
 *
 *   - authFetch refreshes once and retries once when the API says 401,
 *   - when no refresh is possible the page swaps to the sign-in form IN PLACE
 *     (the URL and its session id survive), with a return path and no alert,
 *   - Google sign-in asks for an authorization code (with PKCE), so it has a
 *     refresh token to refresh with at all.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import AuthPage from '../auth/AuthPage';
import { authFetch as sharedAuthFetch } from '../auth/authFetch';
import { __resetSessionExpiryForTests } from '../auth/sessionExpiry';

let mockMode = 'valid';      // what getSession answers
let mockRefresh = 'fails';   // what refreshSession answers
jest.mock('amazon-cognito-identity-js', () => {
  const session = (tok) => ({
    isValid: () => true,
    getIdToken: () => ({
      getJwtToken: () => tok,
      payload: { 'cognito:groups': ['hosts'] },
    }),
    getRefreshToken: () => ({ getToken: () => 'refresh-tok' }),
  });
  const user = {
    getUsername: () => 'host-1',
    username: 'host-1',
    getSession: (cb) => {
      if (mockMode === 'valid') return cb(null, session('tok-old'));
      return cb(new Error('Cannot retrieve a new session. Please authenticate.'), null);
    },
    refreshSession: (_rt, cb) => (mockRefresh === 'works'
      ? cb(null, session('tok-new'))
      : cb(new Error('Refresh Token has expired'), null)),
    getUserAttributes: (cb) => cb(null, [{ getName: () => 'email', getValue: () => 'host@example.com' }]),
    signOut: jest.fn(),
  };
  return {
    CognitoUserPool: jest.fn().mockImplementation(() => ({ getCurrentUser: () => global.__noUser ? null : user })),
    CognitoUser: jest.fn(),
    CognitoRefreshToken: jest.fn().mockImplementation(({ RefreshToken }) => ({ getToken: () => RefreshToken })),
    AuthenticationDetails: jest.fn(),
    CognitoUserAttribute: jest.fn(),
  };
});
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn(), default: jest.fn() }));

const res = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const loadFresh = () => {
  let mods;
  jest.isolateModules(() => {
    mods = {
      authFetch: require('../auth/authFetch'),
      expiry: require('../auth/sessionExpiry'),
    };
  });
  return mods;
};

beforeEach(() => {
  mockMode = 'valid';
  mockRefresh = 'fails';
  global.__noUser = false;
  sessionStorage.clear();
  localStorage.clear();
  window.alert = jest.fn();
  window.USER_POOL_CLIENT_ID = 'client123';
  // Where amazon-cognito-identity-js keeps the refresh token for this user.
  localStorage.setItem('CognitoIdentityServiceProvider.client123.host-1.refreshToken', 'refresh-tok');
  __resetSessionExpiryForTests();
});

describe('authFetch on a 401', () => {
  // rejects: a session whose ID token lapsed being sent unauthenticated and
  //          surfacing as "Unauthorized" when a refresh would have worked.
  test('a 401 then a successful refresh retries once, with the new token, and succeeds', async () => {
    const { authFetch, expiry } = loadFresh();
    mockMode = 'expired';      // getSession cannot produce a valid session…
    mockRefresh = 'works';     // …but a forced refresh can
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(res(200, { state: 'ASK#002' }));
    const listener = jest.fn();
    expiry.onSessionExpired(listener);

    const out = await authFetch.authFetch('https://api/games/5479/next-question', { method: 'POST', body: '{}' });

    expect(out.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-new');
    expect(global.fetch.mock.calls[1][1].body).toBe('{}');
    expect(listener).not.toHaveBeenCalled();
    expect(expiry.isSessionExpired()).toBe(false);
  });

  // rejects: retrying (or signing the host out) on a handler's own 401 — a
  //          request that carried a token was not refused by the gateway.
  test('a 401 to a request that carried a token is handed back untouched', async () => {
    const { authFetch, expiry } = loadFresh();
    global.fetch = jest.fn().mockResolvedValue(res(401, { error: 'Access code required' }));
    const out = await authFetch.authFetch('https://api/games/5479/join', { method: 'POST' });
    expect(out.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(expiry.isSessionExpired()).toBe(false);
  });

  // rejects: a participant who was never signed in being told their sign-in ran out.
  test('nobody signed in: a plain 401, no expiry', async () => {
    const { authFetch, expiry } = loadFresh();
    global.__noUser = true;
    global.fetch = jest.fn().mockResolvedValue(res(401));
    await authFetch.authFetch('https://api/x');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(expiry.isSessionExpired()).toBe(false);
  });

  // rejects: a refresh that cannot happen being retried anyway, or passing silently.
  test('a refresh that fails is reported once, the request is not sent again, and the return path is kept', async () => {
    const { authFetch, expiry } = loadFresh();
    mockMode = 'expired';
    mockRefresh = 'fails';
    global.fetch = jest.fn().mockResolvedValue(res(401, { message: 'Unauthorized' }));
    const listener = jest.fn();
    expiry.onSessionExpired(listener);

    const out = await authFetch.authFetch('https://api/games/5479/next-question', { method: 'POST' });
    await authFetch.authFetch('https://api/games/5479/host-state');

    expect(out.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(2); // one per call, no retries
    expect(listener).toHaveBeenCalledTimes(1);
    expect(expiry.isSessionExpired()).toBe(true);
    expect(sessionStorage.getItem('authReturnTo')).toBe('/host?gameId=5479');
    expect(sessionStorage.getItem(expiry.RESUME_KEY)).toBe('/host?gameId=5479');
  });
});

describe('the page when the sign-in has run out', () => {
  // rejects: the old ending — a browser alert reading "Unauthorized (HTTP 401)"
  //          and a host screen that stays up but can do nothing.
  test('a failed refresh swaps to the sign-in form in place, says why, and never alerts', async () => {
    const Gate = () => {
      const { currentUser, loading } = useAuth();
      if (loading) return <p>loading</p>;
      return currentUser ? <p>host screen</p> : <AuthPage onAuthSuccess={() => {}} />;
    };
    render(<AuthProvider><Gate /></AuthProvider>);
    expect(await screen.findByText('host screen')).toBeInTheDocument();

    mockMode = 'expired';
    global.fetch = jest.fn().mockResolvedValue(res(401, { message: 'Unauthorized' }));
    await act(async () => { await sharedAuthFetch('https://api/games/5479/next-question', { method: 'POST' }); });

    expect(await screen.findByText(/your sign-in ran out/i)).toBeInTheDocument();
    expect(screen.queryByText('host screen')).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
    // In place: the session id is still in the URL the page reloads to.
    expect(window.location.pathname + window.location.search).toBe('/host?gameId=5479');
  });
});

describe('coming back after signing in again', () => {
  // rejects: the return landing on "/" (the host page with no session) or on
  //          a different session than the one the host was running.
  test('the return path brings the host back to the same session, once', () => {
    const { expiry } = loadFresh();
    const { takeReturnPath } = require('../auth/returnPath');
    mockMode = 'expired';
    expiry.notifySessionExpired();
    expect(takeReturnPath()).toBe('/host?gameId=5479');
    expect(expiry.takeResumeFor('9999')).toBe(false);
    expect(expiry.takeResumeFor('5479')).toBe(true);
    expect(expiry.takeResumeFor('5479')).toBe(false); // consumed
  });
});

describe('Google sign-in asks for a code, so it can be refreshed', () => {
  // rejects: response_type=token — the implicit grant returns no refresh token,
  //          so every Google host was signed out an hour after signing in.
  test('the authorize URL uses the code grant with an S256 challenge', async () => {
    window.USER_POOL_ID = 'us-east-1_TEST';
    window.USER_POOL_CLIENT_ID = 'client123';
    window.COGNITO_DOMAIN = 'engage-test';
    const { googleAuthorizeUrl, makePkcePair } = require('../auth/googleSignIn');
    const { webcrypto } = require('crypto');
    const pair = await makePkcePair(webcrypto);
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = googleAuthorizeUrl({ mode: 'login', challenge: pair.challenge });
    expect(url).toContain('response_type=code');
    expect(url).not.toContain('response_type=token');
    expect(url).toContain(`code_challenge=${pair.challenge}&code_challenge_method=S256`);
  });

  test('the S256 challenge is the base64url SHA-256 of the verifier (RFC 7636 appendix B)', async () => {
    const { makePkcePair } = require('../auth/googleSignIn');
    const { webcrypto } = require('crypto');
    const fixed = {
      getRandomValues: (arr) => {
        const bytes = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173,
          187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
        arr.set(bytes);
        return arr;
      },
      subtle: webcrypto.subtle,
    };
    const pair = await makePkcePair(fixed);
    expect(pair.verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(pair.challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
