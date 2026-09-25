/**
 * THE SCOREBOARD FROM THE HOST'S PHONE — components/RemoteScoreboardPanel.jsx,
 * config/hostRemote.js's scoreboardControl, and HostRemote.jsx read as source.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §3: the remote gets a
 * "Scoreboard" control — open or close, next page, and the style picker —
 * disabled with "Scores appear after the first round" before any round is
 * scored, and absent for other game types.
 *
 * The phone holds no socket and polls, so what it knows comes from two polls
 * it already makes: `/state` (the server's board) and `/players` (the last
 * scored round). The panel is presentational and takes every action as a prop.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import RemoteScoreboardPanel from '../components/RemoteScoreboardPanel';
import { scoreboardControl } from '../config/hostRemote';

describe('scoreboardControl — what the phone offers', () => {
  test('no control at all for a Poll, Wavelength or Survey', () => {
    for (const gameType of ['poll', 'wavelength', 'survey']) {
      expect(scoreboardControl({ snapshot: { gameType }, roster: { afterRound: 3 } }).show).toBe(false);
    }
  });

  test('before any round is scored: shown, disabled, with the reason', () => {
    const c = scoreboardControl({ snapshot: { gameType: 'trivia' }, roster: { afterRound: null } });
    expect(c).toMatchObject({ show: true, enabled: false, reason: 'Scores appear after the first round' });
  });

  test('a roster that has not loaded yet is "not yet", not "never"', () => {
    const c = scoreboardControl({ snapshot: { gameType: 'trivia' }, roster: null });
    expect(c).toMatchObject({ show: true, enabled: false });
  });

  test('once a round is scored: enabled, and the board is the server\'s', () => {
    const c = scoreboardControl({
      snapshot: { gameType: 'call-and-answer', scoreboard: { open: true, style: 'tote', page: 2, openedAt: 't' } },
      roster: { afterRound: 2 },
    });
    expect(c.enabled).toBe(true);
    expect(c.board).toEqual({ open: true, style: 'tote', page: 2, openedAt: 't' });
  });

  test('a snapshot without a board reads closed, in the default look', () => {
    const c = scoreboardControl({ snapshot: { gameType: 'trivia' }, roster: { afterRound: 1 } });
    expect(c.board).toEqual({ open: false, style: 'departure', page: 0, openedAt: null });
  });
});

const board = (over = {}) => ({ open: false, style: 'departure', page: 0, openedAt: null, ...over });

function renderPanel(props = {}) {
  const handlers = { onToggle: jest.fn(), onNextPage: jest.fn(), onStyle: jest.fn() };
  render(
    <RemoteScoreboardPanel
      board={board()}
      availability={{ show: true, enabled: true, reason: '' }}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('RemoteScoreboardPanel', () => {
  test('says it changes the ROOM\'s screen', () => {
    renderPanel();
    expect(screen.getByText(/room's screen/i)).toBeInTheDocument();
  });

  test('Show the scoreboard opens it', () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /show the scoreboard/i }));
    expect(h.onToggle).toHaveBeenCalledWith(true);
  });

  test('with it open: Hide closes it, and Next page turns the room\'s page', () => {
    const h = renderPanel({ board: board({ open: true }) });
    fireEvent.click(screen.getByRole('button', { name: /hide the scoreboard/i }));
    expect(h.onToggle).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(h.onNextPage).toHaveBeenCalled();
  });

  test('Next page is disabled while the board is closed', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  test('the style picker marks the current look and picks another', () => {
    const h = renderPanel({ board: board({ open: true, style: 'olympic' }) });
    const olympic = screen.getByRole('button', { name: 'Olympic board' });
    expect(olympic).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tote board' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Tote board' }));
    expect(h.onStyle).toHaveBeenCalledWith('tote');
  });

  test('before a round is scored: disabled, with the reason written beside it', () => {
    renderPanel({ availability: { show: true, enabled: false, reason: 'Scores appear after the first round' } });
    expect(screen.getByRole('button', { name: /show the scoreboard/i })).toBeDisabled();
    expect(screen.getByText('Scores appear after the first round')).toBeInTheDocument();
  });

  test('nothing at all for a game type without a board', () => {
    const { container } = render(
      <RemoteScoreboardPanel board={board()} availability={{ show: false, enabled: false, reason: '' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('busy: the controls wait for the last press to land', () => {
    renderPanel({ busy: true, board: board({ open: true }) });
    expect(screen.getByRole('button', { name: /hide the scoreboard/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });
});

/* ---------------------------------------------------------------- source */

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const REMOTE = code(fs.readFileSync(path.join(__dirname, '..', 'HostRemote.jsx'), 'utf8'));

describe('HostRemote wires it', () => {
  test('it renders the panel from the two polls it already makes', () => {
    expect(REMOTE).toMatch(/<RemoteScoreboardPanel\b/);
    expect(REMOTE).toMatch(/scoreboardControl\(\{\s*snapshot,\s*roster\s*\}\)/);
  });

  test('it posts to the closed route with authFetch', () => {
    expect(REMOTE).toMatch(/authFetch\(`\$\{apiBase\(\)\}games\/\$\{gameId\}\/scoreboard`/);
  });
});
