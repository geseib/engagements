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

describe('the WHATWG-parser boundary a prefix check cannot see', () => {
  // Each of these passes `value.startsWith('/') && !value.startsWith('//')`
  // -- the original implementation's guard -- while still resolving to a
  // different origin once a real URL parser (or `window.location.href =`)
  // gets hold of it. They exist to reject exactly that implementation.

  test('a leading backslash is refused: it resolves like a forward slash for http(s)', () => {
    // rejects: the prefix-check implementation. "/\evil.example/steal"[0] is
    // "/" and [1] is "\", not "/", so it slips past `startsWith('//')` --
    // but the WHATWG parser treats "\" as "/" for special schemes, so this
    // resolves to https://evil.example/steal.
    sessionStorage.setItem(RETURN_KEY, '/\\evil.example/steal');
    expect(takeReturnPath()).toBeNull();
  });

  test('an embedded carriage return is refused', () => {
    // rejects: the prefix-check implementation. The parser strips embedded
    // CR before parsing the authority, so "/\r/evil.example" resolves to
    // //evil.example -- off-origin -- even though it starts with a single "/".
    sessionStorage.setItem(RETURN_KEY, '/\r/evil.example');
    expect(takeReturnPath()).toBeNull();
  });

  test('an embedded newline is refused', () => {
    // rejects: the prefix-check implementation, for the same reason as \r.
    sessionStorage.setItem(RETURN_KEY, '/\n/evil.example');
    expect(takeReturnPath()).toBeNull();
  });

  test('an embedded tab is refused', () => {
    // rejects: the prefix-check implementation, for the same reason as \r.
    sessionStorage.setItem(RETURN_KEY, '/\t/evil.example');
    expect(takeReturnPath()).toBeNull();
  });

  test('a valid path with a query still round-trips unchanged', () => {
    // rejects: an origin check that forgets to reconstruct pathname+search
    // from the parsed URL and returns null (or the wrong value) for
    // perfectly ordinary input.
    sessionStorage.setItem(RETURN_KEY, '/remote?gameId=4821');
    expect(takeReturnPath()).toBe('/remote?gameId=4821');
  });

  test('a value the URL parser cannot resolve at all is refused', () => {
    // rejects: an implementation that assumes `new URL(value, origin)`
    // always succeeds and skips the try/catch around it.
    sessionStorage.setItem(RETURN_KEY, 'http://');
    expect(takeReturnPath()).toBeNull();
  });
});
