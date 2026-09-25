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
import { render, act, fireEvent } from '@testing-library/react';
import useScoreboardKeys from '../components/stage/scoreboard/useScoreboardKeys';
import HostActionBar from '../components/HostActionBar';
import { shortcutsSuppressed } from '../utils/hostOverlays';
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

/* ---------------------------------------------------------------- source */

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const PAGE = code(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));
const STAGE = code(fs.readFileSync(path.join(__dirname, '..', 'components', 'stage', 'Stage.jsx'), 'utf8'));

describe('GameHostPage wires it', () => {
  test('both shortcut gates carry the scoreboard term', () => {
    // The dock's (anyOverlayOpen — HostActionBar, the Pager, the SPACE chip)
    // and auto-mode's (an open board holds the session where it is).
    const dock = /const anyOverlayOpen = shortcutsSuppressed\(\{([\s\S]*?)\}\)/.exec(PAGE);
    const auto = /if \(shortcutsSuppressed\(\{([\s\S]*?)\}\)\) return undefined;/.exec(PAGE);
    expect(dock && dock[1]).toMatch(/scoreboardOpen:\s*scoreboard\.open/);
    expect(auto && auto[1]).toMatch(/scoreboardOpen:\s*scoreboard\.open/);
  });

  test('the keys are off while the session menu is open', () => {
    const m = /useScoreboardKeys\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/enabled:[^,]*!setupPanelOpen/);
  });

  test('scoreboardChanged is registered and removed', () => {
    expect(PAGE).toMatch(/onMessage\('scoreboardChanged'/);
    expect(PAGE).toMatch(/offMessage\('scoreboardChanged'\)/);
  });

  test('a refresh restores the board from get-game-state', () => {
    expect(PAGE).toMatch(/normaliseScoreboard\(gameStateData\.scoreboard\)/);
  });

  test('the board is drawn in the stage\'s own layer, not beside it', () => {
    expect(STAGE).toMatch(/overlay/);
    const stageEl = PAGE.slice(PAGE.indexOf('<Stage'), PAGE.indexOf('</Stage>'));
    expect(stageEl).toMatch(/overlay=\{/);
    expect(stageEl).toMatch(/<Scoreboard\b/);
  });

  test('changes go through authFetch to the closed route', () => {
    expect(PAGE).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/scoreboard`/);
  });
});
