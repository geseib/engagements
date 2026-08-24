/**
 * THE MEMBERS SCREEN — components/TeamPanel.jsx.
 *
 * Every test below names the implementation change it rejects. Where the answer
 * to "what would this reject?" was "nothing", the test is not here.
 *
 * WHY THIS RENDERS RATHER THAN READING SOURCE. TeamPanel talks to the API
 * through `authFetch` — a plain module, not a hook — and takes its identity from
 * the payload rather than from `useAuth`, so mocking that ONE module mounts the
 * whole screen. `AdminPage.jsx` cannot be mounted in jsdom at all (useAuth
 * hard-throws outside its provider), which is why the screen is a component and
 * not a branch of the page.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine: every width and offset
 * is zero and would pass unconditionally. The geometry contracts live in
 * teamPanelPalette.test.js, read out of the stylesheet as text.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TeamPanel from '../components/TeamPanel';
import { sentWords, initialsOf, roleLabel } from '../components/TeamPanel';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** The exact shape lambda-functions/admin/orgs/list-members.js returns. */
const ROSTER = {
  orgId: 'org_nw',
  yourRole: 'owner',
  memberCount: 3,
  outstandingInvites: 2,
  members: [
    {
      userId: 'sub-amara',
      email: 'amara.reyes@northwind.example',
      displayName: 'Amara Reyes',
      role: 'owner',
      joinedAt: '2026-02-04T09:00:00.000Z',
      isLastOwner: true,
      canDemote: false,
      canRemove: false,
      lockReason: 'the last owner',
      you: true,
    },
    {
      userId: 'sub-jonah',
      email: 'jonah.osei@northwind.example',
      displayName: 'Jonah Osei',
      role: 'admin',
      joinedAt: '2026-03-04T09:00:00.000Z',
      isLastOwner: false,
      canDemote: true,
      canRemove: true,
      lockReason: null,
      you: false,
    },
    {
      userId: 'sub-priya',
      email: 'priya.kaur@northwind.example',
      displayName: 'Priya Kaur',
      role: 'member',
      joinedAt: '2026-04-04T09:00:00.000Z',
      isLastOwner: false,
      canDemote: true,
      canRemove: true,
      lockReason: null,
      you: false,
    },
  ],
  invites: [
    {
      token: 'tok-dev',
      email: 'dev.mensah@northwind.example',
      role: 'member',
      invitedAt: daysAgo(3),
      expiresAt: new Date(Date.now() + 11 * DAY).toISOString(),
      expired: false,
      daysUntilExpiry: 11,
    },
    {
      token: 'tok-rosa',
      email: 'rosa.iglesias@contractor.example',
      role: 'member',
      invitedAt: daysAgo(11),
      expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
      expired: false,
      daysUntilExpiry: 3,
    },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Queue the GET, then whatever the test's write returns, then the re-read. */
function serve(roster = ROSTER) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') return jsonResponse(200, roster);
    return jsonResponse(200, {});
  });
}

const mount = (props = {}) =>
  render(<TeamPanel orgId="org_nw" orgName="Northwind Learning" {...props} />);

const rowFor = (text) => screen.getByText(text).closest('tr');

beforeEach(() => {
  authFetch.mockReset();
  serve();
});

/* ------------------------------------------------------------ the arithmetic */

describe('the expiry arithmetic, done for the reader', () => {
  // rejects: printing the send date alone. "11 days ago" prompts nobody; the
  // number that prompts somebody is the one counting down.
  test('a nearly-dead invitation carries its countdown', () => {
    expect(sentWords({ invitedAt: daysAgo(11), daysUntilExpiry: 3, expired: false }))
      .toEqual({ ago: '11 days ago', tail: 'expires in 3', dead: false });
  });

  // rejects: printing "expires in 13" beside every fresh invitation, which
  // makes the row with three days left look exactly like the others.
  test('a fresh invitation carries no countdown', () => {
    expect(sentWords({ invitedAt: daysAgo(3), daysUntilExpiry: 11, expired: false }).tail)
      .toBeNull();
  });

  // rejects: hiding the expired rows. They are the only rows an admin can
  // revoke, and DynamoDB's TTL sweep may take 48 hours to reach them.
  test('an expired invitation says so', () => {
    const said = sentWords({ invitedAt: daysAgo(20), daysUntilExpiry: 0, expired: true });
    expect(said.tail).toBe('expired');
    expect(said.dead).toBe(true);
  });

  // rejects: "UN" for an account with no name.
  test('an unnamed person gets an em dash, not initials of nothing', () => {
    expect(initialsOf({ displayName: 'Amara Reyes' })).toBe('AR');
    expect(initialsOf({ email: 'dev.mensah@northwind.example' })).toBe('DM');
    expect(initialsOf({})).toBe('—');
  });

  test('roles are named as the screen names them', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('member')).toBe('Member');
  });
});

/* ------------------------------------------------------------------ the lists */

describe('two lists, because they are two situations', () => {
  // rejects: merging invitations into the member table as greyed rows. The
  // verbs are different, so the tables are different.
  test('an invitation gets Resend/Revoke and a member gets Make/Remove', async () => {
    mount();
    const invite = await screen.findByText('rosa.iglesias@contractor.example');
    const inviteRow = invite.closest('tr');
    expect(within(inviteRow).getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(within(inviteRow).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(within(inviteRow).queryByRole('button', { name: /Make/ })).toBeNull();

    const memberRow = rowFor('Priya Kaur');
    expect(within(memberRow).getByRole('button', { name: 'Make admin' })).toBeInTheDocument();
    expect(within(memberRow).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(memberRow).queryByRole('button', { name: 'Resend' })).toBeNull();
  });

  // rejects: showing the countdown on the send date's own line but truncating
  // it away, or dropping it. The row must carry both halves.
  test('the invitation row prints both halves of the date', async () => {
    mount();
    const row = (await screen.findByText('rosa.iglesias@contractor.example')).closest('tr');
    expect(within(row).getByText(/11 days ago/)).toBeInTheDocument();
    expect(within(row).getByText('expires in 3')).toBeInTheDocument();
  });

  // rejects: a title= that does not carry the full string. A reduction with no
  // recovery is a deletion, and these cells ellipsize.
  test('every truncating cell carries the whole string in title=', async () => {
    mount();
    const email = await screen.findByText('rosa.iglesias@contractor.example');
    expect(email).toHaveAttribute('title', 'rosa.iglesias@contractor.example');
    expect(screen.getByText('Jonah Osei')).toHaveAttribute('title', 'Jonah Osei');
    expect(screen.getByText('jonah.osei@northwind.example'))
      .toHaveAttribute('title', 'jonah.osei@northwind.example');
  });
});

describe('the last owner', () => {
  // rejects: a disabled Remove/Make member on the last owner's row. A dead
  // button is a thing people click twice and then write in about; the row
  // states the reason instead.
  test('gets no button at all, and the reason in the row', async () => {
    mount();
    await screen.findByText('Amara Reyes');
    const row = rowFor('Amara Reyes');
    expect(within(row).queryAllByRole('button')).toEqual([]);
    expect(within(row).getByText(/the last owner/)).toBeInTheDocument();
    expect(within(row).getByText(/^You ·/)).toBeInTheDocument();
  });

  // rejects: deriving the rule in the browser. The server sends the flags and
  // re-checks them at the moment of the write; a second implementation is a
  // second thing to drift.
  test('an owner who is NOT the last one can be acted on', async () => {
    const roster = clone(ROSTER);
    roster.members[0].isLastOwner = false;
    roster.members[0].canDemote = true;
    roster.members[0].canRemove = true;
    roster.members[0].lockReason = null;
    serve(roster);
    mount();
    await screen.findByText('Amara Reyes');
    const row = rowFor('Amara Reyes');
    expect(within(row).getByRole('button', { name: 'Make member' })).toBeInTheDocument();
    // It is your own row, so the destructive verb is what it really does.
    expect(within(row).getByRole('button', { name: 'Leave' })).toBeInTheDocument();
  });
});

describe('who may act', () => {
  // rejects: drawing buttons the server is going to refuse. Only an owner may
  // change or remove another owner.
  test('an admin sees no controls on an owner row, and is told why', async () => {
    const roster = clone(ROSTER);
    roster.yourRole = 'admin';
    roster.members[0].isLastOwner = false;
    roster.members[0].canDemote = true;
    roster.members[0].canRemove = true;
    roster.members[0].lockReason = null;
    roster.members[0].you = false;
    serve(roster);
    mount();
    await screen.findByText('Amara Reyes');
    const row = rowFor('Amara Reyes');
    expect(within(row).queryAllByRole('button')).toEqual([]);
    expect(within(row).getByText(/Only an owner can change an owner/)).toBeInTheDocument();
    // …but a member row is still theirs to administer.
    expect(within(rowFor('Priya Kaur')).getByRole('button', { name: 'Make admin' }))
      .toBeInTheDocument();
  });

  // rejects: offering Invite to somebody whose request would be refused.
  test('a plain member gets no Invite button and no row actions', async () => {
    const roster = clone(ROSTER);
    roster.yourRole = 'member';
    serve(roster);
    mount();
    await screen.findByText('Priya Kaur');
    expect(screen.queryByRole('button', { name: /Invite someone/ })).toBeNull();
    expect(within(rowFor('Priya Kaur')).queryAllByRole('button')).toEqual([]);
    expect(within(rowFor('Jonah Osei')).getByText(/An admin can change this/))
      .toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- empty states */

describe('two empty states, because they are two situations', () => {
  // rejects: one sentence for both. "Nobody has been invited yet" and "no
  // invitation is outstanding" need different exits.
  test('a roster of one says nobody has been invited, and offers the first', async () => {
    const roster = clone(ROSTER);
    roster.invites = [];
    roster.members = [roster.members[0]];
    serve(roster);
    mount();
    expect(await screen.findByText('Nobody has been invited yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite the first person/ })).toBeInTheDocument();
    expect(screen.queryByText('No invitation is outstanding')).toBeNull();
  });

  test('a full roster with no invitations says exactly that instead', async () => {
    const roster = clone(ROSTER);
    roster.invites = [];
    serve(roster);
    mount();
    expect(await screen.findByText('No invitation is outstanding')).toBeInTheDocument();
    expect(screen.getByText(/3 people/)).toBeInTheDocument();
    expect(screen.queryByText('Nobody has been invited yet')).toBeNull();
  });
});

/* --------------------------------------------------------------------- writes */

describe('inviting somebody', () => {
  // rejects: a dialog that reports a success it did not get. The backend
  // returns the EXISTING invitation for an address that already has a live one
  // (created:false) rather than minting a second token.
  test('a duplicate address says the invitation was left alone, not "sent"', async () => {
    authFetch.mockImplementation(async (url, options = {}) => {
      if ((options.method || 'GET') === 'GET') return jsonResponse(200, ROSTER);
      return jsonResponse(200, { created: false, invite: ROSTER.invites[0] });
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Invite someone/ }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'dev.mensah@northwind.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText(/already has an invitation that has not expired/))
      .toBeInTheDocument();
    expect(screen.queryByText(/^Invited /)).toBeNull();
  });

  // rejects: a local guess in place of the server's sentence. The handlers'
  // messages are specific and a generic one throws that away.
  test('a refusal renders the server\'s own message', async () => {
    authFetch.mockImplementation(async (url, options = {}) => {
      if ((options.method || 'GET') === 'GET') return jsonResponse(200, ROSTER);
      return jsonResponse(409, { error: 'That person is already a member of this organisation.' });
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Invite someone/ }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'priya.kaur@northwind.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('That person is already a member of this organisation.'))
      .toBeInTheDocument();
    // …and the dialog is still open, so there is somewhere to correct it.
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  // rejects: owner appearing in the role picker. The backend refuses it, so a
  // typo'd address can never be handed the one role that cannot be removed.
  test('the role picker offers member and admin, never owner', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Invite someone/ }));
    const options = within(screen.getByLabelText('Role')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Member', 'Admin']);
  });

  // rejects: a dialog with only one way out, or an X that is not routed through
  // the same close as the footer. Commit 4fd425d6: an editor with an edit in
  // hand had no way out at all.
  test('the dialog has an X and a bottom exit, and both route through one close', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Invite someone/ }));
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Email address')).toBeNull());
  });

  // rejects: discarding a half-typed address without asking — and equally,
  // disabling Escape. It is GATED on unsaved work, and the asking is inline
  // rather than a second modal over the first.
  test('Escape with a half-typed address asks instead of discarding', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Invite someone/ }));
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'half@typed' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(await screen.findByText(/Discard this invitation\?/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText(/Discard this invitation\?/)).toBeNull();
  });

  test('Escape with nothing typed simply closes it', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Invite someone/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Email address')).toBeNull());
  });
});

describe('resending', () => {
  // rejects: minting a second token per press. One address, one live link, one
  // thing to revoke — a resend is the SAME POST, and the backend hands the
  // existing invitation back.
  test('a resend posts the same address and never mints a second invitation', async () => {
    const calls = [];
    authFetch.mockImplementation(async (url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if ((options.method || 'GET') === 'GET') return jsonResponse(200, ROSTER);
      return jsonResponse(200, { created: false, invite: ROSTER.invites[1] });
    });
    mount();
    const row = (await screen.findByText('rosa.iglesias@contractor.example')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Resend' }));

    await waitFor(() => expect(screen.getByText(/mailed again/)).toBeInTheDocument());
    const post = calls.find(([, method]) => method === 'POST');
    expect(post[0]).toMatch(/orgs\/org_nw\/invites$/);
    expect(screen.getByText(/same link, with the same expiry/)).toBeInTheDocument();
  });
});

describe('the destructive dialogs', () => {
  // rejects: a dialog that shouts about severity instead of saying what
  // happens, and one with no reversible neighbour offered.
  test('revoking states the consequence and offers the resend instead', async () => {
    mount();
    const row = (await screen.findByText('rosa.iglesias@contractor.example')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByText(/The link stops working/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody is removed and nothing is lost/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mail the same link again instead/ }))
      .toBeInTheDocument();
  });

  test('removing an admin states the consequence and offers the demotion instead', async () => {
    mount();
    await screen.findByText('Jonah Osei');
    fireEvent.click(within(rowFor('Jonah Osei')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(/lose access to this organisation/)).toBeInTheDocument();
    expect(screen.getByText(/their Engage account is untouched/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /make them a member instead/ }))
      .toBeInTheDocument();
  });

  // rejects: offering "make them a member instead" to somebody who already is
  // one. A neighbour that changes nothing is noise in the one dialog that must
  // be read.
  test('removing a plain member offers no demotion, because there is none', async () => {
    mount();
    await screen.findByText('Priya Kaur');
    fireEvent.click(within(rowFor('Priya Kaur')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(/lose access to this organisation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make them a member instead/ })).toBeNull();
  });

  // rejects: closing the dialog before the request lands. A failed write that
  // looks pixel-for-pixel identical to a successful one is the defect
  // QuestionSetDeleteDialog was written for.
  test('a failed revoke keeps the dialog open and prints the server\'s message', async () => {
    authFetch.mockImplementation(async (url, options = {}) => {
      if ((options.method || 'GET') === 'GET') return jsonResponse(200, ROSTER);
      return jsonResponse(404, { error: 'That invitation is already gone. Refresh the list.' });
    });
    mount();
    const row = (await screen.findByText('rosa.iglesias@contractor.example')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke it' }));

    expect(await screen.findByText('That invitation is already gone. Refresh the list.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  // rejects: a success that closes on its own. The outcome is acknowledged, and
  // the list is re-read afterwards rather than rewritten optimistically.
  test('a successful revoke is acknowledged, then the roster is re-read', async () => {
    const calls = [];
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET';
      calls.push(method);
      if (method === 'GET') return jsonResponse(200, ROSTER);
      return jsonResponse(200, { revoked: true });
    });
    mount();
    const row = (await screen.findByText('rosa.iglesias@contractor.example')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke it' }));

    const done = await screen.findByRole('button', { name: 'Done' });
    expect(screen.getByText(/no longer works/)).toBeInTheDocument();
    expect(calls.filter((m) => m === 'GET')).toHaveLength(1);   // not yet
    fireEvent.click(done);
    await waitFor(() => expect(calls.filter((m) => m === 'GET')).toHaveLength(2));
  });
});

describe('the screen as a whole', () => {
  // rejects: a load failure that renders as an empty roster. An empty state
  // that lies is worse than an error.
  test('a failed load renders the server\'s message, not an empty team', async () => {
    authFetch.mockResolvedValue(jsonResponse(403, { error: 'You are not a member of this organisation.' }));
    mount();
    expect(await screen.findByText('You are not a member of this organisation.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/^Members ·/)).toBeNull();
  });

  // rejects: a nav badge and a table that disagree, by making the count come
  // from the same read that drew the rows.
  test('the roster count is handed to the caller on every read', async () => {
    const onRosterChange = jest.fn();
    mount({ onRosterChange });
    await screen.findByText('Amara Reyes');
    expect(onRosterChange).toHaveBeenCalledWith({ memberCount: 3, outstandingInvites: 2 });
  });

  // rejects: `load` depending on the caller's callback. An inline arrow from
  // the page is a new function every render, so the effect would re-fetch the
  // roster forever — an infinite request loop against a live API.
  test('an inline callback does not make the screen re-fetch forever', async () => {
    const { rerender } = render(
      <TeamPanel orgId="org_nw" orgName="Northwind Learning" onRosterChange={() => {}} />
    );
    await screen.findByText('Amara Reyes');
    rerender(
      <TeamPanel orgId="org_nw" orgName="Northwind Learning" onRosterChange={() => {}} />
    );
    await screen.findByText('Amara Reyes');
    const gets = authFetch.mock.calls.filter(([, options]) => !options || !options.method);
    expect(gets).toHaveLength(1);
  });

  // rejects: stating the same fact twice, and equally, dropping the one line
  // that stops the support thread about org roles versus Engage approval.
  test('the standing note about Engage accounts is on the screen', async () => {
    mount();
    expect(await screen.findByText(/not the same thing as an Engage account/))
      .toBeInTheDocument();
  });
});
