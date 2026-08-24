/**
 * THE MODE HAS TO SURVIVE THE TRIP TO THE SERVER.
 *
 * `consoleModes.test.js` proves the nav is right for a given mode. This proves
 * the two places the mode can leak: the header `authFetch` attaches, and the
 * switcher that is the only control able to set it.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ACTIVE_ORG_STORAGE_KEY, PLATFORM_MODE_HEADER, authFetch } from '../auth/authFetch';

// The header only rides along with a token — signed out, authFetch sends
// neither. Mocking the pool is how every other suite here gets a session.
jest.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: jest.fn(() => ({
    getCurrentUser: () => ({
      getSession: (cb) => cb(null, {
        isValid: () => true,
        getIdToken: () => ({ getJwtToken: () => 'tok' }),
      }),
    }),
  })),
  CognitoUser: jest.fn(),
  AuthenticationDetails: jest.fn(),
}));
import { PLATFORM_MODE } from '../config/consoleSections';
import OrgSwitcher from '../components/OrgSwitcher';

describe('the org header', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  });

  const headerSent = () => (global.fetch.mock.calls[0][1].headers || {})['X-Engage-Org'];

  /*
    THIS TEST USED TO REQUIRE THE OPPOSITE, and the reversal is the whole point.

    It asserted the sentinel was DROPPED, reasoning that a non-org value in an
    org header was a fail-open waiting to happen. Sound about the value, wrong
    about the consequence: sending nothing does not mean "no organisation".
    `pickActiveOrg` falls back to the single membership and then to
    `defaultOrgId`, and every approved account has a personal org — so platform
    mode reached the server indistinguishable from standing in your own space.

    That is how an Engage admin acting as a host in TeamG edited Engage's shared
    library. `canManageScope(PLATFORM)` now requires the absence of an active
    org, so the server has to be able to SEE the mode.

    Safe because the sentinel can never match a membership: a requested org the
    caller does not belong to resolves to null, not to a fallback.
  */
  // rejects: swallowing the mode, which leaves the server unable to tell an
  // Engage admin acting as Engage from one standing in a customer's team.
  it('carries the platform sentinel so the server can see the mode', async () => {
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, PLATFORM_MODE);
    await authFetch('https://api.test/orgs');
    expect(headerSent()).toBe(PLATFORM_MODE);
  });

  // rejects: the transport and the console drifting apart on the one string
  // that has to mean the same thing at both ends.
  it('agrees with the console on what that sentinel is', () => {
    expect(PLATFORM_MODE_HEADER).toBe(PLATFORM_MODE);
  });

  // rejects: a blanket "send whatever is in storage". Anything that is not
  // shaped like a minted org id is a stale or corrupt value, and the safe
  // direction is no org rather than some other org.
  it('is not sent for any value that is not a minted org id', async () => {
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, 'ORG#nope');
    await authFetch('https://api.test/orgs');
    expect(headerSent()).toBeUndefined();
  });

  // rejects: a guard so tight it drops the real thing.
  it('is sent for a real org id', async () => {
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, 'org_WLZyeb6wGSarf1grsXGxSM');
    await authFetch('https://api.test/orgs');
    expect(headerSent()).toBe('org_WLZyeb6wGSarf1grsXGxSM');
  });
});

describe('the switcher', () => {
  const ORGS = [
    { orgId: 'org_a', name: 'Amara Reyes', type: 'personal', role: 'owner' },
    { orgId: 'org_b', name: 'Northwind', type: 'team', role: 'admin' },
  ];

  // rejects: the platform chip staying INERT. It was drawn as a locked chip on
  // the reasoning that Engage is not an organisation and cannot be switched to
  // — true, and it left staff with no way to reach the platform console at all
  // once the additive nav was removed. It is the switcher's job because the
  // switcher is the control that already means "who am I right now".
  it('offers Engage as a selectable mode for staff', () => {
    const onSelect = jest.fn();
    render(<OrgSwitcher organisations={ORGS} activeOrgId="org_a" platform onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Amara Reyes/ }));
    // role="menuitem", not "button" — the explicit role wins over the implicit
    // one, so a getByRole('button') here finds nothing and reads as "the row is
    // missing" when the row is right there.
    fireEvent.click(screen.getByRole('menuitem', { name: /Engage/ }));
    expect(onSelect).toHaveBeenCalledWith(PLATFORM_MODE, null);
  });

  // rejects: offering the platform row to a host, which would be a link to a
  // console every route behind it refuses.
  it('does not offer it to somebody who is not staff', () => {
    render(<OrgSwitcher organisations={ORGS} activeOrgId="org_a" onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Amara Reyes/ }));
    expect(screen.queryByRole('menuitem', { name: /Engage/ })).toBeNull();
  });

  // rejects: showing an org name on the chip while actually in platform mode —
  // the exact ambiguity the mode exists to remove.
  it('says Engage on the chip while in platform mode', () => {
    render(<OrgSwitcher organisations={ORGS} activeOrgId={PLATFORM_MODE} platform onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Engage/ })).toBeInTheDocument();
    expect(screen.queryByText('Amara Reyes')).toBeNull();
  });
});
