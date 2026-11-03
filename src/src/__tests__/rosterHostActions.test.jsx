/**
 * THE HOST'S TWO DECISIONS ABOUT A PERSON, IN THE PLAYERS TAB.
 *
 *   hand the name over   somebody is locked out of a name that is theirs, and
 *                        the host is the only party who can tell that from two
 *                        people who picked the same name. Owner: *"the host can
 *                        use the session players tab to unlock for 1 exchange
 *                        of players for that name … they need the choice though
 *                        because they may have just mistakenly picked the same
 *                        name."*
 *   remove them          they left. Take them out of the counts and out of
 *                        nothing else: *"this should not eliminate any
 *                        contribution they had made or points they had
 *                        accumulated before leaving."*
 *
 * `GameHostPage` cannot be mounted in jsdom (AuthProvider + a live socket), so
 * the panel is rendered directly and the page's own wiring is asserted against
 * its source in `setupPanelCallSite.test.js`. The projection under the panel is
 * pure and is asserted without a DOM at all.
 *
 * NO GEOMETRY. jsdom resolves no layout, so "the buttons are reachable" is a
 * browser check; what is testable here is document order, accessible names and
 * `disabled`. The rows are components/people/PersonRow, whose stylesheet
 * contract is pinned by its own tests.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

// Imported AFTER jest.mock above, which jest hoists — the order is required,
// not accidental, exactly as sessionSetupPanel.test.jsx notes.

import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { rosterRows, departedRows } from '../config/setupPanel';

const players = [
  { name: 'Ada', score: 3 },
  { name: 'Grace', score: 9 },
];

const renderPanel = (props = {}) => render(
  <SessionSetupPanel players={players} gameId="4821" initialTab="people" {...props} />
);

/** The roster row whose NAME cell reads `name` — not any row mentioning it. */
const rowFor = (name) => {
  const row = screen.getAllByTestId('roster-row').find(
    (candidate) => within(candidate).getByTestId('roster-name').textContent === name
  );
  if (!row) throw new Error(`no roster row for ${name}`);
  return row;
};

describe('the roster projection carries the two decisions', () => {
  it('reports whether a name is being asked for, or already unlocked', () => {
    const rows = rosterRows({
      players: [
        { name: 'Ada', score: 3, handover: { requested: true, open: false } },
        { name: 'Grace', score: 9, handover: { requested: true, open: true } },
        { name: 'Alan', score: 1 },
      ],
    });
    const by = (name) => rows.find((r) => r.name === name);

    expect(by('Ada').handoverRequested).toBe(true);
    expect(by('Ada').handoverOpen).toBe(false);
    expect(by('Grace').handoverOpen).toBe(true);
    // A roster from a backend that predates the feature has no `handover` key
    // at all. Reading undefined would render "asking" as a permanent blank.
    expect(by('Alan').handoverRequested).toBe(false);
    expect(by('Alan').handoverOpen).toBe(false);
  });

  it('never carries a client id, because that endpoint is public', () => {
    // get-players.js has no authorizer, and a clientId is the secret
    // get-answers.js accepts as proof of identity. The server publishes
    // booleans; this asserts the client does not reintroduce the field by
    // spreading the row.
    const rows = rosterRows({
      players: [{ name: 'Ada', score: 3, handover: { requested: true, open: true } }],
    });
    expect(JSON.stringify(rows)).not.toMatch(/clientId|requestedBy/i);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['done', 'handoverOpen', 'handoverRequested', 'name', 'rank', 'score']
    );
  });

  it('keeps the departed in their own list, with their points', () => {
    const rows = departedRows([
      { playerName: 'Tomás', totalScore: 5, removedAt: '2026-08-15T10:00:00.000Z' },
      { playerName: 'Ada', totalScore: 0, removedAt: '2026-08-15T10:05:00.000Z' },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Ada', 'Tomás']);
    // Showing them at zero would read as "removing someone wipes their score",
    // which is precisely the thing the design promises it does not do.
    expect(rows.find((r) => r.name === 'Tomás').score).toBe(5);
    expect(rows.find((r) => r.name === 'Tomás').removedAt).toBeTruthy();
    // No rank: ranking is a statement about a contest these people are not in.
    expect(rows[0].rank).toBeUndefined();
  });
});

/*
  THE PEOPLE SECTION (docs/design/session-menu; owner, 3 Nov 2026: "yes, add
  People"): the rail's person row (components/people/PersonRow.jsx), with
  everything the old Players list offered. The words moved with the row:
  "Asking to take this name" is "wants their name on a new device" (PLAN
  §3.6), Unlock name is ⋯ Move to a new device, Lock again is ⋯ Lock name.
*/
const prowFor = (name) => {
  const row = [...document.querySelectorAll('li.prow')].find((r) => r.querySelector('.prow-name').textContent === name);
  if (!row) throw new Error(`no person row for ${name}`);
  return row;
};
const menuOf = (name) => {
  fireEvent.click(within(prowFor(name)).getByRole('button', { name: `More for ${name}` }));
  return within(prowFor(name));
};

describe('the People section offers the handover', () => {
  it('says which name is being asked for, in words rather than a colour', () => {
    renderPanel({
      players: [
        { name: 'Ada', score: 3, handover: { requested: true, open: false } },
        { name: 'Grace', score: 9 },
      ],
    });
    // Read on a projector by hosts who cannot rely on hue: the state is printed.
    const asking = screen.getAllByTestId('person-asking');
    expect(asking).toHaveLength(1);
    expect(asking[0].textContent).toMatch(/wants their name on a new device/i);
    expect(asking[0]).toBe(prowFor('Ada'));
  });

  it('binds the grant to the asker when somebody asked, and leaves it open when nobody did', () => {
    const onGrantHandover = jest.fn();
    renderPanel({
      players: [
        { name: 'Ada', score: 3, handover: { requested: true, open: false } },
        { name: 'Grace', score: 9 },
      ],
      onGrantHandover,
    });

    // ASKED: only the person who asked can spend it.
    fireEvent.click(within(prowFor('Ada')).getByRole('button', { name: /let them: ada/i }));
    expect(onGrantHandover).toHaveBeenLastCalledWith('Ada', true);

    // NOT ASKED: the host acting on something said out loud.
    fireEvent.click(menuOf('Grace').getByRole('menuitem', { name: 'Move to a new device' }));
    expect(onGrantHandover).toHaveBeenLastCalledWith('Grace', false);
  });

  it('says a name is open once it is, and offers Lock name instead of Move', () => {
    const onLockHandover = jest.fn();
    const future = Math.floor(Date.now() / 1000) + 600;
    renderPanel({ players: [{ name: 'Ada', score: 3, handover: { requested: true, open: true, expiresAt: future } }], onLockHandover });
    // One statement, not two: the open name is not also flagged as asking.
    expect(screen.queryAllByTestId('person-asking')).toHaveLength(0);
    expect(prowFor('Ada').querySelector('.prow-doing').textContent).toBe('name open');
    const menu = menuOf('Ada');
    expect(menu.queryByRole('menuitem', { name: 'Move to a new device' })).toBeNull();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Lock name' }));
    expect(onLockHandover).toHaveBeenCalledWith('Ada');
  });
});

describe('the People section offers the removal', () => {
  it('removes by name, pressed twice in place', () => {
    const onRemovePlayer = jest.fn();
    renderPanel({ onRemovePlayer });
    fireEvent.click(menuOf('Ada').getByRole('menuitem', { name: 'Remove from session' }));
    expect(onRemovePlayer).not.toHaveBeenCalled();
    fireEvent.click(within(prowFor('Ada')).getByRole('menuitem', { name: 'Press again to remove' }));
    expect(onRemovePlayer).toHaveBeenCalledWith('Ada');
  });

  it('shows who was removed, with their points, and offers the way back', () => {
    const onRestorePlayer = jest.fn();
    renderPanel({
      removedPlayers: [{ playerName: 'Tomás', totalScore: 5, removedAt: '2026-08-15T10:00:00.000Z' }],
      onRestorePlayer,
    });

    // A row you cannot see is a row you cannot undo.
    const left = screen.getByTestId('people-left');
    expect(within(left).getByText('Tomás')).toBeInTheDocument();
    expect(within(left).getByText('5 pts')).toBeInTheDocument();
    fireEvent.click(menuOf('Tomás').getByRole('menuitem', { name: /bring back/i }));
    expect(onRestorePlayer).toHaveBeenCalledWith('Tomás');
  });

  it('does not count the departed as players', () => {
    renderPanel({ removedPlayers: [{ playerName: 'Tomás', totalScore: 5 }] });
    // The count is "how many are in the room": the departed are counted apart.
    expect(screen.getByTestId('people-count')).toHaveTextContent('2 people · 1 left');
    expect(within(screen.getByTestId('people-list')).getAllByRole('listitem')).toHaveLength(3);
    expect(within(screen.getByRole('list', { name: 'Everyone in the session' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('says nothing about the departed when nobody has left', () => {
    renderPanel();
    // Never an empty state that lies.
    expect(screen.queryByTestId('people-left')).toBeNull();
  });

  it('states that the removal is soft, where the host makes the decision', () => {
    renderPanel({ removedPlayers: [{ playerName: 'Tomás', totalScore: 5 }] });
    expect(
      screen.getByText(/answers, votes and points stay in the session report/i)
    ).toBeInTheDocument();
  });
});
