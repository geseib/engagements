/**
 * THE REMOTE PAGES WORKIE'S READ (two-surface PLAN 1.15, remote-parity A11).
 *
 * The page of the read is a server fact (stage-beat.js, get-game-state's
 * `stageNotes`). On What we heard with more than one page the Remote says
 * "Page n of m" with dots, its primary is roundStep's Next page until the last
 * page, Next round is the plain secondary above it, and Back a page sits in the
 * body. Every press posts a RELATIVE step and re-reads /host-state at once.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostRemote from '../HostRemote';

jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((url, init) => (init && init.method === 'POST'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'OK' }) })
    : global.fetch(url, init))),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const { authFetch } = require('../auth/authFetch');

// The scoreboard panel has its own "Next page" (the board's pages), so the
// round's controls are looked for in the dock.
const dock = () => within(document.querySelector('.hr-dock'));

const posts = () => authFetch.mock.calls.filter(([, init]) => init && init.method === 'POST');
const stateReads = () => global.fetch.mock.calls.filter(([url]) => String(url).includes('/host-state')).length;

const SUMMARY = {
  summary: 'The room wants fewer meetings.',
  discussionQuestions: ['Which meeting goes first?'],
  nextSteps: ['Cancel the Tuesday sync'],
};

function serve({ page, pages, beat = 'field-notes', aiSummary = SUMMARY }) {
  global.fetch = jest.fn((url) => {
    const href = String(url);
    if (href.includes('/host-details')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (href.includes('/host-state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821', state: 'RESULTS#003', stageBeat: beat, currentQuestion: 3,
          gameType: 'call-and-answer',
          gameMetadata: { title: 'Offsite', gameType: 'call-and-answer', questionSetId: 'set-1' },
          stageNotes: { page, pages, plan: null, planKey: null, rev: 1 },
          stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
        }),
      });
    }
    if (href.includes('/players')) return Promise.resolve({ ok: true, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    if (href.includes('/ai-summary')) {
      return aiSummary
        ? Promise.resolve({ ok: true, status: 200, json: async () => aiSummary })
        : Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

describe('the Remote pages the read', () => {
  it('says where the room is, with one dot per page', async () => {
    serve({ page: 1, pages: 3 });
    await connect();
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    const dots = screen.getByTestId('notes-dots').querySelectorAll('.hr-notes-dot');
    expect(dots).toHaveLength(3);
    expect(dots[1]).toHaveAttribute('aria-current', 'true');
  });

  it('Next page is the primary and Next round the secondary until the last page', async () => {
    serve({ page: 0, pages: 3 });
    await connect();
    await screen.findByText('Page 1 of 3');
    await waitFor(() => expect(dock().getByRole('button', { name: 'Next page' })).toHaveClass('hr-primary'));
    expect(dock().getByRole('button', { name: 'Next round' })).toHaveClass('hr-sec');
  });

  it('Next page posts a step, never an absolute page, and re-reads the state at once', async () => {
    serve({ page: 0, pages: 3 });
    await connect();
    const before = stateReads();
    await screen.findByText('Page 1 of 3');
    await waitFor(() => expect(dock().getByRole('button', { name: 'Next page' })).toBeEnabled());
    fireEvent.click(dock().getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = posts()[0];
    expect(url).toBe('https://api.test/games/4821/stage-beat');
    expect(JSON.parse(init.body)).toEqual({ step: 'next', questionNumber: 3 });
    await waitFor(() => expect(stateReads()).toBeGreaterThan(before));
  });

  it('Back a page sits in the body once there is a page behind, and steps back', async () => {
    serve({ page: 1, pages: 3 });
    await connect();
    const back = await screen.findByRole('button', { name: 'Back a page' });
    expect(back).not.toHaveClass('hr-primary');
    fireEvent.click(back);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ step: 'prev', questionNumber: 3 });
  });

  it('on the first page there is no Back a page', async () => {
    serve({ page: 0, pages: 3 });
    await connect();
    await screen.findByText('Page 1 of 3');
    expect(screen.queryByRole('button', { name: 'Back a page' })).not.toBeInTheDocument();
  });

  it('on the last page the primary is Next round, with Request feedback beside it', async () => {
    serve({ page: 2, pages: 3 });
    await connect();
    await waitFor(() => expect(dock().getByRole('button', { name: 'Next round' })).toHaveClass('hr-primary'));
    expect(dock().getByRole('button', { name: 'Request feedback' })).toHaveClass('hr-sec');
  });

  it('a one-page read shows no position at all', async () => {
    serve({ page: 0, pages: 1 });
    await connect();
    await waitFor(() => expect(dock().getByRole('button', { name: 'Next round' })).toHaveClass('hr-primary'));
    expect(screen.queryByText(/^Page \d of \d$/)).not.toBeInTheDocument();
  });
});
