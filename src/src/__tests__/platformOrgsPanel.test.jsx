/**
 * THE STAFF ORGANISATION LIST.
 *
 * The assertions that matter most here are the NEGATIVE ones. This is the one
 * screen in the product where the isolation guarantee could be given away by
 * accident — it is the only place that holds a list of other people's
 * organisations — so "no content is reachable from here" is asserted against
 * the rendered output rather than trusted to nobody having added a link.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PlatformOrgsPanel, { sinceLabel } from '../components/PlatformOrgsPanel';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const TEAM = {
  orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR',
  name: 'Northwind Learning',
  plan: 'team',
  type: 'team',
  status: 'active',
  members: 3,
  createdAt: '2026-02-01T00:00:00.000Z',
};
const HOME = {
  orgId: 'org_3JtYs6WgHn5RkMqZaB7uEv',
  name: 'Amara Reyes',
  plan: 'free',
  type: 'personal',
  status: 'active',
  members: 1,
  createdAt: '2026-06-04T00:00:00.000Z',
};
const WAITING = { ...TEAM, orgId: 'org_Tb2VnQ8sLxK4WmC7gRdYpF', name: 'Ardmore Health', status: 'pending' };

function serve(orgs, { onPost } = {}) {
  global.fetch = jest.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      if (onPost) onPost(String(url), JSON.parse(init.body || '{}'));
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        orgs,
        counts: {
          teams: orgs.filter((o) => o.type === 'team').length,
          personal: orgs.filter((o) => o.type === 'personal').length,
          suspended: orgs.filter((o) => o.status === 'suspended').length,
          pending: orgs.filter((o) => o.status === 'pending').length,
        },
      }),
    };
  });
}

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

describe('the list', () => {
  it('draws one row per organisation, with its member count', async () => {
    serve([TEAM, HOME]);
    render(<PlatformOrgsPanel />);
    const row = (await screen.findByText('Northwind Learning')).closest('tr');
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('Team')).toBeInTheDocument();
  });

  // rejects: hiding personal spaces, which would lose the ability to find one
  // to help its owner — or leaving them unmarked, which makes a list that is
  // mostly homes look like a list of mostly customers.
  it('marks a personal space without hiding it', async () => {
    serve([TEAM, HOME]);
    render(<PlatformOrgsPanel />);
    const row = (await screen.findByText('Amara Reyes')).closest('tr');
    expect(within(row).getByText('Personal')).toBeInTheDocument();
  });
});

describe('what this screen cannot do', () => {
  /*
    THE POINT OF THE WHOLE SPLIT, ASSERTED.

    A "View sets" or "Open" control here would quietly undo the guarantee, and
    it is exactly the control somebody adds while making the screen "more
    useful". There is no route behind it either — the server has no endpoint
    that reads a tenant partition for staff — but a test that only checked the
    server would not stop the link appearing and failing.
  */
  // rejects: any control on this screen that leads into an organisation.
  it('offers no route into anybody’s content', async () => {
    serve([TEAM, HOME]);
    render(<PlatformOrgsPanel />);
    await screen.findByText('Northwind Learning');
    for (const label of [/view/i, /open/i, /sets/i, /sessions/i, /reports/i, /impersonate/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(screen.queryByRole('link')).toBeNull();
  });

  // rejects: dropping the paragraph that explains the lost capability. Without
  // it an Engage admin reads the absence of those controls as a broken screen.
  it('says on the screen why there is nothing to click', async () => {
    serve([TEAM]);
    render(<PlatformOrgsPanel />);
    expect(await screen.findByText(/no “view their sets” button/i)).toBeInTheDocument();
  });
});

describe('approving and suspending', () => {
  it('approves an organisation that is waiting', async () => {
    const posts = [];
    serve([WAITING], { onPost: (url, body) => posts.push({ url, body }) });
    render(<PlatformOrgsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe(`https://api.test/platform/orgs/${WAITING.orgId}/status`);
    expect(posts[0].body).toEqual({ status: 'active' });
  });

  // rejects: offering Suspend on somebody's own home. The server refuses it
  // (409), and a control that always fails is worse than no control — the
  // reasoning is in platform-orgs.js: suspending a home is an account deletion
  // with a friendlier name.
  it('never offers Suspend on a personal space', async () => {
    serve([TEAM, HOME]);
    render(<PlatformOrgsPanel />);
    const home = (await screen.findByText('Amara Reyes')).closest('tr');
    expect(within(home).queryByRole('button', { name: /suspend/i })).toBeNull();
    const team = screen.getByText('Northwind Learning').closest('tr');
    expect(within(team).getByRole('button', { name: /suspend/i })).toBeInTheDocument();
  });

  // rejects: swallowing a refusal. A 409 that renders as nothing looks like the
  // click did not register, and the operator clicks again.
  it('shows the server’s refusal rather than failing silently', async () => {
    global.fetch = jest.fn(async (url, init) => (init && init.method === 'POST'
      ? { ok: false, status: 409, json: async () => ({ error: 'A personal space cannot be suspended.' }) }
      : {
        ok: true,
        status: 200,
        json: async () => ({ orgs: [TEAM], counts: { teams: 1, personal: 0, suspended: 0, pending: 0 } }),
      }));
    render(<PlatformOrgsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /suspend/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /reason/i }), { target: { value: 'Phishing links in a public set.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('A personal space cannot be suspended.');
  });
});

describe('Suspend asks first, with a reason (#40)', () => {
  const WHY = 'Phishing links in a public set.';
  const openDialog = async (posts) => {
    serve([TEAM], { onPost: (url, body) => posts.push({ url, body }) });
    render(<PlatformOrgsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /suspend/i }));
    return screen.getByRole('dialog', { name: `Suspend ${TEAM.name}?` });
  };

  // rejects: Suspend acting on one click
  it('the row\'s Suspend opens a dialog and sends nothing', async () => {
    const posts = [];
    const dialog = await openDialog(posts);
    // Says what it does today, and promises nothing stronger.
    expect(dialog).toHaveTextContent(/marks the organisation Suspended/);
    expect(dialog).toHaveTextContent(/members can still sign in and run sessions/);
    expect(posts).toHaveLength(0);
  });

  // rejects: a suspension with no reason, or one too short to say anything
  it('Suspend stays off until a reason of a few words is written', async () => {
    const posts = [];
    const dialog = await openDialog(posts);
    const go = within(dialog).getByRole('button', { name: 'Suspend' });
    const box = within(dialog).getByRole('textbox', { name: /reason/i });
    expect(go).toBeDisabled();
    fireEvent.change(box, { target: { value: '   spam   ' } });
    expect(go).toBeDisabled();
    fireEvent.change(box, { target: { value: WHY } });
    expect(go).toBeEnabled();
    expect(box).toHaveAttribute('maxLength', '600');
  });

  it('sends the reason with the status, then closes and says so', async () => {
    const posts = [];
    const dialog = await openDialog(posts);
    fireEvent.change(within(dialog).getByRole('textbox', { name: /reason/i }), { target: { value: `  ${WHY}\n` } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe(`https://api.test/platform/orgs/${TEAM.orgId}/status`);
    expect(posts[0].body).toEqual({ status: 'suspended', reason: WHY });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Northwind Learning is now suspended.');
  });

  // rejects: a dialog with no way out but the destructive button
  it('Cancel and the X close it with nothing sent', async () => {
    const posts = [];
    let dialog = await openDialog(posts);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts).toHaveLength(0);
  });

  it('Reinstate stays one click', async () => {
    const posts = [];
    serve([{ ...TEAM, status: 'suspended', suspendedReason: WHY }], { onPost: (url, body) => posts.push({ url, body }) });
    render(<PlatformOrgsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reinstate' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ status: 'active' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // rejects: staff seeing Suspended with no idea why
  it('a suspended row shows its reason, whole in the title', async () => {
    serve([{ ...TEAM, status: 'suspended', suspendedReason: WHY, suspendedAt: '2026-10-24T09:00:00.000Z' }]);
    render(<PlatformOrgsPanel />);
    const row = (await screen.findByText('Northwind Learning')).closest('tr');
    const why = within(row).getByText(/Phishing links/);
    expect(why).toHaveTextContent(`Suspended 24 Oct 2026: ${WHY}`);
    expect(why).toHaveAttribute('title', WHY);
  });
});

describe('sinceLabel', () => {
  // rejects: rendering "Invalid Date" for a row whose createdAt predates the
  // attribute — the ~41 rows that came before tenancy have no createdAt at all.
  it('is empty rather than wrong when there is no date', () => {
    expect(sinceLabel('')).toBe('');
    expect(sinceLabel('not-a-date')).toBe('');
    expect(sinceLabel('2026-02-01T00:00:00.000Z')).toBe('since Feb 2026');
  });
});
