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
    const full = await within(viewer).findByRole('link', { name: /Open full size/ });
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
      expect(link).toHaveAttribute('title', 'Opens in a new tab');
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
