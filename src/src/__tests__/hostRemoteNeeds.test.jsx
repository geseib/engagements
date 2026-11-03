/**
 * THE PHONE REMOTE'S NEEDS-YOU CARD (HostRemote.jsx; experience plan §3.3,
 * Phase 1b).
 *
 * // rejects: audit B §2.1, "Someone asks to take a name → Remote: None. No
 * //          flag, no strip, no verbs": the phone the one-screen copy sends
 * //          the host to for privacy could not see or answer a name request.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostRemote from '../HostRemote';

jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((url, init) => global.fetch(url, init)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const ROSTER = {
  players: [
    { playerName: 'Priya', totalScore: 3, handover: { open: false, requested: false } },
    { playerName: 'Sam', totalScore: 0, deviceConnected: false, handover: { open: false, requested: true, requestedAt: new Date().toISOString() } },
  ],
  stats: { totalPlayers: 2 },
};

function serve() {
  global.fetch = jest.fn((url, init = {}) => {
    const u = String(url);
    if (u.includes('/handover')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    if (u.includes('/host-details')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (u.includes('/host-state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ gameId: '5479', currentQuestion: 3, gameType: 'call-and-answer', state: 'ASK#003', gameMetadata: { title: 'Offsite', gameType: 'call-and-answer' } }),
      });
    }
    if (u.includes('/players')) return Promise.resolve({ ok: true, json: async () => ROSTER });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
  serve();
});

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '5479' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
  return screen.findByTestId('remote-needs');
}

test('the card names the asker above the status card, with Let them and Not now', async () => {
  const card = await connect();
  expect(card).toHaveTextContent('Needs you · 1');
  expect(card).toHaveTextContent('Sam wants their name on a new device');
  expect(within(card).getByRole('button', { name: 'Let them: Sam' })).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Not now: Sam' })).toBeInTheDocument();
  const status = document.querySelector('.hr-status');
  expect(card.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('Let them posts the bound grant on the host-only route, then re-reads the roster', async () => {
  const card = await connect();
  const rosterReads = () => global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/players')).length;
  const before = rosterReads();
  fireEvent.click(within(card).getByRole('button', { name: 'Let them: Sam' }));
  await waitFor(() => {
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/players/Sam/handover'));
    expect(call).toBeTruthy();
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ bindToRequester: true, requestedAt: ROSTER.players[1].handover.requestedAt });
  });
  await waitFor(() => expect(rosterReads()).toBeGreaterThan(before));
});

test('Not now posts the refusal', async () => {
  const card = await connect();
  fireEvent.click(within(card).getByRole('button', { name: 'Not now: Sam' }));
  await waitFor(() => {
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/players/Sam/handover'));
    expect(JSON.parse(call[1].body)).toEqual({ refuse: true });
  });
});
