/**
 * THE ROOM'S WINDOW, SHARED BY CALL & ANSWER AND THE BUILD ROOM (owner,
 * 19 Oct 2026, items 1, 3 and 4; walk of 18 Oct W2, W3, T3).
 *
 *   - RoomWindowStatus, the top-line part both hosts draw: the link, the
 *     window's state, Open as a tab (placed=1) and one visible line on a
 *     laptop with no second display; the fill instruction while it is open
 *     but not full screen
 *   - the Screens group's window row (state alone, Open ↗, the same offer)
 *   - one fill instruction everywhere (W3)
 *   - 'build' in TWO_SURFACE_TYPES, and each reader of it
 *   - the chooser's words for a Build Room
 * NO GEOMETRIC ASSERTIONS.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import RoomWindowStatus from '../components/stage/RoomWindowStatus';
import RoomWindowLink, { RoomWindowTab } from '../components/stage/RoomWindowLink';
import ScreensGroup from '../components/stage/ScreensGroup';
import RoomScreenChooser from '../components/stage/RoomScreenChooser';
import ConsoleTop from '../components/console/ConsoleTop';
import { FILL_ONCE, presentStatusFrom, windowIsOpen } from '../config/presentStatus';
import {
  SCREEN_WORDS, ROOM_WORDS, roomWordsFor, screenWordsFor, recommendRoomScreen,
} from '../config/roomScreen';
import { TWO_SURFACE_TYPES, twoSurfacesOn } from '../config/surfaces';

const HREF = '/present?gameId=4821&type=build&k=abc';
const UP = { open: true, fullscreen: true, visible: true, ageMs: 1000 };
const WINDOWED = { ...UP, fullscreen: false };

/** A Chrome with the Window Management API and a second display: the link places the window. */
function withSecondDisplay(fn) {
  const had = Object.getOwnPropertyDescriptor(window.screen, 'isExtended');
  window.getScreenDetails = jest.fn(async () => ({ screens: [] }));
  Object.defineProperty(window.screen, 'isExtended', { value: true, configurable: true });
  try { fn(); } finally {
    delete window.getScreenDetails;
    if (had) Object.defineProperty(window.screen, 'isExtended', had);
    else delete window.screen.isExtended;
  }
}

describe('one instruction for filling the screen (W3)', () => {
  test('the status hint, the Screens words and the placing link say the same sentence', () => {
    expect(FILL_ONCE).toBe("Click the room's window once to fill the screen (or press F)");
    expect(presentStatusFrom(WINDOWED).hint).toBe(FILL_ONCE);
    expect(SCREEN_WORDS.fillOnce).toBe(FILL_ONCE);
    withSecondDisplay(() => {
      render(<RoomWindowLink href={HREF}>Open</RoomWindowLink>);
      expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('title', `Opens on your other display. ${FILL_ONCE}.`);
    });
  });
  test('the old two instructions are gone from the shared words', () => {
    const src = ['config/presentStatus.js', 'components/stage/RoomWindowLink.jsx']
      .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
    expect(src).not.toMatch('Press F on that window');
    expect(src).not.toMatch('Click it once to fill the screen');
  });
  test('every state has its short form for a row that already names the window (W2)', () => {
    expect(presentStatusFrom(UP).short).toBe('On, full screen');
    expect(presentStatusFrom(WINDOWED).short).toBe('Open, not full screen');
    expect(presentStatusFrom({ ...UP, visible: false }).short).toBe('Hidden');
    expect(presentStatusFrom(null).short).toBe('Not open');
  });
  test('windowIsOpen: a viewer row and a fresh report; stale or none is not open', () => {
    expect(windowIsOpen(1, UP)).toBe(true);
    expect(windowIsOpen(1, WINDOWED)).toBe(true);
    expect(windowIsOpen(0, UP)).toBe(false);
    expect(windowIsOpen(1, null)).toBe(false);
    expect(windowIsOpen(1, { ...UP, ageMs: 10 * 60 * 1000 })).toBe(false);
  });
});

describe('Open as a tab (item 4)', () => {
  test('a real link to the room\'s window with placed=1, so its fill cue and first click work', () => {
    render(<RoomWindowTab href={HREF} />);
    const a = screen.getByRole('link', { name: 'Open as a tab' });
    expect(a).toHaveAttribute('href', `${HREF}&placed=1`);
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('title', SCREEN_WORDS.openTabHint);
  });
  test('placed=1 is never doubled, and with no address there is nothing to open', () => {
    const { container } = render(<><RoomWindowTab href={`${HREF}&placed=1`} /><RoomWindowTab href="" /></>);
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a').getAttribute('href')).toBe(`${HREF}&placed=1`);
  });
});

describe('RoomWindowStatus: the top-line part', () => {
  test('not open, no second display: the link, the state, Open as a tab and the line', () => {
    render(<RoomWindowStatus href={HREF} detail={null} />);
    expect(screen.getByRole('link', { name: "Room's window ↗" })).toHaveAttribute('href', HREF);
    expect(screen.getByRole('link', { name: "Room's window: not open" })).toHaveAttribute('href', HREF);
    expect(screen.getByRole('link', { name: 'Open as a tab' })).toHaveAttribute('href', `${HREF}&placed=1`);
    expect(screen.getByText('No second display? Open it in a tab and share that tab, or press F.')).toBeInTheDocument();
  });
  test('open, not full screen: the fill instruction as text, no tab offer', () => {
    render(<RoomWindowStatus href={HREF} detail={WINDOWED} />);
    expect(screen.getByRole('status')).toHaveTextContent("Room's window: open, not full screen");
    expect(screen.getByText(FILL_ONCE)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open as a tab' })).toBeNull();
  });
  test('on, full screen: nothing to say, the line keeps its place', () => {
    const { container } = render(<RoomWindowStatus href={HREF} detail={UP} />);
    expect(container.querySelector('.rws-note')).toHaveTextContent(/^$/);
  });
  test('short: the state alone shows, a reader hears it whole', () => {
    render(<RoomWindowStatus href={HREF} detail={UP} short />);
    const s = screen.getByRole('status');
    expect(s).toHaveTextContent("Room's window: On, full screen");
    expect(s.querySelector('.rws-sr')).toHaveTextContent("Room's window:");
  });
  test('with a second display the link places the window: no tab offer, no line', () => {
    withSecondDisplay(() => {
      render(<RoomWindowStatus href={HREF} detail={null} />);
      expect(screen.queryByRole('link', { name: 'Open as a tab' })).toBeNull();
      expect(screen.queryByText(SCREEN_WORDS.noSecondDisplay)).toBeNull();
    });
  });
  test('the host surface\'s own classes go on the link and the pill', () => {
    const { container } = render(<RoomWindowStatus href={HREF} detail={UP} classes={{ link: 'hc-btn', stat: 'hc-winstat', dot: 'hc-dot' }} />);
    expect(container.querySelector('a.hc-btn')).not.toBeNull();
    expect(container.querySelector('.hc-winstat.is-success .hc-dot')).not.toBeNull();
  });
  test('no address: nothing at all', () => {
    const { container } = render(<RoomWindowStatus href="" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('Call & Answer gets the same (item 4 is both types)', () => {
  test('the console\'s top line offers Open as a tab and says what to do while the window is not open', () => {
    render(<ConsoleTop title="Relay" code="7924" onJoin={() => {}} presentHref="/present?gameId=7924" presentDetail={null} />);
    const top = document.querySelector('.hc-top');
    expect(within(top).getByRole('link', { name: 'Open as a tab' })).toHaveAttribute('href', '/present?gameId=7924&placed=1');
    expect(top.textContent).toMatch(SCREEN_WORDS.noSecondDisplay);
    expect(top.querySelector('.hc-winstat.is-muted')).not.toBeNull();
  });
  test('the Screens group on two screens: the state alone, Open ↗, Open as a tab and the line', () => {
    render(<ScreensGroup choice="two" offerChoice presentHref="/present?gameId=1" presentDetail={null} />);
    const row = document.querySelector('[data-row="window"]');
    expect(within(row).getByText("Room's window")).toBeInTheDocument();
    expect(within(row).getByRole('status')).toHaveTextContent(/^Not open$/);
    expect(within(row).getByRole('link', { name: 'Open ↗' })).toHaveAttribute('href', '/present?gameId=1');
    expect(within(row).getByRole('link', { name: 'Open as a tab' })).toHaveAttribute('href', '/present?gameId=1&placed=1');
    expect(row.textContent).toMatch(SCREEN_WORDS.noSecondDisplay);
  });
  test('the Screens group, open but not full screen: the instruction is shown, not a tooltip', () => {
    render(<ScreensGroup choice="two" offerChoice presentHref="/present?gameId=1" presentDetail={WINDOWED} />);
    expect(document.querySelector('[data-row="window"]').textContent).toMatch(FILL_ONCE);
  });
});

describe('two screens covers the Build Room (item 3)', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  test('build is in TWO_SURFACE_TYPES: on by default on dev only, as Call & Answer', () => {
    expect(TWO_SURFACE_TYPES).toEqual(['call-and-answer', 'build']);
    expect(twoSurfacesOn({ env: 'development', search: '', storage: memory(), gameType: 'build' })).toBe(true);
    for (const env of ['test', 'production', undefined]) {
      expect(twoSurfacesOn({ env, search: '', storage: memory(), gameType: 'build' })).toBe(false);
    }
  });
  test('each reader of the list holds with build in it', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    // The Remote's PRESENT has no wall key: it refuses a Build Room itself.
    expect(read('HostRemote.jsx')).toMatch(/gameType !== 'build' && twoSurfacesHere\(gameType\) \?/);
    // Quick start lists no Build Room sets, so its "where the room watches" never asks for one.
    const quick = read('components/QuickstartMenu.jsx');
    expect(quick).not.toMatch(/'build': \[\]/);
    // The round types' panel and Setup are GameHostPage's; a Build Room session never reaches it.
    expect(read('App.jsx')).toMatch(/if \(\/\^\\\/build\\\/\?\$\/\.test\(path\)\)/);
    // The lobby chooser stays Call & Answer's own.
    expect(read('GameHostPage.jsx')).toMatch(/normalizeGameType\(currentGameType\) === 'call-and-answer'\n\s*&& \(roomScreenChoice === null \|\| roomScreenOpen\)/);
  });
});

describe('the chooser\'s words for a Build Room', () => {
  test('the same question, Help me pick, and its own words for what stays private', () => {
    const B = roomWordsFor('build');
    expect(B.heading).toBe(ROOM_WORDS.heading);
    expect(B.helpMePick).toBe(ROOM_WORDS.helpMePick);
    expect(JSON.stringify(B)).not.toMatch(/Workie|Remote|in Setup/);
    expect(roomWordsFor('call-and-answer')).toBe(ROOM_WORDS);
    expect(screenWordsFor('build').whereHintTwo).toBe("This laptop stays where it is; 2, 3 and 4 change the room's window");
    expect(screenWordsFor('')).toBe(SCREEN_WORDS);
  });
  test('the recommendation names no Remote for a Build Room', () => {
    const one = recommendRoomScreen({ connected: 'yes', picture: 'copy', private: 'yes' }, 'build');
    expect(one.choice).toBe('classic');
    expect(one.detail).not.toMatch(/Remote|Workie/);
    expect(recommendRoomScreen({ connected: 'no' }, 'build').detail).toMatch('Session, Settings, Screens');
    // Call & Answer's words are unchanged.
    expect(recommendRoomScreen({ connected: 'yes', picture: 'copy', private: 'yes' }).detail).toMatch('Remote');
  });
  test('the chooser draws them', () => {
    render(<RoomScreenChooser type="build" current={null} presentHref={HREF} onChoose={() => {}} />);
    const q = screen.getByRole('region', { name: 'Where will the room watch?' });
    expect(q.textContent).toMatch(roomWordsFor('build').twoBody);
    expect(q.textContent).toMatch('Session, Settings, Screens');
  });
});
