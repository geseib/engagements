/**
 * SWITCHING GOOGLE ACCOUNT (2026-10-02, reported by the owner: "there is no way
 * to change the google account that they login with").
 *
 * signOut used to forget only this tab's tokens. Cognito's hosted domain kept
 * its own session, so the next "Continue with Google" came straight back as
 * the same account. A Google user's sign-out now also leaves that session
 * through /logout; an email/password user's sign-out is unchanged.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUser = { username: 'google_1234', signOut: null, idPayload: { 'cognito:groups': ['hosts'] } };
jest.mock('amazon-cognito-identity-js', () => ({
  // A plain function, not jest.fn: CRA's resetMocks wipes a jest.fn's
  // implementation before every test, which left getCurrentUser undefined.
  CognitoUserPool: function MockPool() { return ({
    getCurrentUser: () => ({
      username: mockUser.username,
      getUsername: () => mockUser.username,
      signOut: mockUser.signOut,
      getSession: (cb) => cb(null, {
        isValid: () => true,
        getIdToken: () => ({ payload: mockUser.idPayload, getJwtToken: () => 'tok' }),
      }),
      getUserAttributes: (cb) => cb(null, []),
    }),
  }); },
  CognitoUser: jest.fn(),
  AuthenticationDetails: jest.fn(),
  CognitoUserAttribute: jest.fn(),
}));

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { navigateTo } from '../auth/navigate';
import { hostedLogoutUrl, isGoogleUsername, isGoogleSession } from '../auth/googleSignIn';

function Probe() {
  const { signOut, currentUser } = useAuth();
  return <button type="button" onClick={signOut}>{currentUser ? 'signed in' : 'signed out'}</button>;
}

let assign;
beforeEach(() => {
  window.USER_POOL_ID = 'us-east-1_JKKUmbQte';
  window.USER_POOL_CLIENT_ID = 'client123';
  window.COGNITO_DOMAIN = 'engagetest-auth';
  assign = navigateTo;
  assign.mockReset();
  mockUser.signOut = jest.fn();
  mockUser.idPayload = { 'cognito:groups': ['hosts'] };
});


const LOGOUT = () => `https://engagetest-auth.auth.us-east-1.amazoncognito.com/logout?client_id=client123&logout_uri=${encodeURIComponent(window.location.origin)}`;

const signInThenOut = async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  const btn = await screen.findByRole('button', { name: 'signed in' });
  fireEvent.click(btn);
  await waitFor(() => expect(mockUser.signOut).toHaveBeenCalledTimes(1));
};

test('a Google user\'s sign-out also leaves the hosted session, back to this site', async () => {
  mockUser.username = 'google_1234';
  await signInThenOut();
  expect(assign).toHaveBeenCalledWith(LOGOUT());
  // Said again on the next tick, so it outlives the caller's own navigation.
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  expect(assign).toHaveBeenLastCalledWith(LOGOUT());
});

/*
 * THE RACE (2026-11-04). GameHostPage and AdminPage sign out with
 * `signOut(); window.location.href = '/auth'`, App.jsx with
 * `signOut(); window.location.reload()`. The later navigation replaced the
 * /logout one, so the hosted session was never ended from those pages. The
 * last navigation the page asks for must be /logout.
 */
test('a caller navigating straight after signOut does not get the last word', async () => {
  mockUser.username = 'google_1234';
  function HostLikeSignOut() {
    const { signOut, currentUser } = useAuth();
    return (
      <button type="button" onClick={() => { signOut(); navigateTo('/auth'); }}>
        {currentUser ? 'signed in' : 'signed out'}
      </button>
    );
  }
  render(<AuthProvider><HostLikeSignOut /></AuthProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'signed in' }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(3));
  expect(assign.mock.calls.map((c) => c[0])).toEqual([LOGOUT(), '/auth', LOGOUT()]);
});

test('a native account linked to Google (identities claim) also leaves the hosted session', async () => {
  mockUser.username = '044864f8-10c1-70ff-1344-85423e394cfb';
  mockUser.idPayload = {
    'cognito:groups': ['admins'],
    identities: [{ providerName: 'Google', providerType: 'Google', userId: '1' }],
  };
  await signInThenOut();
  await waitFor(() => expect(assign).toHaveBeenCalledWith(LOGOUT()));
});

test('an email and password user\'s sign-out stays on the page, as before', async () => {
  mockUser.username = '044864f8-10c1-70ff-1344-85423e394cfb';
  await signInThenOut();
  await new Promise((r) => setTimeout(r, 5));
  expect(assign).not.toHaveBeenCalled();
});

test('the helpers: Google usernames, and no logout URL without a hosted domain', () => {
  expect(isGoogleUsername('google_998')).toBe(true);
  expect(isGoogleUsername('Google_998')).toBe(true);
  expect(isGoogleUsername('dana@example.com')).toBe(false);
  expect(isGoogleSession('abc', { identities: '[{"providerName":"Google"}]' })).toBe(true);
  expect(isGoogleSession('abc', { identities: 'not json' })).toBe(false);
  expect(isGoogleSession('abc', null)).toBe(false);
  delete window.COGNITO_DOMAIN;
  expect(hostedLogoutUrl()).toBeNull();
});
