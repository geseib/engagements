/**
 * A TEAM INVITATION IN THE BUILD ROOM (owner, 2026-10-10:
 * docs/design/pending-invite-notice, option A). A slim blue bar under the
 * header, on the HOST screen only — never Stage, Build or History, which the
 * room sees. And the same row above the New Build Room form, where the
 * reviewer lost it. NO GEOMETRIC ASSERTIONS: jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage, { BuildCreate } from '../buildroom/BuildRoomPage';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(), onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const INVITE = {
  token: 'org_9xK4Fq7Pz2mNbVc8dQwLxR.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR',
  orgName: 'Northwind Learning',
  role: 'member',
  invitedByEmail: 'dana@northwind.example',
  daysUntilExpiry: 9,
};

function state() {
  return S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: NOW, Phase: 'building' }]),
    players: ['Ana'],
    now: NOW,
  });
}
const res = (data) => ({ ok: true, status: 200, json: async () => data });

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET' && url === `${API}invites`) return res({ invites: [INVITE] });
    if (method === 'GET' && url.endsWith('/build/state')) return res(state());
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true });
  });
});

async function openRoom() {
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}
const bar = () => document.querySelector('.pinv.pinv--bar');

describe('the Build Room Host screen', () => {
  test('a blue bar under the header, naming the team, with Accept', async () => {
    await openRoom();
    expect(await screen.findByText('Northwind Learning')).toBeInTheDocument();
    expect(bar()).not.toBeNull();
    const header = document.querySelector('header.brm-hbar');
    // eslint-disable-next-line no-bitwise
    expect(header.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar().querySelector('button').textContent).toBe('Accept');
  });

  // rejects: a team's name and an inviter's address on the projector.
  test.each([['Stage', '2'], ['Build', '3'], ['History', '4']])('never on the %s screen', async (_name, key) => {
    await openRoom();
    await screen.findByText('Northwind Learning');
    fireEvent.keyDown(window, { key });
    expect(document.querySelector('.pinv')).toBeNull();
    expect(screen.queryByText('Northwind Learning')).toBeNull();
  });
});

describe('New Build Room', () => {
  test('the same row above the form', async () => {
    render(<BuildCreate navigate={jest.fn()} />);
    expect(await screen.findByText('Northwind Learning')).toBeInTheDocument();
    const row = document.querySelector('.pinv');
    expect(row).not.toBeNull();
    expect(row.classList.contains('pinv--bar')).toBe(false);
    const form = document.querySelector('form.brm-create');
    // eslint-disable-next-line no-bitwise
    expect(row.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
