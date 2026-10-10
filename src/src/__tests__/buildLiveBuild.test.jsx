/**
 * No Build Room picture opens a tab, and the live build is one control in the
 * header (owner, 2026-10-08). Page level, through the real build-store views.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const SHOT = { SK: 'BUILD#IMG#0000000000001#p1', ImageId: 'p1', ContentType: 'image/png', Bytes: 900, Kind: 'progress', Caption: 'The header, built', By: 'agent', CreatedAt: ago(100) };
const SHOWING = { SK: 'BUILD#LOG#0000000000001#s1', LogId: '1-s1', Kind: 'showing', Text: 'Header is live', Link: 'http://localhost:5173/', By: 'agent', CreatedAt: ago(90) };

let rows;
const state = () => S.hostView({
  gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: 'A site.' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: ['Ana'], now: NOW,
});

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
  global.URL.createObjectURL = jest.fn(() => 'blob:test');
  authFetch.mockImplementation(async (url) => {
    if (url.includes('/build/images/')) return { ok: true, status: 200, blob: async () => new Blob(['x']) };
    if (url.endsWith('/build/state')) return { ok: true, status: 200, json: async () => state() };
    if (url.endsWith('/host-ticket')) return { ok: true, status: 200, json: async () => ({ ticket: 't' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
});

async function open(r, key) {
  rows = r;
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  if (key) fireEvent.keyDown(window, { key });
}
const base = { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building' };

describe('a picture opens in the app', () => {
  test('the Build screen: one picture, its caption, Back to the build, Esc, and a small full-size link', async () => {
    await open([base, SHOWING, SHOT], '3');
    const pic = await screen.findByRole('button', { name: /Look closer: The header, built/ });
    fireEvent.click(pic);
    const viewer = await screen.findByRole('dialog', { name: /picture viewer/i });
    expect(within(viewer).getByText('The header, built')).toBeInTheDocument();
    expect(within(viewer).queryByRole('tab')).toBeNull();
    const full = await within(viewer).findByRole('link', { name: /Full size/ });
    expect(full).toHaveAttribute('target', '_blank');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /picture viewer/i })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: /Look closer: The header, built/ }));
    expect(within(await screen.findByRole('dialog', { name: /picture viewer/i })).getByRole('button', { name: 'Back to the build' })).toBeInTheDocument();
  });

  test('no picture on the host is wrapped in a link that opens a tab', async () => {
    await open([base, SHOWING, SHOT], '3');
    await screen.findByRole('button', { name: /Look closer: The header, built/ });
    const tabs = [...document.querySelectorAll('figure.bimg a[target="_blank"]')];
    expect(tabs).toHaveLength(0);
  });

  test('Back is named for the screen it was opened from', () => {
    const { backLabelFor } = require('../buildroom/MockupViewer');
    expect(backLabelFor('history', null)).toBe('Back to History');
    expect(backLabelFor('history', '004')).toBe('Back to Ask 4');
    expect(backLabelFor('stage', null)).toBe('Back to the Stage');
    expect(backLabelFor('host', null)).toBe('Back to the Host screen');
  });
});

describe('the live build', () => {
  test('one control in the header on Host, Build and History, opening a new tab', async () => {
    await open([base, SHOWING]);
    for (const key of ['1', '3', '4']) {
      fireEvent.keyDown(window, { key });
      const link = screen.getAllByRole('link', { name: 'Open the build' })[0];
      expect(link).toHaveAttribute('href', 'http://localhost:5173/');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('title', 'Opens http://localhost:5173/ in a new tab');
      expect(link.closest('header.brm-hbar')).not.toBeNull();
    }
  });

  test('with no link yet it is there, disabled, and says why', async () => {
    await open([base]);
    const b = screen.getByRole('button', { name: 'Open the build' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', "Claude hasn't started the app yet");
  });

  test('the Stage dock carries it too, as a small link under the status, once there is a link', async () => {
    await open([base, SHOWING], '2');
    expect(within(document.querySelector('footer.dock')).getByRole('link', { name: 'Open the build in a new tab' })).toHaveAttribute('href', 'http://localhost:5173/');
  });
});

/**
 * SHARE DEMO on the page (docs/design/build-room-share-demo, owner 2026-10-10):
 * the nudge on the Host screen AND hanging from the chip on Build and History,
 * one grey line on the Stage, and the Build screen saying who can open it.
 */
describe('Share demo', () => {
  const KEY = 'KEYkeyKEYkeyKEYkey1234';
  const LAN_LIVE = {
    SK: 'BUILD#LAN', Wanted: true, Status: 'live', ReportedAt: ago(5), LiveSince: ago(60), Open: 3, Key: KEY, WantedAt: ago(70),
    Map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }],
  };
  const DISMISSED = { SK: 'BUILD#LAN', Wanted: false, OfferDismissedAt: ago(30) };
  const posted = (path) => authFetch.mock.calls.filter(([u, o]) => u.endsWith(path) && o && o.method === 'POST').map(([, o]) => JSON.parse(o.body));
  const buildScreen = () => document.querySelector('.brm-buildscreen');

  test('the Build screen, not shared: only this laptop can open it; Open the build plain, Share demo the one amber button', async () => {
    await open([base, SHOWING, SHOT, DISMISSED], '3');
    const b = within(buildScreen());
    expect(b.getByText('Only this laptop can open it.')).toBeInTheDocument();
    expect(b.getByText('http://localhost:5173/')).toBeInTheDocument();
    const link = b.getByRole('link', { name: 'Open the build' });
    expect(link).toHaveAttribute('href', 'http://localhost:5173/');
    expect(link).not.toHaveClass('brm-btn--primary');
    const share = b.getByRole('button', { name: 'Share demo' });
    expect(share).toHaveClass('brm-btn--primary');
    expect(buildScreen().querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    fireEvent.click(share);
    await waitFor(() => expect(posted('/build/share')).toEqual([{ on: true }]));
  });

  test('the Build screen, shared: Open the build opens the shared address, for anyone on this Wi-Fi, with the card and the count', async () => {
    await open([base, SHOWING, SHOT, LAN_LIVE], '3');
    const b = within(buildScreen());
    const link = b.getByRole('link', { name: 'Open the build' });
    expect(link).toHaveAttribute('href', `http://192.168.1.20:4900/?k=${KEY}`);
    expect(link).toHaveClass('brm-btn--primary');
    expect(b.getByText('Anyone on this Wi-Fi')).toBeInTheDocument();
    expect(b.getByText('192.168.1.20:4900')).toBeInTheDocument();
    expect(b.queryByText('Only this laptop can open it.')).toBeNull();
    expect(b.queryByRole('button', { name: 'Share demo' })).toBeNull();
    expect(b.getByText('Same Wi-Fi only · 3 have opened it')).toBeInTheDocument();
    // The header chip counts who opened it.
    expect(screen.getByTestId('brm-wifi')).toHaveTextContent('Shared · 3 opened');
  });

  test('the first screenshot alone brings the nudge: on Build and History it hangs from the chip (D1 B)', async () => {
    await open([base, SHOT], '3');
    let d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(within(d).getByText('Let everyone try it.')).toBeInTheDocument();
    expect(d.closest('.brm-wifiwrap')).not.toBeNull();
    fireEvent.keyDown(window, { key: '4' });
    d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(within(d).getByText('Share this demo with people on your Wi-Fi.')).toBeInTheDocument();
  });

  test('on the Host screen the nudge leads the Now column (D1 A), with no popover; Not now asks the room never again', async () => {
    await open([base, SHOWING, SHOT], '1');
    expect(screen.queryByRole('dialog', { name: 'Share demo' })).toBeNull();
    const card = screen.getByRole('region', { name: 'Share demo' });
    expect(card.closest('[aria-label="Now"]')).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(posted('/build/share')).toEqual([{ dismissOffer: true }]));
  });

  test('after Not now: no nudge anywhere, the chip still reads Share demo and opens the same words', async () => {
    await open([base, SHOWING, SHOT, DISMISSED], '1');
    expect(screen.queryByRole('region', { name: 'Share demo' })).toBeNull();
    fireEvent.keyDown(window, { key: '3' });
    expect(screen.queryByRole('dialog', { name: 'Share demo' })).toBeNull();
    const chip = screen.getByTestId('brm-wifi');
    expect(chip).toHaveTextContent('Share demo');
    fireEvent.click(chip);
    const d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(within(d).getByText('Let everyone try it.')).toBeInTheDocument();
  });

  test('on the Stage: one grey line in the HOST list, never a pop-up; it goes to the Host screen', async () => {
    await open([base, SHOWING, SHOT], '2');
    expect(screen.queryByRole('dialog', { name: 'Share demo' })).toBeNull();
    const hostBtn = within(document.querySelector('footer.dock')).getByRole('button', { name: /HOST/ });
    expect(hostBtn).not.toHaveClass('brm-hostalert--amber');
    fireEvent.click(hostBtn);
    fireEvent.click(screen.getByRole('button', { name: /The demo is ready to share/ }));
    expect(await screen.findByRole('region', { name: 'Share demo' })).toBeInTheDocument();
  });
});
