/**
 * ACCEPTING AN INVITATION BY SIGNING IN.
 *
 * The invitation journey had no end: a row was written, no email was ever sent,
 * the token was returned by the API and never shown to anybody, and
 * `POST /invites/{token}/accept` — complete and correct — had no caller and had
 * never once been invoked on any tier.
 *
 * The owner's fix removes the delivery problem rather than solving it: sign in
 * with the address you were invited at and press the button. This component is
 * that button.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PendingInvites from '../components/PendingInvites';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const INVITE = {
  token: 'org_9xK4Fq7Pz2mNbVc8dQwLxR.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR',
  orgName: 'Northwind Learning',
  role: 'member',
  invitedByEmail: 'dai@northwind.example',
  daysUntilExpiry: 9,
};

function serve(invites, { onPost } = {}) {
  global.fetch = jest.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      if (onPost) onPost(String(url));
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ invites }) };
  });
}

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

describe('the prompt', () => {
  // rejects: a permanently present, permanently empty card. Almost nobody has
  // an invitation almost all of the time, and a box you always skip is the
  // wrong thing for the one moment it matters.
  it('draws nothing at all when there is nothing waiting', async () => {
    serve([]);
    const { container } = render(<PendingInvites />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('.pinv')).toBeNull();
  });

  // rejects: a prompt that does not say who is asking. The org name is
  // denormalised onto the invitation row precisely so this can be shown without
  // reading a partition the invitee is not a member of.
  it('names the organisation, the role and the time left', async () => {
    serve([INVITE]);
    render(<PendingInvites />);
    expect(await screen.findByText('Northwind Learning')).toBeInTheDocument();
    expect(screen.getByText(/invited you to join as a host/)).toBeInTheDocument();
    expect(screen.getByText(/9 days left/)).toBeInTheDocument();
  });

  it('calls a team admin invitation what it is', async () => {
    serve([{ ...INVITE, role: 'admin' }]);
    render(<PendingInvites />);
    expect(await screen.findByText(/join as a team admin/)).toBeInTheDocument();
  });
});

describe('accepting', () => {
  // rejects: THE WHOLE GAP. This endpoint existed, was correct, and had never
  // been called by anything.
  it('posts to the accept route for that invitation', async () => {
    const posts = [];
    serve([INVITE], { onPost: (url) => posts.push(url) });
    const onAccepted = jest.fn();
    render(<PendingInvites onAccepted={onAccepted} />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toBe(`https://api.test/invites/${encodeURIComponent(INVITE.token)}/accept`);
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });

  // rejects: swallowing a refusal. A button that silently does nothing reads
  // as a broken product. (A refusal with nothing to retry — 403, 404, 410 —
  // swaps Accept for OK; see 'the notice, as the owner ruled it'.)
  it('shows what the server said when it refuses', async () => {
    global.fetch = jest.fn(async (url, init) => (init && init.method === 'POST'
      ? { ok: false, status: 409, json: async () => ({ error: 'That invitation was just used. Refresh and try again.' }) }
      : { ok: true, status: 200, json: async () => ({ invites: [INVITE] }) }));
    render(<PendingInvites onAccepted={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('That invitation was just used. Refresh and try again.');
    // and it lets them try again rather than staying stuck
    expect(screen.getByRole('button', { name: /accept/i })).not.toBeDisabled();
  });
});

describe('when the lookup fails', () => {
  /*
    SILENT ON PURPOSE. This sits above somebody's own work on the screen they
    use to run sessions. An error banner there, for a feature they may never
    use, is worse than the missing prompt — and the next page load retries.
  */
  // rejects: an error banner on the landing screen of every host whenever this
  // one request has a bad day.
  it('renders nothing rather than an error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network'); });
    const { container } = render(<PendingInvites />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('.pinv')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is also silent on a non-ok response', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { container } = render(<PendingInvites />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('.pinv')).toBeNull();
  });
});

/*
  THE NOTICE THAT IS NOT LOST (owner, 2026-10-10: docs/design/pending-invite-notice).
  Blue, never orange; Accept only (no Decline); "1 day left"; a bar shape for the
  Build Room Host screen; a line that says what Accept does on the waiting
  screens; the joined line where the page does not reload; gone at expiry;
  read again when the person comes back to the tab.
*/
describe('the notice, as the owner ruled it', () => {
  // rejects: "1 days left" on the last day (daysUntilExpiry rounds up).
  it('says "1 day left", not "1 days left"', async () => {
    serve([{ ...INVITE, daysUntilExpiry: 1 }]);
    render(<PendingInvites />);
    expect(await screen.findByText(/· 1 day left/)).toBeInTheDocument();
    expect(screen.queryByText(/1 days left/)).toBeNull();
  });

  it('says "expires today" on day 0', async () => {
    serve([{ ...INVITE, daysUntilExpiry: 0 }]);
    render(<PendingInvites />);
    expect(await screen.findByText(/expires today/)).toBeInTheDocument();
  });

  // rejects: a Decline button (owner: Accept only; there is no decline route).
  it('offers Accept and nothing else', async () => {
    serve([INVITE]);
    render(<PendingInvites />);
    await screen.findByText('Northwind Learning');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Accept']);
  });

  it('draws the bar shape when asked', async () => {
    serve([INVITE]);
    const { container } = render(<PendingInvites variant="bar" />);
    await screen.findByText('Northwind Learning');
    expect(container.querySelector('.pinv.pinv--bar')).not.toBeNull();
  });

  it('carries the line that says what Accept does', async () => {
    serve([INVITE]);
    render(<PendingInvites note="Accepting adds you to the team. Hosting still needs approval." />);
    expect(await screen.findByText('Accepting adds you to the team. Hosting still needs approval.')).toBeInTheDocument();
  });

  // rejects: a reload on a page that should keep its place (Build Room, waiting screen).
  it('stays: says who you joined, then draws nothing', async () => {
    jest.useFakeTimers();
    try {
      serve([INVITE]);
      const { container } = render(<PendingInvites stay />);
      fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
      expect(await screen.findByRole('status')).toHaveTextContent('You joined Northwind Learning.');
      expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
      act(() => { jest.advanceTimersByTime(6000); });
      expect(container.querySelector('.pinv')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  // rejects: an Accept that can never work, left on screen.
  it('a 410 drops Accept for OK, and OK clears the row', async () => {
    global.fetch = jest.fn(async (url, init) => (init && init.method === 'POST'
      ? { ok: false, status: 410, json: async () => ({ error: 'That invitation has expired. Ask for a new one.' }) }
      : { ok: true, status: 200, json: async () => ({ invites: [INVITE] }) }));
    const { container } = render(<PendingInvites stay />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That invitation has expired. Ask for a new one.');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(container.querySelector('.pinv')).toBeNull();
  });

  // rejects: a server's internal error text on the screen.
  it('a 500 says it plainly and keeps Accept', async () => {
    global.fetch = jest.fn(async (url, init) => (init && init.method === 'POST'
      ? { ok: false, status: 500, json: async () => ({ error: 'Could not accept that invitation: ValidationException blah' }) }
      : { ok: true, status: 200, json: async () => ({ invites: [INVITE] }) }));
    render(<PendingInvites stay />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Could not accept that invitation\.$/);
    expect(screen.getByRole('button', { name: 'Accept' })).not.toBeDisabled();
  });

  it('draws nothing for an invitation past its expiry time', async () => {
    serve([
      { ...INVITE, token: 'org_x.old', orgName: 'Halcyon', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { ...INVITE, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    ]);
    render(<PendingInvites />);
    expect(await screen.findByText('Northwind Learning')).toBeInTheDocument();
    expect(screen.queryByText('Halcyon')).toBeNull();
  });

  // rejects: a room open for hours that never hears of a new invitation.
  it('reads the list again when the person comes back to the tab', async () => {
    serve([]);
    render(<PendingInvites />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    serve([INVITE]);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('Northwind Learning')).toBeInTheDocument();
  });
});
