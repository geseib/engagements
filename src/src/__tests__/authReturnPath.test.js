import { rememberReturnPath, takeReturnPath, RETURN_KEY } from '../auth/returnPath';

beforeEach(() => sessionStorage.clear());

describe('the OAuth return path', () => {
  test('remembers path and query, so ?gameId survives the round trip', () => {
    // rejects: storing pathname only, which lands the host on a remote with no
    // session and a code to key in by hand -- defeating the QR entirely
    rememberReturnPath({ pathname: '/remote', search: '?gameId=4821' });
    expect(takeReturnPath()).toBe('/remote?gameId=4821');
  });

  test('is consumed once', () => {
    // rejects: leaving it behind, so a later ordinary sign-in is hijacked back
    // to a session that ended hours ago
    rememberReturnPath({ pathname: '/remote', search: '?gameId=4821' });
    takeReturnPath();
    expect(takeReturnPath()).toBeNull();
  });

  test('nothing stored is null, not the empty string', () => {
    expect(takeReturnPath()).toBeNull();
  });

  test('an absolute URL is refused', () => {
    // rejects: honouring whatever is in storage. This value survives a
    // cross-origin redirect, so treating it as a destination without a guard
    // is an open redirect.
    sessionStorage.setItem(RETURN_KEY, 'https://evil.example/steal');
    expect(takeReturnPath()).toBeNull();
  });

  test('a protocol-relative URL is refused', () => {
    // rejects: a guard that only checks for "http" -- //evil.example is still
    // off-origin and still navigates
    sessionStorage.setItem(RETURN_KEY, '//evil.example/steal');
    expect(takeReturnPath()).toBeNull();
  });

  test('the auth pages themselves are refused, so sign-in cannot loop', () => {
    sessionStorage.setItem(RETURN_KEY, '/auth?status=pending');
    expect(takeReturnPath()).toBeNull();
  });
});
