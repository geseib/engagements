/**
 * THE BUILD ROOM'S WINDOW (docs/design/parity/PLAN.md §2.4, B7):
 * /present?gameId=…&type=build&k=… on the projector.
 *
 * It reads one public route (GET build-play/wall?k=), follows the server's
 * `wall.screen`, treats a frame as "look again" (never its payload), drops a
 * reply older than what it shows, says plainly when its link has changed or
 * the session is gone, reports itself with PRESENT_STATUS, and renders
 * nothing pressable and no name. The bodies are the server's own (build-store.js
 * wallView through roomFromRows, testing/buildWallFixture.js).
 */
import React, { Suspense } from 'react';
import {
  render, screen, act, waitFor, cleanup,
} from '@testing-library/react';
import webSocketClient from '../WebSocketClient';
import BuildWall from '../present/buildwall/BuildWall';
import PresentPage from '../PresentPage';
import { REFETCH_DEBOUNCE_MS, WALL_POLL_MS } from '../present/buildwall/useBuildWall';
import { W } from '../buildroom/words';

jest.mock('../WebSocketClient', () => {
  const handlers = new Map();
  return {
    __esModule: true,
    default: {
      handlers,
      connect: jest.fn(() => true),
      disconnect: jest.fn(),
      isConnected: jest.fn(() => true),
      onMessage: jest.fn((type, fn) => handlers.set(type, fn)),
      offMessage: jest.fn((type) => handlers.delete(type)),
      onReconnected: jest.fn(function (fn) { this.reconnected = fn; }),
      sendCleanMessage: jest.fn(() => true),
      onConnectionStatusChange: jest.fn(),
    },
  };
});

const F = require('../testing/buildWallFixture');

const KEY = 'wall_key-ABC123';
const API = 'https://api.test.invalid/dev/';
const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

let queue;
beforeEach(() => {
  jest.useFakeTimers();
  window.API_BASE = API;
  queue = [];
  webSocketClient.handlers.clear();
  // Installed per test: a runner with resetMocks on (react-scripts) wipes the factory's implementations.
  webSocketClient.connect.mockReset();
  webSocketClient.connect.mockImplementation(() => true);
  webSocketClient.isConnected.mockImplementation(() => true);
  webSocketClient.onMessage.mockImplementation((type, fn) => webSocketClient.handlers.set(type, fn));
  webSocketClient.offMessage.mockImplementation((type) => webSocketClient.handlers.delete(type));
  webSocketClient.sendCleanMessage.mockReset();
  webSocketClient.sendCleanMessage.mockImplementation(() => true);
  global.fetch = jest.fn(() => {
    const next = queue.length ? queue.shift() : reply(F.wallBody());
    return typeof next === 'function' ? next() : next;
  });
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

const wallCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/build-play/wall?'));
const pressable = (c) => [...c.querySelectorAll('button, [role="button"]')].map((b) => b.outerHTML.slice(0, 120));
const frame = async (type = 'buildChanged', payload = {}) => {
  act(() => { webSocketClient.handlers.get(type)({ type, ...payload }); });
  await act(async () => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
};
const draw = async (body = F.wallBody()) => {
  queue.push(reply(body));
  const out = render(<BuildWall gameId="4821" k={KEY} />);
  await waitFor(() => expect(out.container.querySelector('[data-wall-screen]')).not.toBeNull());
  return out;
};
const shown = (c) => c.querySelector('[data-wall-screen]').getAttribute('data-wall-screen');

test('reads only the wall route, with the key, and connects as a viewer', async () => {
  await draw();
  expect(String(global.fetch.mock.calls[0][0])).toBe(`${API}games/4821/build-play/wall?k=${encodeURIComponent(KEY)}`);
  // Plain fetch, no headers: never the signed-in fetch.
  expect(global.fetch.mock.calls[0][1]).toBeUndefined();
  const [gameId, name, isHost, options] = webSocketClient.connect.mock.calls[0];
  expect([gameId, name, isHost]).toEqual(['4821', null, false]);
  expect(options.viewerId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  expect(global.fetch.mock.calls.every(([u]) => /\/build-play\/wall(\/images\/[^?]+)?\?k=/.test(String(u)))).toBe(true);
});

test('follows wall.screen: stage, then build, then history', async () => {
  const { container } = await draw(F.wallBody({ wall: { screen: 'stage' } }));
  expect(shown(container)).toBe('stage');
  expect(container.querySelector('.stage')).not.toBeNull();
  queue.push(reply(F.wallBody({ wall: { screen: 'build' }, rev: 10 })));
  await frame();
  await waitFor(() => expect(shown(container)).toBe('build'));
  expect(container.querySelector('.brm-buildscreen')).not.toBeNull();
  queue.push(reply(F.wallBody({ wall: { screen: 'history' }, rev: 11 })));
  await frame();
  await waitFor(() => expect(shown(container)).toBe('history'));
  expect(container.querySelector('.brm-histscreen')).not.toBeNull();
});

test('a buildChanged frame refetches, and its payload is ignored', async () => {
  const { container } = await draw(F.wallBody({ wall: { screen: 'stage' } }));
  const before = wallCalls().length;
  queue.push(reply(F.wallBody({ wall: { screen: 'stage' }, rev: 10 })));
  await frame('buildChanged', { wall: { screen: 'history' }, screen: 'history', rev: 99 });
  await waitFor(() => expect(wallCalls().length).toBe(before + 1));
  expect(shown(container)).toBe('stage');
});

test('a burst of frames is one read', async () => {
  await draw();
  const before = wallCalls().length;
  act(() => { for (let i = 0; i < 5; i += 1) webSocketClient.handlers.get('buildChanged')({ type: 'buildChanged' }); });
  await act(async () => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
  expect(wallCalls().length).toBe(before + 1);
});

test('a reply older than the one shown is dropped (rev, then wall.rev)', async () => {
  const { container } = await draw(F.wallBody({ wall: { screen: 'build' }, rev: 12, wallRev: 5 }));
  queue.push(reply(F.wallBody({ wall: { screen: 'history' }, rev: 11, wallRev: 9 })));
  await frame();
  await act(async () => { await Promise.resolve(); });
  expect(shown(container)).toBe('build');
  queue.push(reply(F.wallBody({ wall: { screen: 'history' }, rev: 12, wallRev: 4 })));
  await frame();
  await act(async () => { await Promise.resolve(); });
  expect(shown(container)).toBe('build');
  queue.push(reply(F.wallBody({ wall: { screen: 'history' }, rev: 12, wallRev: 6 })));
  await frame();
  await waitFor(() => expect(shown(container)).toBe('history'));
});

test('it polls every 8 seconds', async () => {
  await draw();
  const before = wallCalls().length;
  await act(async () => { jest.advanceTimersByTime(WALL_POLL_MS + 10); });
  expect(WALL_POLL_MS).toBe(8000);
  expect(wallCalls().length).toBe(before + 1);
});

test('online again refetches', async () => {
  await draw();
  const before = wallCalls().length;
  act(() => { window.dispatchEvent(new Event('online')); });
  await act(async () => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
  expect(wallCalls().length).toBe(before + 1);
});

test('403: the link has changed', async () => {
  queue.push(reply({ error: 'no', code: 'wall-key' }, 403));
  render(<BuildWall gameId="4821" k="old" />);
  expect(await screen.findByText(W.wallLinkChanged)).toBeInTheDocument();
  expect(W.wallLinkChanged).toBe("This window's link has changed. Open the room's window again from the laptop.");
});

test('404: ended or the code is wrong', async () => {
  queue.push(reply({ error: 'no' }, 404));
  render(<BuildWall gameId="9999" k={KEY} />);
  expect(await screen.findByText(W.wallNotFound)).toBeInTheDocument();
});

test('an ended session says so on the wall, with nothing to press', async () => {
  const { container } = await draw(F.wallBody({ ended: true, wall: { screen: 'build' } }));
  expect(container.textContent).toMatch(W.wallEnded);
  expect(pressable(container)).toEqual([]);
});

test('PRESENT_STATUS: sent on connect and on a fullscreen change', async () => {
  await draw();
  const sends = () => webSocketClient.sendCleanMessage.mock.calls.filter(([t]) => t === 'PRESENT_STATUS');
  await act(async () => { jest.advanceTimersByTime(1100); });
  expect(sends().length).toBe(1);
  act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
  expect(sends().length).toBe(2);
  expect(sends()[1][1]).toEqual({ fullscreen: false, visible: true });
});

describe('nothing pressable, no name, at every moment and on every screen', () => {
  const MOMENTS = [
    ['between asks', {}],
    ['an ask live', { ask: 'live' }],
    ['voting', { ask: 'voting' }],
    ['results', { ask: 'results' }],
    ['the wheel landed', { ask: 'wheel' }],
    ['the codes card', { wall: { codes: 'join' } }],
    ['both codes', { wall: { codes: 'both' } }],
    ['a long history', { history: 40 }],
  ];
  const SCREENS = ['stage', 'build', 'history'];
  test.each(MOMENTS.flatMap(([n, o]) => SCREENS.map((s) => [`${n} · ${s}`, o, s])))('%s', async (name, opts, scr) => {
    const { container } = await draw(F.wallBody({ ...opts, wall: { ...(opts.wall || {}), screen: scr } }));
    expect(shown(container)).toBe(scr);
    expect(pressable(container)).toEqual([]);
    const text = container.textContent;
    F.NAMES.forEach((n) => expect(text).not.toMatch(n));
    expect(text).not.toMatch('HOST-NOTE');
    expect(text).not.toMatch('UNUSED-IDEA');
  });

  // The codes are a side panel beside the Stage's moment (owner, 18 Oct 2026, as on Call & Answer).
  test('the join code shows as a side panel beside the moment when wall.codes is join', async () => {
    const { container } = await draw(F.wallBody({ wall: { codes: 'join', screen: 'stage' } }));
    const panel = container.querySelector('[data-testid="stage-join-panel"]');
    expect(panel).not.toBeNull();
    expect(panel.closest('.content').getAttribute('data-join')).toBe('1');
    expect(container.querySelector('.content > .fitbox')).not.toBeNull();
    expect(container.querySelector('[data-testid="stage-join-second"]')).toBeNull();
  });
});

test('images come only through the wall route, with the key', async () => {
  const { container } = await draw(F.wallBody({ wall: { screen: 'build' } }));
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
  const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter((s) => !/^data:/.test(s));
  expect(srcs.length).toBeGreaterThan(0);
  srcs.forEach((s) => expect(s).toBe(`${API}games/4821/build-play/wall/images/img-shot-1?k=${encodeURIComponent(KEY)}`));
});

describe('the profile is the server\'s', () => {
  test.each(['room', 'tv', 'call', 'table'])('%s', async (profile) => {
    await draw(F.wallBody({ wall: { profile, screen: 'history' } }));
    expect(document.documentElement.classList.contains(`d-${profile}`)).toBe(true);
  });
});

describe('/present dispatches on type=build', () => {
  afterEach(() => { window.history.pushState({}, '', '/'); });
  test('the wall, not the Presentation: no /state read', async () => {
    window.history.pushState({}, '', `/present?gameId=4821&type=build&k=${KEY}`);
    const { container } = render(<Suspense fallback={null}><PresentPage /></Suspense>);
    await waitFor(() => expect(container.querySelector('[data-wall-screen]')).not.toBeNull());
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/state'))).toBe(false);
    expect(String(global.fetch.mock.calls[0][0])).toContain('/build-play/wall?k=');
  });
});
