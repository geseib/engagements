/**
 * THE SCOREBOARD FROM THE HOST'S KEYBOARD — useScoreboardKeys, the shortcut
 * gate, and the wiring in GameHostPage.jsx read as source.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §3:
 *
 *   S opens and closes the board; with it open V cycles the look, Esc closes,
 *   and Space closes it WITHOUT advancing the game in the same press. None of
 *   them fire while typing or with the session menu open.
 *
 * GameHostPage cannot mount in jsdom (an AuthProvider and a live socket), so
 * the listener lives in a hook this suite renders, and the host page's
 * arrangement — HostActionBar's Space listener gated on `shortcutsSuppressed`
 * — is reproduced here with the real HostActionBar. What a mount cannot see,
 * whether GameHostPage actually passes the terms, is read from its
 * comment-stripped source at the bottom.
 */
import React, { useState } from 'react';
import fs from 'fs';
import path from 'path';
import { render, act, fireEvent, screen } from '@testing-library/react';
import useScoreboardKeys from '../components/stage/scoreboard/useScoreboardKeys';
import HostActionBar from '../components/HostActionBar';
import { shortcutsSuppressed, scoreboardKeysLive } from '../utils/hostOverlays';
import Scoreboard from '../components/stage/scoreboard/Scoreboard';
import AnswerSpotlight from '../components/AnswerSpotlight';
import Stage from '../components/stage/Stage';
import { nextStyle } from '../config/scoreboard';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { HOST_ROLE } from '../config/help/host';

function Host({ canOpen = true, enabled = true, onAction = () => {}, start = false }) {
  const [board, setBoard] = useState({ open: start, style: 'departure' });
  useScoreboardKeys({
    enabled,
    open: board.open,
    canOpen,
    onOpen: () => setBoard((b) => ({ ...b, open: true })),
    onClose: () => setBoard((b) => ({ ...b, open: false })),
    onCycleStyle: () => setBoard((b) => ({ ...b, style: nextStyle(b.style) })),
  });
  return (
    <div>
      <output data-testid="board">{`${board.open ? 'open' : 'closed'}:${board.style}`}</output>
      <HostActionBar
        controls={{ primary: { id: 'next', label: 'Next Round' } }}
        onAction={onAction}
        bigScreen
        shortcutsEnabled={!shortcutsSuppressed({ scoreboardOpen: board.open })}
      />
      <input data-testid="field" />
    </div>
  );
}

const state = (utils) => utils.getByTestId('board').textContent;
const press = (key, opts = {}) => act(() => { fireEvent.keyDown(opts.target || window, { key, ...opts }); });

describe('the shortcut gate', () => {
  test('an open scoreboard takes the advance keys away from the dock', () => {
    expect(shortcutsSuppressed({ scoreboardOpen: true })).toBe(true);
    expect(shortcutsSuppressed({ scoreboardOpen: false })).toBe(false);
  });
});

describe('useScoreboardKeys', () => {
  test('S opens the board and S closes it', () => {
    const utils = render(<Host />);
    press('s');
    expect(state(utils)).toBe('open:departure');
    press('S');
    expect(state(utils)).toBe('closed:departure');
  });

  test('S does nothing when the board cannot open (no round scored yet)', () => {
    const utils = render(<Host canOpen={false} />);
    press('s');
    expect(state(utils)).toBe('closed:departure');
  });

  test('V cycles the look while the board is open, and only then', () => {
    const utils = render(<Host />);
    press('v');
    expect(state(utils)).toBe('closed:departure');
    press('s');
    press('v');
    expect(state(utils)).toBe('open:olympic');
    press('V');
    expect(state(utils)).toBe('open:tote');
    press('v');
    expect(state(utils)).toBe('open:departure');
  });

  test('Escape closes it', () => {
    const utils = render(<Host start />);
    press('Escape');
    expect(state(utils)).toBe('closed:departure');
  });

  test('Space closes the board and does NOT advance the game in the same press', () => {
    const onAction = jest.fn();
    const utils = render(<Host start onAction={onAction} />);
    press(' ');
    expect(state(utils)).toBe('closed:departure');
    expect(onAction).not.toHaveBeenCalled();
    // ...and with the board gone, Space is the advance key again.
    press(' ');
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test('→ with the board open is the board\'s (a page), not the dock\'s advance', () => {
    const onAction = jest.fn();
    render(<Host start onAction={onAction} />);
    press('ArrowRight');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('nothing fires while typing in a field', () => {
    const utils = render(<Host />);
    press('s', { target: utils.getByTestId('field') });
    expect(state(utils)).toBe('closed:departure');
  });

  test('nothing fires while the session menu is open (the hook is disabled)', () => {
    const utils = render(<Host enabled={false} start />);
    press('Escape');
    press('v');
    expect(state(utils)).toBe('open:departure');
  });
});

describe('the keys are written down where the host looks for them', () => {
  test('the Settings tab lists S and V on a Trivia session', () => {
    const utils = render(<SessionSetupPanel gameType="trivia" />);
    fireEvent.click(utils.getByRole('tab', { name: 'Settings' }));
    const keys = utils.container.querySelector('.setup-keys').textContent;
    expect(keys).toMatch(/S\s*show or hide the scoreboard/);
    expect(keys).toMatch(/V\s*change the scoreboard's look/);
  });

  test('...and not on a Poll, which has no board', () => {
    const utils = render(<SessionSetupPanel gameType="poll" />);
    fireEvent.click(utils.getByRole('tab', { name: 'Settings' }));
    expect(utils.container.querySelector('.setup-keys').textContent).not.toMatch(/scoreboard/);
  });

  test('the host guide lists them too', () => {
    const items = JSON.stringify(HOST_ROLE);
    expect(items).toMatch(/"keys":"S","text":"Show or hide the scoreboard/);
    expect(items).toMatch(/"keys":"V","text":"With the scoreboard up, change its look/);
  });
});

describe('under an overlay the board\'s keys are not the board\'s', () => {
  test('scoreboardKeysLive: off with the session menu or any overlay that blocks S', () => {
    expect(scoreboardKeysLive({})).toBe(true);
    expect(scoreboardKeysLive({ setupPanelOpen: true })).toBe(false);
    for (const flag of ['showConfirmModal', 'showExpandedQR', 'showReportsModal', 'lessonExpanded',
      'isLoadingData', 'spotlightOpen', 'pastRoundOpen']) {
      expect(scoreboardKeysLive({ [flag]: true })).toBe(false);
    }
    expect(scoreboardKeysLive({ qrMode: 'pinned' })).toBe(false);
    expect(scoreboardKeysLive({ qrMode: 'preview' })).toBe(true);
    // The board's own term is not a reason to switch off the board's keys.
    expect(scoreboardKeysLive({ scoreboardOpen: true })).toBe(true);
  });

  const PLAYERS = Array.from({ length: 14 }, (_, i) => ({
    playerId: `p${i}`, playerName: `Player ${i + 1}`, totalScore: 100 - i, rank: i + 1, movement: 0, previousScore: 90 - i,
  }));
  const ANSWERS = [
    { id: 'a1', playerName: 'Ada', answer: 'First thought', points: 3 },
    { id: 'a2', playerName: 'Bo', answer: 'Second thought', points: 2 },
  ];

  /** The page's arrangement: a spotlight opened (from the phone) over the open board. */
  function Room({ onIndex, onSpotClose }) {
    const [board, setBoard] = useState({ open: true, style: 'olympic', page: 0, openedAt: 't' });
    const [spot, setSpot] = useState(0);
    const live = scoreboardKeysLive({ spotlightOpen: spot !== null });
    useScoreboardKeys({
      enabled: live,
      open: board.open,
      canOpen: true,
      onOpen: () => setBoard((b) => ({ ...b, open: true })),
      onClose: () => setBoard((b) => ({ ...b, open: false })),
      onCycleStyle: () => setBoard((b) => ({ ...b, style: nextStyle(b.style) })),
    });
    return (
      <div className="stage">
        <output data-testid="board">{board.open ? 'open' : 'closed'}</output>
        {board.open && <Scoreboard gameId="6060" apiBase="https://api.test/" profile="room" board={board} keysEnabled={live} />}
        {spot !== null && (
          <AnswerSpotlight
            answers={ANSWERS}
            index={spot}
            onIndex={(i) => { onIndex(i); setSpot(i); }}
            onClose={() => { onSpotClose(); setSpot(null); }}
            labelFor={(a) => a.playerName}
          />
        )}
      </div>
    );
  }

  beforeEach(() => {
    window.matchMedia = jest.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ players: PLAYERS, afterRound: 3 }) }));
  });
  afterEach(() => { delete global.fetch; });

  test('→ steps the spotlight and not the hidden board; Esc closes the spotlight, not the board', async () => {
    const onIndex = jest.fn();
    const onSpotClose = jest.fn();
    await act(async () => { render(<Room onIndex={onIndex} onSpotClose={onSpotClose} />); });
    await act(async () => { await Promise.resolve(); });
    const boardEl = document.querySelector('[data-scoreboard]');
    expect(boardEl.dataset.page).toBe('0');

    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: 'ArrowRight' }); });
    expect(onIndex).toHaveBeenCalledWith(1);
    expect(boardEl.dataset.page).toBe('0');
    expect(boardEl.dataset.auto).toBe('on');

    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' }); });
    expect(onSpotClose).toHaveBeenCalled();
    expect(screen.getByTestId('board').textContent).toBe('open');

    // With the spotlight gone the board's keys are its own again.
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(document.querySelector('[data-scoreboard]').dataset.page).toBe('1');
  });
});

describe('the Stage draws its overlay inside the stage', () => {
  test('an overlay is a child of main.stage, after the dock', () => {
    const { container } = render(
      <Stage profile="room" phase="results" dock={<footer className="dock" data-testid="dock" />}
        overlay={<section data-testid="overlay" />}>
        <div className="content" />
      </Stage>,
    );
    const overlay = container.querySelector('main.stage > [data-testid="overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay.previousElementSibling).toBe(container.querySelector('[data-testid="dock"]'));
  });

  test('no overlay, no element', () => {
    const { container } = render(<Stage profile="room" phase="results"><div className="content" /></Stage>);
    expect(container.querySelector('main.stage').lastElementChild.className).toMatch(/dock/);
  });
});

/* ---------------------------------------------------------------- source */

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const PAGE = code(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));

describe('GameHostPage wires it', () => {
  test('both shortcut gates carry the scoreboard term', () => {
    // The dock's (anyOverlayOpen — HostActionBar, the Pager, the SPACE chip)
    // and auto-mode's (an open board holds the session where it is).
    const dock = /const anyOverlayOpen = shortcutsSuppressed\(\{([\s\S]*?)\}\)/.exec(PAGE);
    const auto = /if \(shortcutsSuppressed\(\{([\s\S]*?)\}\)\) return undefined;/.exec(PAGE);
    expect(dock && dock[1]).toMatch(/scoreboardOpen:\s*scoreboard\.open/);
    expect(auto && auto[1]).toMatch(/scoreboardOpen:\s*scoreboard\.open/);
  });

  test('the keys are off while the session menu or any overlay is open — both sets of them', () => {
    const live = /const scoreboardKeysOn = scoreboardKeysLive\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(live).not.toBeNull();
    for (const term of ['setupPanelOpen', 'showConfirmModal', 'qrMode', 'spotlightOpen', 'pastRoundOpen', 'lessonExpanded']) {
      expect(live[1]).toMatch(new RegExp(`\\b${term}\\b`));
    }
    const hook = /useScoreboardKeys\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(hook && hook[1]).toMatch(/enabled:\s*scoreboardKeysOn\b/);
    const board = PAGE.slice(PAGE.indexOf('<Scoreboard'), PAGE.indexOf('/>', PAGE.indexOf('<Scoreboard')));
    expect(board).toMatch(/keysEnabled=\{scoreboardKeysOn\}/);
  });

  test('scoreboardChanged is registered and removed', () => {
    expect(PAGE).toMatch(/onMessage\('scoreboardChanged'/);
    expect(PAGE).toMatch(/offMessage\('scoreboardChanged'\)/);
  });

  test('every server copy goes through the revision check — the restore and the frame', () => {
    expect(PAGE).toMatch(/applyServerBoard\(gameStateData\.scoreboard\)/);
    const frame = /onMessage\('scoreboardChanged',[\s\S]*?\}\);/.exec(PAGE);
    expect(frame && frame[0]).toMatch(/applyServerBoard\(data\)/);
    // Nothing else writes the board around it.
    expect(PAGE).not.toMatch(/setScoreboard\(/);
  });

  test('the board is the Stage element\'s overlay, and mounted nowhere else', () => {
    const at = PAGE.indexOf('<Stage\n');
    const stageEl = PAGE.slice(at, PAGE.indexOf('>\n', PAGE.indexOf('overlay=', at)));
    expect(stageEl).toMatch(/overlay=\{scoreboard\.open && scoreboardAvail\.show \? \(\s*<Scoreboard\b/);
    expect(PAGE.match(/<Scoreboard\b/g)).toHaveLength(1);
  });

  test('changes go through authFetch to the closed route', () => {
    expect(PAGE).toMatch(/useScoreboardSync\(\{\s*gameId,\s*apiBase:\s*API_BASE,\s*fetchFn:\s*authFetch\s*\}\)/);
  });

  test('the board reloads once the round\'s points are counted, not only when the phase moves', () => {
    const board = PAGE.slice(PAGE.indexOf('<Scoreboard'), PAGE.indexOf('/>', PAGE.indexOf('<Scoreboard')));
    expect(board).toMatch(/refreshKey=\{`\$\{gameState\}\|\$\{scoresAfterRound\}`\}/);
  });
});
