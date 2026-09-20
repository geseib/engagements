/**
 * THE HOST'S PHONE RESOLVES AN ORGANISATION, LIKE EVERY OTHER HOST SURFACE.
 *
 * ── THE REPORT, AND WHY ALL OF IT IS ONE FAULT ─────────────────────────────
 *
 *   *"There is a bug on the remote phone host screen. Questions tab says
 *    'Could not read the question set'."*
 *   *"pressing Start first round answers 'game not found'. So does Start
 *    voting. But the remote DOES receive live updates — it sees players
 *    joining. Every one of those triggers works from the host's computer."*
 *
 * Three symptoms, one cause, and the code says which:
 *
 *   `pollState` and `pollRoster` are PLAIN `fetch` — no token. With no token
 *   `tenant.callerGroups(event)` is empty and `callerMayDriveSession` returns
 *   true at its "an anonymous participant, judged elsewhere" line, so the live
 *   updates arrive. SIGNING IN IS WHAT BREAKS IT.
 *
 *   Every DISPATCH goes through `authFetch`, which attaches the token AND
 *   `X-Engage-Org` — an organisation read out of THIS BROWSER's localStorage.
 *   With a token the same guard becomes `callerOrgId(event) === gameOrg`, and a
 *   phone that never chose an organisation sends no header at all.
 *   `auth/pick-active-org.js` then falls through to rule 3, the caller's
 *   `defaultOrgId` — which names their HOME, written with `if_not_exists` when
 *   an approved account's personal space is provisioned
 *   (`admin/orgs/shared/personal-org.js`). So a host in more than one team
 *   drives the room as their PERSONAL org, `'org_personal' === 'org_teamg'` is
 *   false, and every authenticated host route answers 404 "Game not found". An
 *   account with a single membership is unaffected, because rule 2 answers
 *   first — which is why this is reproducible for some hosts and invisible to
 *   others.
 *
 *   The wrong org points `tenant.readableScopes` and
 *   `set-version.js:findSetMetadata` at the wrong org library, so the session's
 *   own question set is ABSENT — 404, "Could not read the question set". Same
 *   cause, different route.
 *
 *   NOTE WHAT THIS MEANS FOR THE FIX BELOW: resolving an organisation is
 *   necessary and not sufficient. `ActiveOrgSwitcher` reconciles to the
 *   PERSONAL org when nothing is remembered, which is the same org rule 3 was
 *   already choosing — so for a session run for a team, the chip's value is
 *   what the host has to change. The phone cannot pick the session's org for
 *   them: no route it may call names it. `game/get-game-state.js` publishes the
 *   set's SCOPE and withholds the org id on purpose ("Not a secret: it is one
 *   of platform/org/public and names no organisation"), and that route is
 *   public. So the honest shape today is: resolve one, NAME it on screen, and
 *   let the host correct it in one tap without leaving the session.
 *
 * ── WHY THE PHONE AND NOT THE LAPTOP ───────────────────────────────────────
 *
 * `ActiveOrgSwitcher` is the only thing in this codebase that writes the active
 * organisation, and its mount effect writes one whether or not anybody touches
 * it. `WelcomeScreen` mounted it; every host who reached the session list had
 * therefore resolved an organisation on that device. `/remote` renders
 * `HostRemote` inside `ProtectedRoute` and nothing else, so the phone never
 * did. That is the whole difference between the two devices.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostRemote from '../HostRemote';
import { ACTIVE_ORG_STORAGE_KEY } from '../auth/authFetch';

/* PARTIAL MOCK. Only the transport is swapped — the org accessors are the real
   ones, so what the switcher stores is observable here. */
jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((...args) => global.fetch(...args)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

function serve({ orgs = [] } = {}) {
  global.fetch = jest.fn((url, init) => {
    const href = String(url);
    if (init?.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (href.includes('/orgs')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ orgs }) });
    if (href.includes('/state')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          gameId: '4821',
          state: 'CREATED',
          gameType: 'trivia',
          gameMetadata: { title: 'Offsite', gameType: 'trivia', questionSetId: 'pricing' },
        }),
      });
    }
    if (href.includes('/players')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    }
    if (href.includes('/categories')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ categories: [] }) });
    }
    if (href.includes('/questions')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ questions: [], setName: 'Pricing' }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  await waitFor(() => expect(screen.queryByLabelText(/session code/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
  window.localStorage.clear();
});

describe('the remote resolves an organisation', () => {
  /*
    Rejects: the exact state this bug was reported from — a signed-in phone
    sending no `X-Engage-Org`, because nothing on `/remote` had ever written
    one.
  */
  it('asks for the caller\'s organisations and remembers one', async () => {
    serve({
      orgs: [
        { orgId: 'org_personal', name: 'George', type: 'personal' },
        { orgId: 'org_teamg', name: 'TeamG', type: 'team' },
      ],
    });
    await connect();

    await waitFor(() => {
      expect(window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe('org_personal');
    });
  });

  // Rejects: leaving the platform sentinel in place. `~platform` can never
  // match a membership, so `pickActiveOrg` resolves it to NO organisation —
  // a phone carrying it is in precisely the state that produced this bug. And
  // unlike the console, this surface has no platform mode to be in.
  it('heals a stored platform sentinel', async () => {
    window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, '~platform');
    serve({ orgs: [{ orgId: 'org_teamg', name: 'TeamG', type: 'team' }] });
    await connect();

    await waitFor(() => {
      expect(window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe('org_teamg');
    });
  });

  // Rejects: resolving an organisation silently and giving a host in two teams
  // no way to see or change which one the phone is acting as. Resolution alone
  // cannot finish the job — the org it lands on need not be the session's — so
  // the chip is the other half, and it is the control the error copy points at.
  it('shows the team it is acting as when there is more than one', async () => {
    serve({
      orgs: [
        { orgId: 'org_personal', name: 'George', type: 'personal' },
        { orgId: 'org_teamg', name: 'TeamG', type: 'team' },
      ],
    });
    await connect();

    expect(await screen.findByTestId('orgsw-chip')).toBeInTheDocument();
  });

  // Rejects: drawing a chip for a host with nothing to switch between. The
  // server already resolves that case on its own (pickActiveOrg rule 2), and a
  // phone column has no room for a label that says nothing.
  it('draws nothing when the account has no organisation', async () => {
    serve({ orgs: [] });
    await connect();

    await waitFor(() => expect(screen.getByLabelText(/^Session$/)).toBeInTheDocument());
    expect(screen.queryByTestId('orgsw-chip')).not.toBeInTheDocument();
  });
});
