/**
 * THE ONE-SCREEN STAGE TAKES THE CONSOLE'S FRAME (experience plan §3.3, §3.6;
 * Phase 2 step 2h). On one screen the laptop is the room's screen; it draws
 * the SAME top bar as the console (components/console/ConsoleTop.jsx, the
 * words from config/hostWords.js) and puts Your part now directly under it,
 * slim, so the main button is in the same place on one screen as on two.
 *
 *   - the top bar's slots, in the console's order, with the two one-screen
 *     words ("Show join code", "The room sees this screen");
 *   - Needs you on the bar is a count, never a name; the Needs-you line under
 *     Your part now is a count by kind with one Open, never a name and never
 *     Let them / Not now (PLAN principle 3, §3.3);
 *   - Your part now holds the main button, under the bar, and the stage has
 *     no bottom dock;
 *   - one place for each thing: Main menu, the Session menu, `?` and the bell
 *     are the bar's, never also in Your part now.
 *
 * DOM order and attributes only: jsdom has no layout engine. The pixels (every
 * phase of the five one-screen types, four sizes, four profiles) were measured
 * in Chromium; stageFramePalette.test.js records them.
 *
 * // rejects: the bottom dock's Main menu / SESSION / bell / ? left beside the
 * //          top bar's (two of each on one screen).
 * // rejects: a name on the room's screen through the bar or the line.
 * // rejects: the main button anywhere but directly under the top bar.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ConsoleTop from '../components/console/ConsoleTop';
import Stage from '../components/stage/Stage';
import Dock from '../components/stage/Dock';
import HostActionBar from '../components/HostActionBar';
import OneScreenNeedsBell from '../components/needs/OneScreenNeedsBell';
import PublicNeedsLine from '../components/needs/PublicNeedsLine';
import HW, { TOP_SLOTS } from '../config/hostWords';
import RW from '../config/roundWords';
import { needsYou } from '../config/needsYou';

jest.mock('../utils/libraries', () => ({ fetchOrgs: () => Promise.resolve([]), librariesFrom: () => [] }));

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const asking = needsYou({
  players: [{ name: 'Sam Okafor', handover: { requested: true, requestedAt: new Date().toISOString() } }],
  late: { notReviewed: 2, answers: 2 },
});
const calm = needsYou({});
const soonOnly = needsYou({ late: { notReviewed: 2, answers: 2 } });

const controls = {
  primary: { id: 'open-vote', label: 'Start voting', intent: 'finish', icon: 'ListChecks' },
  secondary: { id: 'skip', label: 'Skip this round', intent: 'skip', icon: 'SkipForward' },
  status: { text: '' },
};

function oneScreenTop(over = {}) {
  return (
    <ConsoleTop
      title="Q4 planning retro"
      code="7924"
      oneScreen
      onJoin={() => {}}
      joinPressed={false}
      help="host-dock"
      onLeave={() => {}}
      onSessionMenu={() => {}}
      bell={<OneScreenNeedsBell variant="top" needs={asking} onAct={() => {}} oneScreen />}
      {...over}
    />
  );
}

function frame({ needs = asking } = {}) {
  return render(
    <Stage
      profile="room"
      phase="ASK"
      top={oneScreenTop({ bell: <OneScreenNeedsBell variant="top" needs={needs} onAct={() => {}} oneScreen /> })}
      now={(
        <Dock lead={RW.yourPartLabel} status="Some are still answering" kbd="SPACE">
          <HostActionBar controls={controls} onAction={() => {}} bigScreen />
        </Dock>
      )}
      needs={<PublicNeedsLine needs={needs} onOpen={() => {}} />}
      rail={<header className="rail">ANSWERING</header>}
    >
      <div className="content" />
    </Stage>
  );
}

const slotsOf = (root) => [...root.querySelectorAll('.hc-top [data-slot]')].map((n) => n.getAttribute('data-slot'));

describe('the top bar on one screen: the console\'s slots, in its order', () => {
  test('Main menu · name · Join · the room\'s screen · Needs you · ? · Session menu', () => {
    const { container } = render(oneScreenTop());
    const slots = slotsOf(container);
    expect(slots).toEqual(['main-menu', 'name', 'join', 'room-screen', 'needs-you', 'help', 'session-menu']);
    // The same order the console's words file fixes (connection only when broken).
    expect(slots).toEqual(TOP_SLOTS.filter((s) => s !== 'connection'));
  });

  test('the connection takes its slot only when broken, between the room\'s screen and the bell', () => {
    const { container } = render(oneScreenTop({ connected: false }));
    expect(slotsOf(container)).toEqual(TOP_SLOTS);
  });

  test('two words change: "Show join code" in Join\'s place, "The room sees this screen" in the room\'s-window place', () => {
    const { container, rerender } = render(oneScreenTop());
    const join = container.querySelector('[data-slot="join"]');
    expect(join).toHaveTextContent(HW.showJoinCode);
    expect(join).toHaveAttribute('aria-pressed', 'false');
    // The code itself is the rail's, for the room to read; the bar does not repeat it.
    expect(join.textContent).not.toMatch(/7924/);
    const room = container.querySelector('[data-slot="room-screen"]');
    expect(room).toHaveTextContent(HW.roomSeesThisScreen);
    expect(room.tagName).toBe('SPAN');
    expect(room.querySelector('a')).toBeNull();
    rerender(oneScreenTop({ joinPressed: true }));
    expect(container.querySelector('[data-slot="join"]')).toHaveTextContent(HW.hideJoinCode);
    expect(container.querySelector('[data-slot="join"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('on two screens the bar is unchanged: Join and the code, the room\'s window as a link', () => {
    const { container } = render(oneScreenTop({ oneScreen: false, bell: null, presentHref: '/present?gameId=7924' }));
    expect(container.querySelector('[data-slot="join"]')).toHaveTextContent(`${HW.join} 7924`);
    expect(container.querySelector('[data-slot="room-screen"] a')).not.toBeNull();
  });
});

describe('Needs you on the room\'s screen: counts, never names', () => {
  test('the bar\'s bell is always in its slot, says Needs you and a count, and no name', () => {
    const { container, rerender } = render(oneScreenTop());
    const bell = within(container.querySelector('[data-slot="needs-you"]')).getByTestId('needs-bell');
    expect(bell).toHaveTextContent(`${HW.needsYou}1`);
    expect(bell.textContent + bell.getAttribute('aria-label') + bell.getAttribute('title')).not.toMatch(/Sam|Okafor/);
    // With nothing waiting the slot still holds the bell: the bar never moves.
    rerender(oneScreenTop({ bell: <OneScreenNeedsBell variant="top" needs={calm} onAct={() => {}} oneScreen /> }));
    expect(within(container.querySelector('[data-slot="needs-you"]')).getByTestId('needs-bell')).toHaveTextContent(HW.needsYou);
    expect(container.querySelector('[data-testid="needs-bell-count"]')).toBeNull();
  });

  test('the bell opens the one-screen sheet from Phase 1: "The room can see this screen", by kind', () => {
    render(oneScreenTop());
    fireEvent.click(screen.getByTestId('needs-bell'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('The room can see this screen');
    expect(sheet.textContent).not.toMatch(/Sam/);
  });

  test('the line: waiting is a count by kind and one Open; never a name, never Let them / Not now', () => {
    const onOpen = jest.fn();
    render(<PublicNeedsLine needs={asking} onOpen={onOpen} />);
    const line = screen.getByTestId('needs-line');
    expect(line).toHaveClass('is-waiting');
    expect(line).toHaveAttribute('data-public');
    expect(line).toHaveTextContent('1 name request · 2 late answers to review');
    expect(line.textContent).not.toMatch(/Sam|Okafor/);
    expect(within(line).queryByRole('button', { name: /Let them|Not now|See in People/ })).toBeNull();
    const buttons = within(line).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Open');
    fireEvent.click(buttons[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('the line: calm is the muted words, Soon items ride it as a count; "on your phone" only when connected', () => {
    const { rerender } = render(<PublicNeedsLine needs={calm} onOpen={() => {}} />);
    expect(screen.getByTestId('needs-line')).toHaveClass('is-calm');
    expect(screen.getByTestId('needs-line')).toHaveTextContent('Nothing needs you now.');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<PublicNeedsLine needs={soonOnly} onOpen={() => {}} />);
    expect(screen.getByTestId('needs-line')).toHaveClass('is-calm');
    expect(screen.getByTestId('needs-line')).toHaveTextContent('2 late answers to review');
    expect(screen.getByTestId('needs-line').textContent).not.toMatch(/on your phone/);
    rerender(<PublicNeedsLine needs={asking} onOpen={() => {}} remoteConnected />);
    expect(screen.getByTestId('needs-line')).toHaveTextContent('1 name request · 2 late answers to review · on your phone');
  });
});

describe('Your part now, directly under the top bar', () => {
  test('the frame\'s rows come first, in order, and the stage has no bottom dock', () => {
    const { container } = frame();
    const rows = [...container.querySelectorAll('.stage > *')].map((el) => el.className.split(' ')[0]);
    expect(rows.slice(0, 5)).toEqual(['field', 'stage-top', 'stage-now', 'stage-needs', 'rail']);
    expect(container.querySelector('.stage > .dock')).toBeNull();
    // Each frame row is dusk on its own (<html> is paper).
    ['stage-top', 'stage-now', 'stage-needs'].forEach((c) => {
      expect(container.querySelector(`.${c}`)).toHaveAttribute('data-theme', 'dark');
    });
  });

  test('the one orange button lives in Your part now, named, with its Space cap', () => {
    const { container } = frame();
    const now = container.querySelector('.stage-now');
    const part = within(now).getByRole('region', { name: RW.yourPartLabel });
    expect(part).toHaveClass('dock', 'dock--part');
    expect(part.querySelector('.dock-k')).toHaveTextContent(RW.yourPartLabel);
    const primary = within(part).getByRole('button', { name: 'Start voting' });
    expect(primary).toHaveClass('host-action-bar__primary');
    expect(primary.querySelector('.keycap')).toHaveTextContent('Space');
    expect(container.querySelectorAll('.host-action-bar__primary')).toHaveLength(1);
  });

  test('it holds still: the label first, the hint and the key legend before the buttons', () => {
    const { container } = render(
      <Dock lead={RW.yourPartLabel} status="Some are still answering" hint="Nobody has answered yet" kbd="">
        <HostActionBar controls={controls} onAction={() => {}} bigScreen keyHint="← back" />
      </Dock>
    );
    const part = container.querySelector('.dock--part');
    const kids = [...part.children];
    expect(kids[0]).toHaveClass('dock-k');
    const at = (sel) => kids.findIndex((k) => k.matches(sel));
    expect(at('.spacer')).toBeLessThan(at('.hint'));
    expect(at('.hint')).toBeLessThan(at('.host-action-bar'));
    // A Space that does nothing keeps its slot (dockStill), here too.
    expect(part.querySelector('.keycap')).toHaveAttribute('data-off');
    // The legend is ordered before the buttons in CSS, so it never slides them.
    expect(read('styles', 'stage.css')).toMatch(/\.dock\.dock--part \.host-action-bar__keyhint\{order:-1;/);
  });
});

describe('one place for each thing: nothing in both the top bar and Your part now', () => {
  test('rendered: one Main menu, one Session menu, one ?, one bell, and none of them in Your part now', () => {
    const { container } = frame();
    expect(screen.getAllByRole('button', { name: HW.mainMenu })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: HW.sessionMenu })).toHaveLength(1);
    expect(screen.getAllByTestId('needs-bell')).toHaveLength(1);
    expect(container.querySelectorAll('.help-button')).toHaveLength(1);
    const part = container.querySelector('.dock--part');
    expect(part.querySelector('.dock-main, .dock-help, .dock-needs, .dock-present, [data-testid="dock-main-menu"]')).toBeNull();
    expect(part.textContent).not.toMatch(/SESSION|AGENDA|PRESENT/);
  });

  test('the host page hands Your part now none of the bar\'s controls, and the stage no bottom dock', () => {
    const page = stripComments(read('GameHostPage.jsx'));
    const stage = page.slice(page.indexOf('<Stage\n'), page.indexOf('</Stage>'));
    expect(stage).toMatch(/\btop=\{\(\s*<ConsoleTop/);
    expect(stage).toMatch(/\bnow=\{\(\s*<Dock/);
    expect(stage).not.toMatch(/\bdock=\{/);
    // The steps strip is folded into the room's view on one screen (§3.3).
    expect(stage).toMatch(/strip=\{workflow && twoSurfaces\s*\?/);
    const part = stage.slice(stage.indexOf('<Dock'), stage.indexOf('</Dock>'));
    expect(part).toMatch(/lead=\{RW\.yourPartLabel\}/);
    ['onMainMenu=', 'onSetup=', 'help=', 'home=', 'onAgenda=', 'present='].forEach((prop) => {
      expect(part).not.toContain(prop);
    });
    // A LEAVE round button comes off: Main menu is the bar's.
    expect(part).toMatch(/controls=\{stageControls\}/);
    expect(page).toMatch(/const stageControls = splitLeave\(dockControls\)\.controls;/);
    // The rail keeps the code for the room (pointing at it still previews the
    // QR), but not the session's name, which the bar carries.
    const rail = stage.slice(stage.indexOf('<Rail'), stage.indexOf('/>', stage.indexOf('<Rail')));
    expect(rail).toMatch(/title=\{null\}/);
    // Agenda is the Session menu's, in an event.
    expect(page).toMatch(/onAgenda=\{eventCode \? \(\) => \{ closeAllSidePanels\(\); goToAgenda\(\); \} : null\}/);
  });
});

describe('Main menu always means the main menu (PLAN §3.6)', () => {
  test('requestLeave never goes to the agenda; it asks with people in the room, then goes home', () => {
    const page = stripComments(read('GameHostPage.jsx'));
    const leave = page.slice(page.indexOf('const requestLeave = () => {'), page.indexOf('const handleSwitchGame'));
    expect(leave).not.toMatch(/goToAgenda/);
    expect(leave).toMatch(/players\.length > 0/);
    expect(leave).toMatch(/setConfirmLeave\(true\)/);
    expect(leave).toMatch(/leaveToMainMenu\(\)/);
    // Leaving an event's item drops the event from the page, then goes home.
    const home = page.slice(page.indexOf('const leaveToMainMenu = () => {'), page.indexOf('const requestLeave'));
    expect(home).toMatch(/setEventCode\(''\)/);
    expect(home).toMatch(/handleSwitchGame\(\)/);
    // An ended item's own "Back to the agenda" primary (LEAVE in an event) still goes to the agenda.
    expect(page).toMatch(/case HOST_INTENTS\.LEAVE:\s*if \(eventCode\) goToAgenda\(\);\s*else requestLeave\(\);/);
  });
});
