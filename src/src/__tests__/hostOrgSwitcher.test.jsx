/**
 * KNOWING — AND CHANGING — WHICH TEAM YOU ARE WORKING IN, FROM THE MAIN SCREEN.
 *
 * Reported directly: "How does a host know or switch teams on the main screen
 * and see the right question sets."
 *
 * The answer was: they could not. The switcher lived only in the admin console,
 * so the screen a host lands on and starts sessions from said nothing about
 * which organisation was active — while `GET /question-sets` was scoped by
 * exactly that, through the `X-Engage-Org` header. A host in two teams picked
 * from one of them blind.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* `mock`-prefixed: a jest.mock factory is hoisted above the file and may not
   close over anything else. */
let mockStored = '';
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  getActiveOrgId: () => mockStored,
  setActiveOrgId: (id) => { mockStored = id || ''; },
}));

import ActiveOrgSwitcher from '../components/ActiveOrgSwitcher';

const HOME = { orgId: 'org_3JtYs6WgHn5RkMqZaB7uEv', name: 'Amara Reyes', type: 'personal', yourRole: 'owner' };
const NW = { orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR', name: 'Northwind Learning', type: 'team', yourRole: 'member' };
const MD = { orgId: 'org_Tb2VnQ8sLxK4WmC7gRdYpF', name: 'Meridian Delivery', type: 'team', yourRole: 'admin' };

const serve = (orgs) => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ orgs }) }));
};

beforeEach(() => { window.API_BASE = 'https://api.test/'; mockStored = ''; });

describe('what the host is told', () => {
  // rejects: a host in several teams with nothing on screen naming the one
  // whose question sets they are about to pick from.
  it('names the active organisation', async () => {
    mockStored = NW.orgId;
    serve([HOME, NW, MD]);
    render(<ActiveOrgSwitcher />);
    expect(await screen.findByTestId('orgsw-chip')).toHaveTextContent('Northwind Learning');
  });

  // rejects: a chip cluttering the screen of the many people who have exactly
  // one space and nothing to switch between.
  it('draws nothing at all for somebody with a single space', async () => {
    mockStored = HOME.orgId;
    serve([HOME]);
    const { container } = render(<ActiveOrgSwitcher />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('.orgsw')).toBeNull();
  });

  // rejects: an error banner across the screen somebody came to press a button
  // on, for a lookup they may not care about.
  it('is silent when the lookup fails', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    const { container } = render(<ActiveOrgSwitcher />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('.orgsw')).toBeNull();
  });
});

describe('switching', () => {
  // rejects: a switcher that names teams and cannot move between them.
  it('writes the chosen organisation so the next fetch is scoped to it', async () => {
    mockStored = NW.orgId;
    serve([HOME, NW, MD]);
    render(<ActiveOrgSwitcher />);
    fireEvent.click(await screen.findByTestId('orgsw-chip'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Meridian Delivery/ }));
    expect(mockStored).toBe(MD.orgId);
  });

  /*
    THE HOST SCREEN HAS NO PLATFORM MODE. Engage's console holds organisations,
    moderation and accounts — no sessions and no question sets — so offering
    "Act as Engage" on the screen whose only verb is "start an engagement" would
    offer a place where nothing on that screen can be done.
  */
  // rejects: putting the platform entry on a screen it cannot serve.
  it('does not offer platform mode here', async () => {
    mockStored = NW.orgId;
    serve([HOME, NW]);
    render(<ActiveOrgSwitcher />);
    fireEvent.click(await screen.findByTestId('orgsw-chip'));
    expect(screen.queryByRole('menuitem', { name: /Engage/ })).toBeNull();
  });
});

describe('a remembered organisation this account has left', () => {
  // rejects: sending an org id the caller is not a member of. The authorizer
  // resolves that to NO org, so the screen would act unscoped while naming a
  // team — the worst of both.
  it('is reconciled against what the server returns', async () => {
    mockStored = 'org_gonegonegonegonegone1';
    serve([HOME, NW]);
    render(<ActiveOrgSwitcher />);
    await waitFor(() => expect(mockStored).toBe(HOME.orgId));
    expect(await screen.findByTestId('orgsw-chip')).toHaveTextContent('Amara Reyes');
  });
});
