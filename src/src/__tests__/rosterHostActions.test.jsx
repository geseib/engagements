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
 * browser check; what is testable here is document order, accessible names,
 * `disabled`, and the CSS contract read as text — which is what the last
 * section does, because hard rule 9 (a row's actions must not be pushed off the
 * unreachable end of a clipped cell) is a stylesheet claim.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
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
  <SessionSetupPanel players={players} gameId="4821" {...props} />
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

describe('the Players tab offers the handover', () => {
  it('says which name is being asked for, in words rather than a colour', () => {
    renderPanel({
      players: [
        { name: 'Ada', score: 3, handover: { requested: true, open: false } },
        { name: 'Grace', score: 9 },
      ],
    });
    // This panel is read on a projector with a lifted black point and by hosts
    // who cannot rely on hue, so the state is printed.
    const flags = screen.getAllByTestId('handover-flag');
    expect(flags).toHaveLength(1);
    expect(flags[0].textContent).toMatch(/asking to take this name/i);
    expect(rowFor('Ada').contains(flags[0])).toBe(true);
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

    // ASKED: only the person who asked can spend it, so a third party typing
    // the same name at the same moment cannot steal it.
    fireEvent.click(within(rowFor('Ada')).getByRole('button', { name: /let them take it/i }));
    expect(onGrantHandover).toHaveBeenLastCalledWith('Ada', true);

    // NOT ASKED: the host acting on something said out loud — the owner's
    // second entry point, and the commoner one in a real room.
    fireEvent.click(within(rowFor('Grace')).getByRole('button', { name: /unlock name/i }));
    expect(onGrantHandover).toHaveBeenLastCalledWith('Grace', false);
  });

  it('says a name is unlocked once it is, so the host is not left guessing', () => {
    renderPanel({ players: [{ name: 'Ada', score: 3, handover: { requested: true, open: true } }] });
    const flags = screen.getAllByTestId('handover-flag');
    // One statement, not two: "asking" is superseded by "unlocked" rather than
    // stacked beside it (RATIONALE §4 — never state one fact twice).
    expect(flags).toHaveLength(1);
    expect(flags[0].textContent).toMatch(/unlocked for one handover/i);
  });
});

describe('the Players tab offers the removal', () => {
  it('removes by name, and says in the tooltip what removal does not do', () => {
    const onRemovePlayer = jest.fn();
    renderPanel({ onRemovePlayer });

    const button = within(rowFor('Ada')).getByRole('button', { name: /^remove$/i });
    fireEvent.click(button);
    expect(onRemovePlayer).toHaveBeenCalledWith('Ada');
    // Destructive-looking controls state the consequence, not the severity.
    expect(button.getAttribute('title')).toMatch(/answers and points stay in the report/i);
  });

  it('shows who was removed, and offers the way back', () => {
    const onRestorePlayer = jest.fn();
    renderPanel({
      removedPlayers: [{ playerName: 'Tomás', totalScore: 5, removedAt: '2026-08-15T10:00:00.000Z' }],
      onRestorePlayer,
    });

    // A row you cannot see is a row you cannot undo.
    const departed = screen.getAllByTestId('departed-row');
    expect(departed).toHaveLength(1);
    expect(within(departed[0]).getByTestId('departed-name')).toHaveTextContent('Tomás');
    expect(within(departed[0]).getByText('5 pts')).toBeInTheDocument();

    fireEvent.click(within(departed[0]).getByRole('button', { name: /bring back/i }));
    expect(onRestorePlayer).toHaveBeenCalledWith('Tomás');
  });

  it('does not count the departed as players', () => {
    renderPanel({
      removedPlayers: [{ playerName: 'Tomás', totalScore: 5 }],
    });
    // The heading is the host's "how many are in the room". The server already
    // keeps the departed out of `players`; this asserts the panel does not
    // quietly add them back for display.
    expect(screen.getByText('2 players')).toBeInTheDocument();
    expect(screen.getByTestId('departed-heading')).toHaveTextContent('1 removed from the room');
    expect(screen.getAllByTestId('roster-row')).toHaveLength(2);
  });

  it('says nothing about the departed when nobody has left', () => {
    renderPanel();
    // Never an empty state that lies. "Nobody has been removed" is a heading
    // about a thing that has not happened.
    expect(screen.queryByTestId('departed-heading')).toBeNull();
    expect(screen.queryAllByTestId('departed-row')).toEqual([]);
  });

  it('states that the removal is soft, where the host makes the decision', () => {
    renderPanel({ removedPlayers: [{ playerName: 'Tomás', totalScore: 5 }] });
    expect(
      screen.getByText(/answers, votes and points stay in the session report/i)
    ).toBeInTheDocument();
  });
});

describe('the row actions are declared reachable', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const block = (selector) => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('pushes the action group with margin, never with flex-end', () => {
    // Hard rule 9. `justify-content: flex-end` inside a clipped cell overflows
    // towards the START of the line, which is the end nobody can scroll to —
    // the failure `rowActionsReachable.test.js` was written for.
    const acts = block('.setup-roster__acts');
    expect(acts).toMatch(/margin-left:\s*auto/);
    expect(acts).not.toMatch(/justify-content:\s*flex-end/);
    // A long name plus two buttons wraps rather than shearing.
    expect(acts).toMatch(/flex-wrap:\s*wrap/);
  });

  it('lets the name column shrink so the buttons keep their width', () => {
    const row = block('.setup-roster__row');
    expect(row).toMatch(/minmax\(0,\s*1fr\)/);
  });

  it('keeps the row action at the 12px floor, never below it', () => {
    // RATIONALE §3: nothing on a laptop surface goes below 12px.
    const sizes = [...block('.setup-roster__act').matchAll(/font-size:\s*(\d+)px/g)]
      .map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
  });

  it('marks the departed with more than opacity', () => {
    // Opacity alone reads as "loading" on a projector, so the name is struck
    // through as well — two signals for one state.
    const gone = block('.setup-roster__row--gone');
    expect(gone).toMatch(/opacity/);
    expect(css).toMatch(/\.setup-roster__row--gone \.setup-roster__name \{[^}]*line-through/);
  });

  it('declares the row action rather than overriding the panel button rule', () => {
    // The panel paints every button it contains unless the selector excludes
    // it. A `.setup-roster__act` outside that exclusion would lose on
    // specificity and silently render at the full 8px/12px button size.
    expect(css).toMatch(/\.setup-panel button:not\([^{]*\.setup-roster__act\)/);
  });

  it('paints the new pieces from tokens, not from new hexes', () => {
    expect(block('.setup-roster__flag')).toMatch(/var\(--primary\)/);
    // `--danger` never carries text — it is under AA on both panel surfaces.
    expect(block('.setup-roster__flag')).not.toMatch(/color:\s*var\(--danger\)/);
    expect(block('.setup-roster__act')).not.toMatch(/color:\s*var\(--danger\)/);
  });
});
