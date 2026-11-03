/**
 * THE ONE SUSPENDED SCREEN (#40) — auth/suspension.js and SuspendedScreen.jsx.
 *
 * The server refuses a suspended account, or a member acting for a suspended
 * organisation, at the authorizer (auth/standing.js) with API Gateway's bare
 * 403. The console learns why from GET /orgs and shows one screen instead of
 * a page of errors. Pinned here:
 *
 *   - GET /orgs' two answers are read into a suspension, and nothing else is;
 *   - a bare authorizer 403 is told apart from a handler's 403;
 *   - authFetch, on a bare 403, asks GET /orgs and reports what it says,
 *     while handing the caller its response untouched;
 *   - the screen says which kind, offers the caller's other spaces for an
 *     organisation, and never says why (the reason is staff's).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuspendedScreen from '../components/SuspendedScreen';
import {
  standingFromOrgs, isAuthorizerRefusal, ACCOUNT_SUSPENDED, ORG_SUSPENDED,
} from '../auth/suspension';

jest.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: jest.fn().mockImplementation(() => ({
    getCurrentUser: () => global.__cognitoUser,
  })),
}));

const res = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  clone() { return res(status, body); },
});

describe('reading GET /orgs', () => {
  test('403 ACCOUNT_SUSPENDED is an account suspension', () => {
    expect(standingFromOrgs(403, { code: ACCOUNT_SUSPENDED, error: 'This account is suspended.' }))
      .toEqual({ code: ACCOUNT_SUSPENDED, orgId: '', message: 'This account is suspended.' });
  });

  test('200 with suspension is an org suspension, offering the active places only', () => {
    const found = standingFromOrgs(200, {
      orgs: [
        { orgId: 'org_T', name: 'Northwind', status: 'suspended' },
        { orgId: 'org_H', name: 'Ada', type: 'personal', status: 'active' },
        { orgId: 'org_X', name: 'Other', status: 'suspended' },
      ],
      suspension: { code: ORG_SUSPENDED, orgId: 'org_T', orgName: 'Northwind', message: 'm' },
    });
    expect(found.code).toBe(ORG_SUSPENDED);
    expect(found.orgName).toBe('Northwind');
    expect(found.elsewhere).toEqual([{ orgId: 'org_H', name: 'Ada', type: 'personal' }]);
  });

  test('anything else is not a suspension', () => {
    expect(standingFromOrgs(200, { orgs: [] })).toBeNull();
    expect(standingFromOrgs(403, { error: 'Sign in to do this.' })).toBeNull();
    expect(standingFromOrgs(500, {})).toBeNull();
  });
});

describe('telling the authorizer\'s 403 from a handler\'s', () => {
  test('exactly {"message":"Forbidden"} is the authorizer', async () => {
    expect(await isAuthorizerRefusal(res(403, { message: 'Forbidden' }))).toBe(true);
  });
  test('a handler\'s refusal, a 401 or a 200 is not', async () => {
    expect(await isAuthorizerRefusal(res(403, { error: 'Only the host may do this.' }))).toBe(false);
    expect(await isAuthorizerRefusal(res(401, { message: 'Unauthorized' }))).toBe(false);
    expect(await isAuthorizerRefusal(res(200, {}))).toBe(false);
    expect(await isAuthorizerRefusal({ status: 403 })).toBe(false);   // no clone: no guess
  });
});

describe('authFetch asks why after a bare refusal', () => {
  const load = () => {
    let mods;
    jest.isolateModules(() => {
      mods = { af: require('../auth/authFetch'), s: require('../auth/suspension') };
    });
    return mods;
  };
  beforeEach(() => {
    window.API_BASE = 'https://api.example.test/dev';
    global.__cognitoUser = {
      getSession: (cb) => cb(null, { isValid: () => true, getIdToken: () => ({ getJwtToken: () => 'tok' }) }),
    };
  });

  test('a bare 403 -> GET /orgs -> the account suspension is reported; the caller gets its 403', async () => {
    const { af, s } = load();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(403, { message: 'Forbidden' }))
      .mockResolvedValueOnce(res(403, { code: ACCOUNT_SUSPENDED, error: 'This account is suspended.' }));
    const out = await af.authFetch('https://api.example.test/dev/games', { method: 'POST' });
    expect(out.status).toBe(403);
    await waitFor(() => expect(s.getSuspension()).not.toBeNull());
    expect(s.getSuspension().code).toBe(ACCOUNT_SUSPENDED);
    expect(global.fetch.mock.calls[1][0]).toBe('https://api.example.test/dev/orgs');
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  test('a handler\'s 403 asks nothing', async () => {
    const { af, s } = load();
    global.fetch = jest.fn().mockResolvedValue(res(403, { error: 'Only the host may do this.' }));
    await af.authFetch('https://api.example.test/dev/games/1234/next', { method: 'POST' });
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(s.getSuspension()).toBeNull();
  });

  test('a bare 403 for a host in good standing reports nothing', async () => {
    const { af, s } = load();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(403, { message: 'Forbidden' }))
      .mockResolvedValueOnce(res(200, { orgs: [] }));
    await af.authFetch('https://api.example.test/dev/admin/users/list', { method: 'POST' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(s.getSuspension()).toBeNull();
  });
});

describe('the screen', () => {
  test('an account: says so, offers joining as a player and signing out, gives no reason', () => {
    const onSignOut = jest.fn();
    render(<SuspendedScreen suspension={{ code: ACCOUNT_SUSPENDED }} onSignOut={onSignOut} />);
    expect(screen.getByRole('heading', { name: 'This account is suspended' })).toBeInTheDocument();
    expect(screen.getByText(/contact the Engage team/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join a session' })).toHaveAttribute('href', '/play');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  test('an organisation: names it, and offers the caller\'s own space', () => {
    const onGoTo = jest.fn();
    render(
      <SuspendedScreen
        suspension={{ code: ORG_SUSPENDED, orgId: 'org_T', orgName: 'Northwind', elsewhere: [{ orgId: 'org_H', name: 'Ada', type: 'personal' }] }}
        onGoTo={onGoTo}
        onSignOut={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Northwind is suspended' })).toBeInTheDocument();
    expect(screen.getByText(/contact your organisation’s owner or the Engage team/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to your own space' }));
    expect(onGoTo).toHaveBeenCalledWith('org_H');
    expect(screen.queryByRole('link', { name: 'Join a session' })).toBeNull();
  });

  test('the screen declares its own theme', () => {
    const { container } = render(<SuspendedScreen suspension={{ code: ACCOUNT_SUSPENDED }} />);
    expect(container.firstChild).toHaveAttribute('data-theme', 'dark');
  });
});
