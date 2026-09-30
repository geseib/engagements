/**
 * FULL SCREEN FOR THE HOST, AND A TALK'S SLIDES PRESENTED FULL SCREEN —
 * utils/fullscreen.js, hooks/useFullscreenKey.js, and their use on the host
 * screens (GameHostPage, HostEventAgenda) and the event's stage (EventStage).
 *
 * The owner, 28 Sep 2026: "two features i need 1\ hitting 'f' takes the
 * browser to full screen mode for the host. 2\ we need to be able to present
 * the slides in presos full screen as well."
 *
 * jsdom has no Fullscreen API, so a small fake stands in for the browser: it
 * keeps the stack of full-screen elements the way the spec does (an element
 * asked for over the page sits on top of it; exitFullscreen pops one; Esc
 * empties it) and fires `fullscreenchange`. What is pinned is what the pages
 * ask of it and what they do with the answer. That the slide fills a real
 * screen was measured in Chromium (see the commit).
 *
 * rejects: F that does nothing on a host screen; F while typing, with a
 * modifier (Ctrl/Cmd+F is the browser's find), or held down; a phone page
 * that takes F; a "Full screen" button where the browser has none; F on a
 * talk that makes the page full screen instead of the slide; Space or a click
 * that walks the room out of a presented talk instead of turning the slide;
 * a present mode that outlives Esc; F from a presented slide that leaves full
 * screen altogether rather than stepping back to the stage; a letterbox that
 * is not black, a pointer that never hides, or a cue that takes the slide's
 * clicks.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  canFullscreen, fullscreenElement, isFullscreenKey, toggleFullscreen,
} from '../utils/fullscreen';
import useFullscreenKey from '../hooks/useFullscreenKey';
import EventStage from '../components/event/EventStage';

jest.mock('../utils/eventsApi', () => ({
  getEvent: jest.fn(),
  runEvent: jest.fn(),
  readDeck: jest.fn(),
  turnPage: jest.fn(),
}));
jest.mock('../utils/pdfDeck', () => ({
  openPdfAt: jest.fn(),
  drawPage: jest.fn(() => Promise.resolve(true)),
  countPages: jest.fn(),
  isCancelled: () => false,
}));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));
jest.mock('../hooks/useStageFit', () => () => {});

const api = require('../utils/eventsApi');
const pdf = require('../utils/pdfDeck');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/** The browser's full screen, as the spec keeps it. */
function installFullscreen() {
  const stack = [];
  const changed = () => document.dispatchEvent(new Event('fullscreenchange'));
  Element.prototype.requestFullscreen = jest.fn(function requestFullscreen() {
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    stack.push(this);
    changed();
    return Promise.resolve();
  });
  document.exitFullscreen = jest.fn(() => {
    stack.pop();
    changed();
    return Promise.resolve();
  });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stack[stack.length - 1] || null });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  return {
    stack,
    /** The user's Esc: the browser leaves full screen altogether, and the page is only told. */
    esc: () => { stack.length = 0; changed(); },
  };
}
function uninstallFullscreen() {
  delete Element.prototype.requestFullscreen;
  delete document.exitFullscreen;
  delete document.fullscreenElement;
  delete document.fullscreenEnabled;
}

const press = (k, init = {}, target = document.body) => fireEvent.keyDown(target, { key: k, ...init });

describe('utils/fullscreen', () => {
  afterEach(uninstallFullscreen);

  test('F is F, in either case, and nothing else is', () => {
    const on = (init) => isFullscreenKey({ target: document.body, ...init });
    expect(on({ key: 'f' })).toBe(true);
    expect(on({ key: 'F' })).toBe(true);
    expect(on({ key: 'g' })).toBe(false);
    expect(on({ key: 'f', ctrlKey: true })).toBe(false); // the browser's find
    expect(on({ key: 'f', metaKey: true })).toBe(false);
    expect(on({ key: 'f', altKey: true })).toBe(false);
    expect(on({ key: 'f', repeat: true })).toBe(false);
    expect(on({ key: 'f', defaultPrevented: true })).toBe(false);
  });

  test('a typing target, or the session panel, keeps its F', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { get: () => true });
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const inPanel = document.createElement('button');
    panel.appendChild(inPanel);
    document.body.appendChild(panel);
    for (const target of [input, area, editable, inPanel]) {
      expect(isFullscreenKey({ key: 'f', target })).toBe(false);
    }
    panel.remove();
  });

  test('no Fullscreen API: nothing to offer, and asking does not throw', async () => {
    expect(canFullscreen()).toBe(false);
    expect(fullscreenElement()).toBeNull();
    await expect(toggleFullscreen()).resolves.toBe(false);
  });

  test('toggle: in, out, and a switch when something else is full screen', async () => {
    const fake = installFullscreen();
    expect(canFullscreen()).toBe(true);
    const slide = document.createElement('div');
    document.body.appendChild(slide);

    await toggleFullscreen();
    expect(fullscreenElement()).toBe(document.documentElement);
    await toggleFullscreen(slide);
    expect(fullscreenElement()).toBe(slide);
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    await toggleFullscreen(slide);
    expect(fullscreenElement()).toBe(document.documentElement); // one step back
    await toggleFullscreen();
    expect(fullscreenElement()).toBeNull();
    expect(fake.stack).toEqual([]);
    slide.remove();
  });

  test('the prefixed API alone (older Safari) is used, and a refusal resolves false', async () => {
    const el = document.createElement('div');
    el.webkitRequestFullscreen = jest.fn(() => { throw new Error('no gesture'); });
    await expect(toggleFullscreen(el)).resolves.toBe(false);
    expect(el.webkitRequestFullscreen).toHaveBeenCalled();
  });
});

function Probe() {
  useFullscreenKey();
  return <input aria-label="Event title" />;
}

describe('hooks/useFullscreenKey on a host page', () => {
  let fake;
  beforeEach(() => { fake = installFullscreen(); });
  afterEach(uninstallFullscreen);

  test('F takes the whole page full screen, and F again brings it back', () => {
    render(<Probe />);
    press('f');
    expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(Element.prototype.requestFullscreen.mock.instances[0]).toBe(document.documentElement);
    expect(fullscreenElement()).toBe(document.documentElement);
    press('F');
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fake.stack).toEqual([]);
  });

  test('typing an F, Ctrl+F and a held F change nothing', () => {
    render(<Probe />);
    press('f', {}, screen.getByLabelText('Event title'));
    press('f', { ctrlKey: true });
    press('f', { metaKey: true });
    press('f', { repeat: true });
    expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
  });

  test('gone with the page: an unmounted page no longer takes F', () => {
    const { unmount } = render(<Probe />);
    unmount();
    press('f');
    expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
  });
});

describe('where F is bound', () => {
  test('the host main screen and session stage, and the host\'s agenda page, take F', () => {
    const host = read('GameHostPage.jsx');
    expect(host).toMatch(/import useFullscreenKey from '\.\/hooks\/useFullscreenKey';/);
    // Above the page's first early return, like every key hook there.
    const call = host.indexOf('useFullscreenKey();');
    expect(call).toBeGreaterThan(0);
    expect(call).toBeLessThan(host.indexOf('if (showQuickstartMenu) {'));
    expect(read('components', 'event', 'HostEventAgenda.jsx')).toMatch(/useFullscreenKey\(\);/);
    expect(read('components', 'event', 'EventStage.jsx')).toMatch(/useFullscreenKey\(\{ enabled: !confirmEndEvent && !confirmEnd && !qrOpen, target: \(\) => deckFrame\.current \}\)/);
  });

  test('no phone page takes F: it is a letter there', () => {
    // The player, an event's attendee page, and the host's phone remote.
    for (const file of [['PlayerPage.jsx'], ['components', 'event', 'EventAttendeePage.jsx'], ['HostRemote.jsx']]) {
      expect(read(...file)).not.toMatch(/useFullscreenKey|utils\/fullscreen/);
    }
  });

  test('the host help lists F with the other stage keys', () => {
    const help = read('config', 'help', 'host.js');
    expect(help).toMatch(/\{ keys: 'F', text: 'Full screen, and back again\. Esc also leaves\./);
  });
});

// ── The event's stage ────────────────────────────────────────────────────
const CODE = '5307';
const EVENT = {
  code: CODE, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
  endsAt: '10:05', state: 'SCHEDULED', liveItemId: '', attendeeCount: 12, rev: 'r0',
};
const DECK = { id: '0123456789abcdef', name: 'FY26 review.pdf', pages: 12, bytes: 3400000 };
const item = (n, type, title, extra = {}) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', ledBy: '', minutes: 15,
  at: `9:${n}0`, until: `9:${n}5`, state: 'planned', ...extra,
});
const TALK = item(2, 'presentation', 'FY26 in review', { ledBy: 'Dana Whitfield', deck: DECK, deckPage: 5 });
const DAY = [item(1, 'trivia', 'Warm-up'), TALK, item(3, 'call-and-answer', 'What slows us down?')];
const VIEW = { event: EVENT, items: DAY };
const DOC = { numPages: 12, destroy: jest.fn() };

const frame = () => document.querySelector('.ag-deck-frame');
const at = () => document.querySelector('.ag-deck-at').textContent;

async function openTalk() {
  window.history.pushState({}, '', `/host/event/${CODE}?focus=${TALK.itemId}`);
  api.getEvent.mockResolvedValue(VIEW);
  render(<EventStage code={CODE} />);
  await screen.findByText('Slide 5 of 12');
  await waitFor(() => expect(pdf.drawPage).toHaveBeenCalled());
}

/** jsdom measures nothing: give the slide's box a size, by class. */
function stubBox(className, width, height) {
  const w = jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function cw() {
    return this.classList && this.classList.contains(className) ? width : 0;
  });
  const hgt = jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function ch() {
    return this.classList && this.classList.contains(className) ? height : 0;
  });
  return () => { w.mockRestore(); hgt.mockRestore(); };
}

describe('the event\'s stage: a talk presented full screen', () => {
  let fake;
  let restoreBox = () => {};
  afterEach(() => restoreBox());
  beforeEach(() => {
    jest.clearAllMocks();
    restoreBox = stubBox('ag-deck-slide', 900, 506);
    api.readDeck.mockResolvedValue({ deck: { id: DECK.id, url: 'https://media.test/decks/x.pdf', pages: 12, page: 5 } });
    api.turnPage.mockImplementation(async (code, itemId, page) => ({ itemId, page }));
    api.runEvent.mockResolvedValue(VIEW);
    pdf.openPdfAt.mockResolvedValue(DOC);
  });
  afterEach(uninstallFullscreen);

  test('where the browser has no full screen, there is no button to press', async () => {
    await openTalk();
    expect(screen.queryByRole('button', { name: 'Present the slides full screen' })).toBeNull();
    press('f'); // and F does nothing, quietly
    expect(frame()).not.toHaveAttribute('data-presenting');
  });

  test('F on a talk presents the SLIDE, not the page: the frame takes the screen, with a cue', async () => {
    fake = installFullscreen();
    await openTalk();
    press('f');
    expect(Element.prototype.requestFullscreen.mock.instances[0]).toBe(frame());
    expect(frame()).toHaveAttribute('data-presenting');
    expect(frame()).toHaveAttribute('data-cue');
    expect(document.activeElement).toBe(frame());
    const cue = screen.getByTestId('present-cue');
    expect(cue).toHaveTextContent('Slide 5 of 12');
    expect(cue).toHaveTextContent('F or Esc to leave full screen');
    expect(fake.stack).toEqual([frame()]);
  });

  test('the "Full screen" button does the same', async () => {
    installFullscreen();
    await openTalk();
    const button = screen.getByRole('button', { name: 'Present the slides full screen' });
    expect(button).toHaveTextContent('Full screen');
    fireEvent.click(button);
    expect(Element.prototype.requestFullscreen.mock.instances[0]).toBe(frame());
    expect(frame()).toHaveAttribute('data-presenting');
    // Focus left the button: Enter or Space there would press it again.
    expect(document.activeElement).toBe(frame());
  });

  test('presenting, Space, the arrows, the clicker\'s keys and a click all turn the slide; nothing takes the dock\'s step', async () => {
    installFullscreen();
    await openTalk();
    press('f');
    press(' ', {}, frame());
    expect(at()).toBe('Slide 6 of 12');
    press(' ', { shiftKey: true }, frame());
    expect(at()).toBe('Slide 5 of 12');
    press('ArrowRight', {}, frame());
    press('PageDown', {}, frame());
    expect(at()).toBe('Slide 7 of 12');
    press('PageUp', {}, frame());
    expect(at()).toBe('Slide 6 of 12');
    fireEvent.click(document.querySelector('.ag-deck-slide canvas'));
    expect(at()).toBe('Slide 7 of 12');
    expect(screen.getByTestId('present-cue')).toHaveTextContent('Slide 7 of 12');
    await waitFor(() => expect(api.turnPage).toHaveBeenCalledWith(CODE, TALK.itemId, 7));
    // Turning a slide is not a step of the day: nothing went live.
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  test('Esc (the browser\'s own exit) ends presenting, and Space is the dock\'s step again', async () => {
    fake = installFullscreen();
    await openTalk();
    press('f');
    expect(frame()).toHaveAttribute('data-presenting');
    act(() => fake.esc());
    expect(frame()).not.toHaveAttribute('data-presenting');
    expect(screen.queryByTestId('present-cue')).toBeNull();
    // A click on the slide is only a click again.
    fireEvent.click(document.querySelector('.ag-deck-slide canvas'));
    expect(at()).toBe('Slide 5 of 12');
    press(' ');
    await waitFor(() => expect(api.runEvent).toHaveBeenCalled());
  });

  test('from a page already full screen, F presents the slide, and F again steps back to the page', async () => {
    fake = installFullscreen();
    await openTalk();
    await act(() => document.documentElement.requestFullscreen());
    press('f');
    expect(fake.stack).toEqual([document.documentElement, frame()]);
    expect(frame()).toHaveAttribute('data-presenting');
    press('f');
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fake.stack).toEqual([document.documentElement]);
    expect(frame()).not.toHaveAttribute('data-presenting');
  });

  test('the cue and the pointer go once the slide settles, and come back with a move', async () => {
    installFullscreen();
    await openTalk();
    jest.useFakeTimers();
    try {
      press('f');
      expect(frame()).toHaveAttribute('data-cue');
      act(() => { jest.advanceTimersByTime(2600); });
      expect(frame()).not.toHaveAttribute('data-cue');
      expect(frame()).toHaveAttribute('data-presenting');
      fireEvent.mouseMove(frame());
      expect(frame()).toHaveAttribute('data-cue');
      act(() => { jest.advanceTimersByTime(2600); });
      press('ArrowRight', {}, frame());
      expect(frame()).toHaveAttribute('data-cue');
    } finally {
      jest.useRealTimers();
    }
  });

  test('on the board, with no slides up, F takes the whole stage full screen', async () => {
    installFullscreen();
    window.history.pushState({}, '', `/host/event/${CODE}`);
    api.getEvent.mockResolvedValue(VIEW);
    render(<EventStage code={CODE} />);
    await screen.findByText('Warm-up');
    press('f');
    expect(Element.prototype.requestFullscreen.mock.instances[0]).toBe(document.documentElement);
    expect(frame()).toBeNull();
  });
});

// ── The stylesheet (jsdom lays nothing out; the design is read as text) ──
const AG_CSS = read('components', 'event', 'EventStage.css');
const GLOBAL_CSS = read('styles.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
  return m[2];
}
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return hex(m[1]);
}

describe('presenting, as the stylesheet draws it', () => {
  const ground = token(AG_CSS, '.ag-stage-root {', '--ag-present-ground');

  test('the letterbox is black, the slide loses its hairline, and the pointer hides until a move', () => {
    expect(ground).toEqual([0, 0, 0]);
    const on = rule(AG_CSS, '.ag-deck-frame[data-presenting]');
    expect(on).toMatch(/background:\s*var\(--ag-present-ground\)/);
    expect(on).toMatch(/cursor:\s*none/);
    expect(rule(AG_CSS, '.ag-deck-frame[data-presenting][data-cue]')).toMatch(/cursor:\s*default/);
    expect(rule(AG_CSS, '.ag-deck-frame[data-presenting] .ag-deck-slide canvas')).toMatch(/box-shadow:\s*none/);
  });

  test('the cue never takes a click from the slide, fades rather than blinks, and rides the ladder', () => {
    const cue = rule(AG_CSS, '.ag-deck-cue');
    expect(cue).toMatch(/pointer-events:\s*none/);
    expect(cue).toMatch(/position:\s*absolute/);
    expect(cue).toMatch(/opacity:\s*0/);
    expect(cue).toMatch(/font-size:\s*var\(--t-meta\)/);
    expect(rule(AG_CSS, '.ag-deck-frame[data-cue] .ag-deck-cue')).toMatch(/opacity:\s*1/);
    expect(stripped(AG_CSS)).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ag-deck-cue\s*\{\s*transition:\s*none/);
  });

  test.each([
    ['"Slide 3 of 12", --text on black', '--text'],
    ['"F or Esc to leave full screen", --muted on black', '--muted'],
  ])('%s clears AA', (_label, name) => {
    expect(ratio(token(GLOBAL_CSS, '[data-theme="dark"] {', name), ground)).toBeGreaterThanOrEqual(4.5);
  });

  test('"Full screen" is as easy to hit as ‹ ›, on the stage ladder', () => {
    const button = rule(AG_CSS, '.ag-deck-present');
    expect(Number((button.match(/min-height:\s*(\d+)px/) || [])[1])).toBeGreaterThanOrEqual(48);
    expect(button).toMatch(/font-size:\s*var\(--t-meta\)/);
    expect(button).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
