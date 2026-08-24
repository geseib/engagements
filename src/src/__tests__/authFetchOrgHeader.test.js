/**
 * X-Engage-Org ON EVERY AUTHENTICATED REQUEST — auth/authFetch.js
 *
 * The header is what makes the console tenanted. `auth/authorizer.js` resolves
 * it and, for an org the caller is not a member of, resolves to NO org rather
 * than a fallback — which is the only reason it is safe to keep the choice in
 * localStorage at all.
 *
 * WHAT THIS ALSO PINS is the negative: participants join with plain `fetch`
 * and no token, and an unauthenticated request must never name an
 * organisation.
 */
jest.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: jest.fn().mockImplementation(() => ({
    getCurrentUser: () => global.__cognitoUser,
  })),
}));

const load = () => {
  let mod;
  jest.isolateModules(() => { mod = require('../auth/authFetch'); });
  return mod;
};

const signedIn = () => {
  global.__cognitoUser = {
    getSession: (cb) => cb(null, {
      isValid: () => true,
      getIdToken: () => ({ getJwtToken: () => 'tok-123' }),
    }),
  };
};
const signedOut = () => { global.__cognitoUser = null; };

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  signedIn();
});

const headersOf = () => global.fetch.mock.calls[0][1].headers;

describe('the accessor', () => {
  // rejects: renaming the key, which silently signs everyone back into no org
  test('stores under engage.activeOrg', () => {
    const m = load();
    expect(m.ACTIVE_ORG_STORAGE_KEY).toBe('engage.activeOrg');
    m.setActiveOrgId('o-nw');
    expect(window.localStorage.getItem('engage.activeOrg')).toBe('o-nw');
    expect(m.getActiveOrgId()).toBe('o-nw');
  });

  // rejects: a falsy set leaving the previous org in place
  test('clearing it means no org, not the last org', () => {
    const m = load();
    m.setActiveOrgId('o-nw');
    m.setActiveOrgId('');
    expect(m.getActiveOrgId()).toBe('');
    expect(window.localStorage.getItem('engage.activeOrg')).toBeNull();
  });

  // rejects: caching the id at module load, so a switch needs a page reload
  test('it is read at call time, not cached', async () => {
    const m = load();
    m.setActiveOrgId('o-one');
    await m.authFetch('/x');
    expect(global.fetch.mock.calls[0][1].headers['X-Engage-Org']).toBe('o-one');
    m.setActiveOrgId('o-two');
    await m.authFetch('/x');
    expect(global.fetch.mock.calls[1][1].headers['X-Engage-Org']).toBe('o-two');
  });

  // rejects: letting a Safari-private storage throw take the console down
  test('a storage that throws costs the choice, not the page', () => {
    const m = load();
    const spy = jest.spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation(() => { throw new Error('denied'); });
    expect(m.getActiveOrgId()).toBe('');
    spy.mockRestore();
  });
});

describe('the header', () => {
  // rejects: dropping the org header, which puts every request back in one shared world
  test('rides along with the token', async () => {
    const m = load();
    m.setActiveOrgId('o-nw');
    await m.authFetch('/admin/x');
    expect(headersOf().Authorization).toBe('Bearer tok-123');
    expect(headersOf()[m.ORG_HEADER]).toBe('o-nw');
    expect(m.ORG_HEADER).toBe('X-Engage-Org');
  });

  // rejects: sending an org on a participant's unauthenticated join
  test('is never sent without a token', async () => {
    const m = load();
    m.setActiveOrgId('o-nw');
    signedOut();
    await m.authFetch('/games/abc');
    expect(headersOf().Authorization).toBeUndefined();
    expect(headersOf()['X-Engage-Org']).toBeUndefined();
  });

  // rejects: an org that is not selected being sent as an empty header
  test('is absent, not empty, when no org is selected', async () => {
    const m = load();
    await m.authFetch('/admin/x');
    expect('X-Engage-Org' in headersOf()).toBe(false);
  });

  // rejects: the stored org overriding a call that deliberately names one
  test('an explicit header on the call wins', async () => {
    const m = load();
    m.setActiveOrgId('o-nw');
    await m.authFetch('/admin/x', { headers: { 'X-Engage-Org': 'o-other' } });
    expect(headersOf()['X-Engage-Org']).toBe('o-other');
  });

  // rejects: clobbering headers the caller passed, e.g. Content-Type on a POST
  test('the caller’s other headers survive', async () => {
    const m = load();
    m.setActiveOrgId('o-nw');
    await m.authFetch('/admin/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(headersOf()['Content-Type']).toBe('application/json');
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('the participant surfaces stay on plain fetch', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  // rejects: routing a participant surface through authFetch, which would name an org
  test.each(['PlayerPage.jsx', 'components/RootPage.jsx'])('%s imports no authFetch', (file) => {
    expect(read(file)).not.toMatch(/authFetch/);
  });
});
