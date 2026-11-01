/**
 * THE CONSOLE'S FRAME (experience plan §3.2, Phase 2 steps 2a and 2c): the top
 * bar's fixed slots in every phase, the words from config/hostWords.js, Main
 * menu always there, the Session menu's sheet over the content area only, the
 * pulse under the Needs-you line, and the room's count said once.
 *
 * // rejects: "← All sessions" only in the lobby and at the end (audit A §3.3);
 * //          a Session panel with no labelled opener that covers Your part
 * //          now when it opens (audit A §3.6); the answered count in the
 * //          People header and the card's status at once (audit A §3.4).
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import HostConsole from '../components/console/HostConsole';
import ConsolePulse from '../components/console/ConsolePulse';
import HW, { TOP_SLOTS } from '../config/hostWords';
import { withoutRoomCount } from '../config/consolePulse';
import { stripFor } from '../config/workflowStrip';

jest.mock('../utils/libraries', () => ({ fetchOrgs: () => Promise.resolve([]), librariesFrom: () => [] }));

const MOMENTS = ['LOBBY', 'ANSWERING', 'VOTING', 'VOTE_RESPONSES', 'RESULTS', 'READ', 'FEEDBACK', 'ROOM_QUESTION', 'ENDED'];
const strip = stripFor({ gameType: 'call-and-answer', roundNoun: 'Round', state: 'ASK#002', totalRounds: 6, progress: { received: 3, total: 4 } });
const controls = {
  primary: { id: 'open-vote', label: 'Start voting', intent: 'finish', icon: 'ListChecks' },
  status: { text: '3 of 4 answered', tone: 'pending' },
};
const needs = { items: [], nowCount: 0, soonCount: 0, top: null };

function frame({ moment = 'ANSWERING', connected = true, onSessionMenu = jest.fn(), onLeave = jest.fn(), sessionMenuOpen = false, sheetRef = undefined, status = controls.status } = {}) {
  const props = {
    top: {
      title: 'Relay expansion', code: '7924', onJoin: jest.fn(), joinPressed: false,
      presentHref: '/present?gameId=7924', presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() },
      help: 'host-console', bellSession: { needs, onAct: jest.fn() },
      onLeave, connected, onSessionMenu, sessionMenuOpen,
    },
    strip: { strip, mode: 'full', onView: jest.fn() },
    rail: {
      moment,
      rounds: [{ n: 1, title: 'Churchill', state: 'done' }, { n: 2, title: 'Meiji', state: 'now' }],
      people: [{ name: 'Ada', state: 'answered' }, { name: 'Omar', state: 'writing' }],
      counts: { players: 4, answered: 3, voted: 0 },
      late: [], onOpenSection: jest.fn(),
    },
    footer: { status: withoutRoomCount(status, moment), part: strip.part, controls: { ...controls, status }, onAction: jest.fn(), shortcutsEnabled: false },
    needs: <div data-testid="needs-line">Nothing needs you now.</div>,
    pulse: <ConsolePulse moment={moment} players={4} answered={3} voted={1} openedAt={Date.now() - 84000} now={Date.now()} />,
    sheetRef,
  };
  return { ...render(<HostConsole {...props}><div data-testid="panel">panel</div></HostConsole>), props };
}

const slotsOf = (container) => [...container.querySelectorAll('.hc-top [data-slot]')].map((n) => n.getAttribute('data-slot'));

describe('the top bar\'s slots, in order, in every phase', () => {
  test.each(MOMENTS)('%s', (moment) => {
    const { container } = frame({ moment });
    // Connection only when broken: every other slot, in TOP_SLOTS' order.
    expect(slotsOf(container)).toEqual(TOP_SLOTS.filter((s) => s !== 'connection'));
  });

  test('the order is the plan\'s: Main menu first, Session menu last', () => {
    expect(TOP_SLOTS).toEqual(['main-menu', 'name', 'join', 'room-screen', 'connection', 'needs-you', 'help', 'session-menu']);
  });

  test('a broken connection takes its slot, between the room\'s screen and the bell', () => {
    const { container } = frame({ connected: false });
    expect(slotsOf(container)).toEqual(TOP_SLOTS);
    expect(container.querySelector('[data-slot="connection"]').textContent).toBe(HW.notHearing);
    expect(container.querySelector('[data-slot="connection"]')).toHaveAttribute('aria-label', `${HW.notHearing} · ${HW.reconnecting}`);
  });
});

describe('the words come from hostWords', () => {
  test('Main menu, Join, the room\'s window, Needs you and Session menu', () => {
    const { container } = frame();
    const top = container.querySelector('.hc-top');
    expect(within(top).getByRole('button', { name: HW.mainMenu })).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: new RegExp(`^${HW.join} 7924\\. ${HW.joinShowHint}`) })).toHaveAttribute('aria-pressed', 'false');
    expect(within(top).getByRole('link', { name: new RegExp(HW.roomsWindow) })).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: HW.needsYou })).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: HW.sessionMenu })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(top.textContent).not.toMatch(/All sessions|Engagements/);
  });

  test('ConsoleTop takes every label from hostWords, none written inline', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'console', 'ConsoleTop.jsx'), 'utf8');
    expect(src).toMatch(/from '\.\.\/\.\.\/config\/hostWords'/);
    expect(src).not.toMatch(/consoleWords/);
    expect(src).not.toMatch(/>\s*(Main menu|Session menu|Join)\s*</);
  });

  test('Join is one toggle: pressed while the code is up, and says what the next press does', () => {
    const onJoin = jest.fn();
    const { rerender, props } = frame();
    rerender(<HostConsole {...props} top={{ ...props.top, onJoin, joinPressed: true }}><div /></HostConsole>);
    const join = screen.getByRole('button', { name: new RegExp(HW.joinHideHint) });
    expect(join).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(join);
    expect(onJoin).toHaveBeenCalled();
  });
});

describe('Main menu is always there', () => {
  test.each(MOMENTS)('%s: top left, and it leaves', (moment) => {
    const onLeave = jest.fn();
    const { container } = frame({ moment, onLeave });
    const first = container.querySelector('.hc-top').firstElementChild;
    expect(first.getAttribute('data-slot')).toBe('main-menu');
    fireEvent.click(first);
    expect(onLeave).toHaveBeenCalled();
  });

  test('without a page handler it still goes somewhere (never a dead control)', () => {
    const { props } = frame();
    const { container } = render(<HostConsole {...props} top={{ ...props.top, onLeave: null }}><div /></HostConsole>);
    expect(container.querySelector('[data-slot="main-menu"]')).not.toBeNull();
  });
});

describe('the Session menu', () => {
  test('one labelled button, top right, that says whether it is open', () => {
    const onSessionMenu = jest.fn();
    const { container, rerender, props } = frame({ onSessionMenu });
    const btn = container.querySelector('.hc-top').lastElementChild;
    expect(btn.getAttribute('data-slot')).toBe('session-menu');
    expect(btn).toHaveTextContent(HW.sessionMenu);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(onSessionMenu).toHaveBeenCalled();
    rerender(<HostConsole {...props} top={{ ...props.top, sessionMenuOpen: true }}><div /></HostConsole>);
    expect(container.querySelector('[data-slot="session-menu"]')).toHaveAttribute('aria-expanded', 'true');
  });

  test('its sheet host is the content area, after Your part now and the Needs-you line, never containing them', () => {
    let host = null;
    const { container } = frame({ sheetRef: (n) => { host = n; } });
    expect(host).toBe(container.querySelector('.hc-sheet'));
    const now = container.querySelector('.hc-now');
    const line = container.querySelector('.hc-needs');
    expect(host.contains(now)).toBe(false);
    expect(host.contains(line)).toBe(false);
    expect(now.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A direct child of the grid, so its grid rows (the stylesheet) place it.
    expect(host.parentElement).toBe(container.querySelector('.hc'));
  });

  test('the stylesheet puts the sheet from the pulse row to the foot, in the centre column', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'console', 'HostConsole.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel) => (css.match(new RegExp(`(?:^|})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    expect(rule('.hc-sheet')).toMatch(/grid-row:\s*pulse-start\s*\/\s*main-end/);
    expect(rule('.hc-sheet')).toMatch(/grid-column:\s*2/);
    // The panel's fixed, full-height box is replaced inside the host.
    expect(rule('.hc-sheet .setup-panel')).toMatch(/position:\s*absolute/);
    expect(rule('.hc-sheet .setup-panel')).toMatch(/top:\s*0/);
    expect(rule('.hc-sheet .setup-panel-scrim')).toMatch(/position:\s*absolute/);
    // The rows above the sheet are Your part now and the Needs-you line.
    expect(css).toMatch(/"rail now"\s*"rail needs"\s*"rail pulse"\s*"rail main"/);
  });

  test('the host page portals the Session menu into the console\'s sheet', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/const sessionMenuWhere = \(panel\) => \(useConsole && consoleSheetHost \? createPortal\(panel, consoleSheetHost\) : panel\)/);
    expect(page).toMatch(/\{setupPanelOpen && sessionMenuWhere\(\s*<SessionSetupPanel/);
    expect(page).toMatch(/sheetRef=\{setConsoleSheetHost\}/);
  });
});

describe('the pulse and the one count', () => {
  test('three tiles under the Needs-you line, above the main area', () => {
    const { container } = frame();
    const pulse = container.querySelector('.hc-pulse');
    expect([...pulse.querySelectorAll('[data-tile]')].map((t) => t.dataset.tile)).toEqual(['room', 'time', 'since']);
    expect(container.querySelector('.hc-needs').compareDocumentPosition(pulse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pulse.compareDocumentPosition(screen.getByTestId('panel')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test.each(['ANSWERING', 'VOTING'])('%s: the count is on the console once, in the tile', (moment) => {
    const status = moment === 'ANSWERING' ? { text: '3 of 4 answered', tone: 'pending' } : { text: '1 of 4 voted · Showing response 1 of 3', tone: 'pending' };
    const { container } = frame({ moment, status });
    const n = moment === 'ANSWERING' ? '3' : '1';
    expect(container.querySelector('[data-testid="pulse-count"]').textContent).toBe(`${n} of 4`);
    const text = container.querySelector('.hc').textContent;
    expect(text.match(new RegExp(`${n} of 4`, 'g'))).toHaveLength(1);
    expect(container.querySelector('[data-section="people"] summary').textContent).toMatch('4 here');
  });

  test('the late count in the pulse opens the Needs-you item\'s review', () => {
    const onLate = jest.fn();
    render(<ConsolePulse moment="ANSWERING" players={4} answered={2} late={1} onLate={onLate} now={0} />);
    fireEvent.click(screen.getByRole('button', { name: '1 late item not reviewed' }));
    expect(onLate).toHaveBeenCalled();
  });

  test('the host page wires the pulse from the server\'s round start, the phase stamps and the arrivals', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/const pulseOpenedAt = \(currentQuestion && currentQuestion\.startedAt\) \|\| seenFor\('ASK'\)/);
    expect(page).toMatch(/arrivals=\{arrivalsSince\(players, pulseOpenedAt\)\}/);
    expect(page).toMatch(/withoutRoomCount\(hostControls\.status, consoleMoment\)/);
    expect(page).toMatch(/pulse=\{consolePulse\}/);
  });
});
