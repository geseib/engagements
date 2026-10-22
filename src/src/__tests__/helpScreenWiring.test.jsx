/**
 * EVERY SCREEN ID HAS A SCREEN, AND NO SCREEN THE ROOM SEES HAS HELP.
 *
 * Help refresh Phase 3 (docs/help-refresh/README.md §2). helpScreens.test.js
 * holds the map honest against the guides: every entry opens a real section.
 * This holds it honest against the product:
 *   §1 every HELP_FOR_SCREEN id is named by at least one component, so an id
 *      whose screen was never wired (or no longer exists) fails;
 *   §2 every screen id a component names is in the map, so a typo opens
 *      help's home instead of failing the build;
 *   §3 the functions that pick an id per state, tab or section only ever
 *      pick real ones;
 *   §4 nothing the room sees carries a `?` (the stage canvas, the room's
 *      window, the Build wall), as hostNotificationsBell.test.jsx pins the bell;
 *   §5 the player's `?` opens the section for the state they are in.
 *
 * // rejects: an id left in the map with no button; a `help="player-votng"`
 * //          typo; a help button on PresentPage, present/ or the Build wall;
 * //          the Dock drawing a `?` on the wall's copy of the Stage.
 */
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { render, screen, fireEvent } from '@testing-library/react';

import { HELP_FOR_SCREEN, PROVISIONAL_SCREENS } from '../config/help/screens';
import { PlayerShell, playerHelpScreen } from '../PlayerPage';
import Dock from '../components/stage/Dock';
import { TAB_HELP } from '../components/stage/SessionSetupPanel';
import { adminHelpScreen } from '../AdminPage';
import { SCREEN_HELP } from '../buildroom/BuildRoomPage';

const SRC = join(__dirname, '..');
const rel = (p) => relative(SRC, p).split(sep).join('/');

function walk(dir, out = []) {
  readdirSync(dir).forEach((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['__tests__', 'node_modules', 'testing'].includes(name)) return;
      if (rel(p) === 'config/help') return;
      walk(p, out);
    } else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  });
  return out;
}
const FILES = walk(SRC).map((p) => ({ rel: rel(p), text: readFileSync(p, 'utf8') }));
const IDS = Object.keys(HELP_FOR_SCREEN);

describe('§1 every screen id has a screen', () => {
  test.each(IDS)('%s is named by a component', (id) => {
    const quoted = new RegExp(`['"\`]${id}['"\`]`);
    const where = FILES.filter((f) => quoted.test(f.text)).map((f) => f.rel);
    expect(where.length).toBeGreaterThan(0);
  });

  test('no screen is still provisional', () => {
    expect(PROVISIONAL_SCREENS).toEqual([]);
  });
});

describe('§2 every screen id a component names is real', () => {
  // A `help` prop is read only when it looks like a screen id (`<surface>-…`):
  // other components have a `help` that is a sentence of their own.
  const ID = '((?:host|player|admin|staff|ai|build|event)-[a-z0-9-]+)';
  const NAMED = [
    /helpFor\(\s*'([a-z0-9-]+)'\s*\)/g, // helpFor('admin-prompts')
    new RegExp(`\\bhelp="${ID}"`, 'g'), // <Dock help="build-stage" />
    new RegExp(`\\bhelp=\\{'${ID}'\\}`, 'g'),
    new RegExp(`\\bhelp:\\s*'${ID}'`, 'g'), // top={{ help: 'build-console' }}
  ];
  const named = [];
  FILES.forEach((f) => NAMED.forEach((re) => {
    for (const m of f.text.matchAll(re)) named.push([f.rel, m[1]]);
  }));

  test('components name screen ids at all (the scan is not empty)', () => {
    expect(named.length).toBeGreaterThan(20);
  });

  test('each one is in HELP_FOR_SCREEN', () => {
    expect(named.filter(([, id]) => !HELP_FOR_SCREEN[id])).toEqual([]);
  });
});

describe('§3 the per-state pickers pick real ids', () => {
  test('the Session panel: one per tab', () => {
    expect(Object.keys(TAB_HELP).sort()).toEqual(['history', 'players', 'questions', 'settings']);
    Object.values(TAB_HELP).forEach((id) => expect(HELP_FOR_SCREEN[id]).toBeDefined());
  });

  test('the Build Room header: Host, Build and History (the Stage\'s is its dock)', () => {
    expect(SCREEN_HELP).toEqual({ host: 'build-host', build: 'build-build', history: 'build-history' });
  });

  test('the admin console: every section, staff and not, and the places inside them', () => {
    const tabs = ['overview', 'questionsets', 'games', 'events', 'library', 'prompts', 'members', 'activity',
      'billing', 'privacy', 'reports', 'settings', 'orgs', 'observability', 'planrequests', 'discountcodes',
      'publiclibrary', 'moderation', 'users', 'archive', 'engagesettings', 'no-such-section'];
    const picked = new Set();
    tabs.forEach((tab) => [false, true].forEach((onPlatform) => picked.add(adminHelpScreen({ tab, onPlatform }))));
    picked.add(adminHelpScreen({ tab: 'questionsets', editingSet: true }));
    picked.add(adminHelpScreen({ tab: 'questionsets', draftOpen: true }));
    picked.add(adminHelpScreen({ tab: 'events', eventOpen: true }));
    [...picked].forEach((id) => expect(HELP_FOR_SCREEN[id]).toBeDefined());
    // Each staff section opens its own staff section, not the customer's.
    expect(adminHelpScreen({ tab: 'questionsets', onPlatform: true })).toBe('staff-shared-library');
    expect(adminHelpScreen({ tab: 'users', onPlatform: true })).toBe('staff-accounts');
    expect(adminHelpScreen({ tab: 'members' })).toBe('admin-members');
    expect(adminHelpScreen({ tab: 'questionsets', editingSet: true })).toBe('admin-set-editor');
    expect(adminHelpScreen({ tab: 'questionsets', draftOpen: true })).toBe('ai-draft-review');
    expect(adminHelpScreen({ tab: 'no-such-section' })).toBe('admin-console');
  });

  test('the player page: one per state of a round session', () => {
    expect(playerHelpScreen('')).toBe('player-lobby');
    expect(playerHelpScreen('ASK#001')).toBe('player-answering');
    expect(playerHelpScreen('VOTE#001')).toBe('player-voting');
    expect(playerHelpScreen('RESULTS#001')).toBe('player-results');
    expect(playerHelpScreen('ENDED')).toBe('player-end');
    // Writing a comment is the feedback section, whatever the state moved to.
    expect(playerHelpScreen('ASK#002', true)).toBe('player-results');
  });
});

describe('§4 never on a screen the room sees', () => {
  const ROOM_SEES = FILES.filter((f) => f.rel === 'PresentPage.jsx'
    || f.rel.startsWith('present/')
    || f.rel === 'components/stage/Stage.jsx');

  test('the room\'s window, the Build wall and the stage canvas import no help', () => {
    expect(ROOM_SEES.map((f) => f.rel)).toEqual(expect.arrayContaining([
      'PresentPage.jsx', 'present/PresentStage.jsx', 'present/buildwall/BuildWall.jsx', 'components/stage/Stage.jsx',
    ]));
    ROOM_SEES.forEach((f) => {
      expect([f.rel, /HelpButton|helpFor|HelpSystem/.test(f.text)]).toEqual([f.rel, false]);
    });
  });

  test('the Dock draws a `?` only when its caller asks: the wall\'s copy of the Stage does not', () => {
    const { container, rerender } = render(<Dock status="Waiting" />);
    expect(container.querySelector('.help-button')).toBeNull();
    rerender(<Dock status="Waiting" help="host-dock" onSetup={() => {}} />);
    expect(container.querySelectorAll('.dock .help-button.dock-help')).toHaveLength(1);
    // Never after SESSION: `home` and SESSION stay the last two.
    const kids = [...container.querySelector('.dock').children];
    expect(kids[kids.length - 1]).toHaveTextContent(/^SESSION/);
  });

  test('the Build Stage asks for it only in the host\'s branch', () => {
    const text = FILES.find((f) => f.rel === 'buildroom/screens/BuildStageScreen.jsx').text;
    expect(text).toMatch(/help="build-stage"/);
    // The wall renders this screen with no `controls`, and that branch's Dock is bare.
    expect(text).toMatch(/: <Dock status=\{status\} \/>/);
  });
});

describe('§5 the player\'s `?` opens where they are', () => {
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read the guides' }));
  };
  test.each([
    ['player-lobby', 'player-playing', 'between-rounds'],
    ['player-answering', 'player-playing', 'answering'],
    ['player-results', 'player-feedback', 'results-feedback'],
    ['player-end', 'player-feedback', 'after-the-end'],
    ['player-survey', 'player-surveys', 'answering'],
    ['player-event', 'player-events', 'the-agenda'],
    ['player-build-room', 'player-build-room', 'joining'],
    ['player-name-taken', 'player-joining', 'name-taken'],
  ])('%s opens %s#%s', (id, guide, section) => {
    expect(HELP_FOR_SCREEN[id]).toEqual({ guide, section });
    render(<PlayerShell phase="rest" ctx="Round 1" who="Ada" help={id} />);
    open();
    expect(document.getElementById(`help-${guide}--${section}`)).toBeInTheDocument();
  });

  test('the player\'s target is still 44px (PlayerSurface.css)', () => {
    const css = readFileSync(join(SRC, 'components', 'PlayerSurface.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const body = css.slice(css.indexOf('.plr .help-button.plr-helpbtn {')).split('}')[0];
    expect(body).toMatch(/width:\s*44px/);
    expect(body).toMatch(/height:\s*44px/);
  });
});

describe('the phone remote\'s `?` is a 44px target on any pointer', () => {
  test('HostRemote.css sizes it outside any media query', () => {
    const css = readFileSync(join(SRC, 'HostRemote.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const body = css.slice(css.indexOf('.hr-bar .help-button.hr-help {')).split('}')[0];
    expect(body).toMatch(/width:\s*44px/);
    expect(body).toMatch(/height:\s*44px/);
  });
});
