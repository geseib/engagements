/**
 * THE SCOREBOARD IN THE SESSION MENU — the Players tab's button and the
 * Settings tab's "Scoreboard style", on components/stage/SessionSetupPanel.jsx,
 * plus config/setupPanel.js's scoreboardButton and the page's wiring as source.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §2–§3:
 *   - a "Show scoreboard on screen" / "Hide scoreboard" button above the
 *     roster, disabled with "Scores appear after the first round" before a
 *     round is scored, and absent for other game types;
 *   - the look under "Scoreboard" on the Settings tab: departure | olympic |
 *     tote, applied live.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { scoreboardButton } from '../config/setupPanel';

const ready = { show: true, enabled: true, reason: '' };
const notYet = { show: true, enabled: false, reason: 'Scores appear after the first round' };
const none = { show: false, enabled: false, reason: '' };
const closed = { open: false, style: 'departure', page: 0, openedAt: null };

describe('scoreboardButton', () => {
  test('closed: Show scoreboard on screen', () => {
    expect(scoreboardButton({ board: closed, availability: ready }))
      .toEqual({ show: true, label: 'Show scoreboard on screen', disabled: false, reason: '' });
  });

  test('open: Hide scoreboard — never disabled, even if the scores went away', () => {
    expect(scoreboardButton({ board: { ...closed, open: true }, availability: notYet }))
      .toEqual({ show: true, label: 'Hide scoreboard', disabled: false, reason: '' });
  });

  test('before a round is scored: disabled with its reason', () => {
    expect(scoreboardButton({ board: closed, availability: notYet }))
      .toEqual({ show: true, label: 'Show scoreboard on screen', disabled: true, reason: 'Scores appear after the first round' });
  });

  test('another game type: no button', () => {
    expect(scoreboardButton({ board: closed, availability: none }).show).toBe(false);
  });
});

function renderPanel(props = {}) {
  const onToggleScoreboard = jest.fn();
  const onScoreboardStyle = jest.fn();
  const utils = render(
    <SessionSetupPanel
      gameType="trivia"
      players={[{ name: 'Ada', score: 12 }, { name: 'Bo', score: 9 }]}
      scoreboard={closed}
      scoreboardAvailability={ready}
      onToggleScoreboard={onToggleScoreboard}
      onScoreboardStyle={onScoreboardStyle}
      {...props}
    />,
  );
  return { ...utils, onToggleScoreboard, onScoreboardStyle };
}

describe('the Players tab', () => {
  test('the button sits above the roster and opens the board', () => {
    const { onToggleScoreboard, container } = renderPanel();
    const button = screen.getByRole('button', { name: 'Show scoreboard on screen' });
    const roster = container.querySelector('.setup-roster');
    // eslint-disable-next-line no-bitwise
    expect(button.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(onToggleScoreboard).toHaveBeenCalledWith(true);
  });

  test('with the board up it reads Hide scoreboard and closes it', () => {
    const { onToggleScoreboard } = renderPanel({ scoreboard: { ...closed, open: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide scoreboard' }));
    expect(onToggleScoreboard).toHaveBeenCalledWith(false);
  });

  test('disabled, with the reason, before a round is scored', () => {
    renderPanel({ scoreboardAvailability: notYet });
    expect(screen.getByRole('button', { name: 'Show scoreboard on screen' })).toBeDisabled();
    expect(screen.getByText('Scores appear after the first round')).toBeInTheDocument();
  });

  test('absent for a Poll', () => {
    renderPanel({ gameType: 'poll', scoreboardAvailability: none });
    expect(screen.queryByRole('button', { name: /scoreboard/i })).toBeNull();
  });

  test('present even before anyone has joined — the room may be empty but the rule is the same', () => {
    renderPanel({ players: [], scoreboardAvailability: notYet });
    expect(screen.getByRole('button', { name: 'Show scoreboard on screen' })).toBeDisabled();
  });
});

describe('the Settings tab', () => {
  test('a Scoreboard section with the three looks, the current one chosen', () => {
    renderPanel({ scoreboard: { ...closed, style: 'olympic' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    const select = screen.getByLabelText('Scoreboard style');
    expect(select.value).toBe('olympic');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['departure', 'Departure board'], ['olympic', 'Olympic board'], ['tote', 'Tote board'],
    ]);
  });

  test('choosing a look sends it', () => {
    const { onScoreboardStyle } = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Scoreboard style'), { target: { value: 'tote' } });
    expect(onScoreboardStyle).toHaveBeenCalledWith('tote');
  });

  test('no Scoreboard section for a Poll', () => {
    renderPanel({ gameType: 'poll', scoreboardAvailability: none });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.queryByLabelText('Scoreboard style')).toBeNull();
  });
});

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const PAGE = code(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));

describe('GameHostPage hands the panel the board', () => {
  test('the four props, from the page\'s own board and publishScoreboard', () => {
    const at = PAGE.indexOf('<SessionSetupPanel');
    const el = PAGE.slice(at, PAGE.indexOf('/>', PAGE.indexOf('onScoreboardStyle', at)) + 2);
    expect(el).toMatch(/scoreboard=\{scoreboard\}/);
    expect(el).toMatch(/scoreboardAvailability=\{scoreboardAvail\}/);
    expect(el).toMatch(/onToggleScoreboard=\{\(open\) => publishScoreboard\(\{ open \}\)\}/);
    expect(el).toMatch(/onScoreboardStyle=\{\(style\) => publishScoreboard\(\{ style \}\)\}/);
  });
});
