/**
 * "AWAY" IS LIVE, AND SAID IN THE ROW (dev QA 5 Nov 2026).
 *
 * // rejects: dev QA 5 Nov — a player whose tab closed showed as away in the
 * // room tile only after a console reload; the live tile kept "Waiting on
 * // Ben, Cy", and the People rail marked them only with a grey dot.
 *
 *   - the presence frame (websocket/presence.js `presenceChanged`) changes
 *     that person's row in the same render: applyPresence, read by the room
 *     tile (roomProgressFor / waitingWords) and the rail (consoleRail);
 *   - the host page listens for it and lets go of it on unmount;
 *   - the rail row says "away", muted, where the … would be; a person who
 *     has already acted keeps their ✓.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { roomProgressFor, liveStepOf, waitingWords, applyPresence } from '../config/roomProgress';
import { consolePeopleFor } from '../config/consoleRail';
import PersonRow from '../components/people/PersonRow';

const roster = () => [
  { name: 'Ann', joinedAt: '2026-11-05T10:00:00Z', deviceConnected: true },
  { name: 'Ben', joinedAt: '2026-11-05T10:00:00Z', deviceConnected: true },
  { name: 'Cy', joinedAt: '2026-11-05T10:00:00Z', deviceConnected: true },
];
const tile = (players) => waitingWords(liveStepOf(roomProgressFor({
  moment: 'ANSWERING', roster: players, answer: { names: ['Ann'], count: 1 },
}))).text;

describe('the presence frame moves the room tile at once', () => {
  test('Ben closes his tab: "Waiting on Ben, Cy" becomes "Waiting on Cy · away: Ben"', () => {
    const before = roster();
    expect(tile(before)).toBe('Waiting on Ben, Cy');
    const after = applyPresence(before, 'Ben', false);
    expect(tile(after)).toBe('Waiting on Cy · away: Ben');
  });

  test('and back when his page opens again', () => {
    const away = applyPresence(roster(), 'Ben', false);
    expect(tile(applyPresence(away, 'Ben', true))).toBe('Waiting on Ben, Cy');
  });

  test('a name not in the room, or no change, is the same array (no re-render)', () => {
    const r = roster();
    expect(applyPresence(r, 'Zed', false)).toBe(r);
    expect(applyPresence(r, 'Ben', true)).toBe(r);
  });

  test('the rail reads the same row: Ben is marked away, Ann and Cy are not', () => {
    const players = applyPresence(roster(), 'Ben', false);
    const rows = consolePeopleFor({
      moment: 'ANSWERING', players, answeredNames: ['Ann'], answeredCount: 1, gameType: 'call-and-answer',
    });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Ben.away).toBe(true);
    expect(byName.Cy.away).toBeUndefined();
    expect(byName.Ann.away).toBeUndefined();
  });
});

describe('the host page listens for it', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const build = fs.readFileSync(path.join(__dirname, '..', 'buildroom', 'BuildRoomPage.jsx'), 'utf8');
  test('presenceChanged applies the frame to the roster, then reads the roster again', () => {
    const at = page.indexOf("webSocketClient.onMessage('presenceChanged'");
    expect(at).toBeGreaterThan(-1);
    const block = page.slice(at, page.indexOf('});', at));
    expect(block).toMatch(/setPlayers\(\(prev\) => applyPresence\(prev, name, data\.connected\)\)/);
    expect(block).toMatch(/fetchPlayers\(/);
    expect(page).toMatch(/offMessage\('presenceChanged'\)/);
  });
  test('the Build Room reads its roster again too', () => {
    expect(build).toMatch(/onMessage\('presenceChanged'/);
    expect(build).toMatch(/offMessage\('presenceChanged'\)/);
  });
});

describe('the rail row says away', () => {
  const row = (props) => render(<ul><PersonRow density="rail" name="Ben" {...props} /></ul>);

  test('still out and away: the word "away", not the …', () => {
    row({ status: 'away', mark: 'wait', doing: 'still writing' });
    const doing = screen.getByTestId('person-doing');
    expect(doing).toHaveTextContent('away');
    expect(doing).toHaveClass('is-away');
    expect(doing).toHaveAttribute('title', 'away · still writing');
    expect(screen.getByRole('listitem')).toHaveClass('is-away-word');
  });

  test('in the lobby, away with no mark: "away"', () => {
    row({ status: 'away', mark: null });
    expect(screen.getByTestId('person-doing')).toHaveTextContent('away');
  });

  test('already answered and then away: the ✓ stays (the room is not waiting on them)', () => {
    row({ status: 'away', mark: 'done', doing: 'answered' });
    expect(screen.getByTestId('person-doing')).toHaveTextContent('✓');
    expect(screen.getByRole('listitem')).not.toHaveClass('is-away-word');
  });

  test('here: no word', () => {
    row({ status: 'here', mark: 'wait', doing: 'still writing' });
    expect(screen.getByTestId('person-doing')).toHaveTextContent('…');
  });

  test('the word is muted at the label size, in a slot the fact and ⋯ columns still line up with', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'people', 'PersonRow.css'), 'utf8');
    expect(css).toMatch(/\.prow\.prow--rail \.prow-doing\.is-away \{[^}]*color: var\(--muted\)[^}]*font-size: var\(--prow-t-label\)/);
    expect(css).toMatch(/\.prow\.prow--rail\.is-away-word \{\s*grid-template-columns: 8px minmax\(0, 1fr\) 40px 48px 28px;/);
  });
});
