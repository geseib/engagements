import { rememberReturnPath, takeReturnPath, RETURN_KEY } from '../auth/returnPath';

/**
 * `window.history.pushState` is NOT the lever here, however much it looks like
 * it should be. setupTests.js replaces `window.location` with a plain object,
 * and that assignment succeeds -- so pushState moves `document.location` while
 * `window.location.pathname`, the thing `rememberReturnPath()` actually reads,
 * stays put. A test written with pushState passes or fails for reasons that
 * have nothing to do with the code under test. Move the stand-in instead.
 */
/**
 * Move the browser, for real.
 *
 * This assigned to `window.location.pathname` and `.search` directly, and under
 * jsdom 26 that is a SILENT NO-OP: `setupTests.js` tries to replace `location`
 * with a plain object, `delete window.location` returns false, the real
 * `Location` survives, and every assignment is treated as an ignored
 * navigation. So the three tests below ran against `/` no matter what they
 * asked for — they were not wrong about the behaviour, they were never
 * reaching it.
 *
 * `pushState` is the one thing that actually moves `location` here. It matters
 * that these tests keep calling `rememberReturnPath()` with NO argument: the
 * function takes an optional location, and passing one would sidestep exactly
 * the code path LoginForm and RegisterForm use. The no-argument call reading
 * `window.location` IS the defect under test.
 */
const browserSitsAt = (pathname, search = '') => {
  window.history.pushState({}, '', `${pathname}${search}`);
};

beforeEach(() => {
  sessionStorage.clear();
  browserSitsAt('/');
});

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

  test('a stored destination survives a later remember() made from an auth page', () => {
    // rejects: an unguarded `rememberReturnPath()` in LoginForm/RegisterForm.
    // Those run from the Google buttons, by which point the browser is already
    // sitting on /auth -- so the no-argument call read '/auth' out of
    // window.location and clobbered whatever the page that sent the host here
    // had stored. takeReturnPath() then refuses '/auth' and returns null, and
    // the callback falls back to '/'. The destination is not just wrong, it is
    // gone: a host who scanned the remote QR lands on a second host page.
    rememberReturnPath({ pathname: '/remote', search: '?gameId=4821' });

    browserSitsAt('/auth');
    rememberReturnPath();

    expect(sessionStorage.getItem(RETURN_KEY)).toBe('/remote?gameId=4821');
    expect(takeReturnPath()).toBe('/remote?gameId=4821');
  });

  test('an auth page is never stored, even with nothing to protect', () => {
    // rejects: a guard implemented as "only write when storage is empty".
    // That shape would let '/auth' in whenever the slot happened to be free,
    // and takeReturnPath() would hand back null for it -- storing a value that
    // is guaranteed to be discarded, which reads like a working return path.
    browserSitsAt('/auth');
    rememberReturnPath();

    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  test('a fresh non-auth page still overwrites a stale destination', () => {
    // rejects: a guard implemented as "only write when storage is empty".
    // Nothing consumes the key until an OAuth callback runs, so an abandoned
    // flow leaves its path behind indefinitely; the page the host is actually
    // on must win over that leftover.
    rememberReturnPath({ pathname: '/remote', search: '?gameId=1111' });

    browserSitsAt('/host/setup');
    rememberReturnPath();

    expect(takeReturnPath()).toBe('/host/setup');
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
