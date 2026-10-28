/**
 * THE FIRST VIEW, COUNTED (docs/design/build-room-simplify/PLAN.md §1, §5,
 * phase 1; owner, 26 Oct 2026: "go, build phase 1 on dev").
 *
 * The plan measured the first view at 59 controls on one screen and 57 on the
 * console, and set phase 1's targets: no more than 36 on either, no more than
 * 250 words. This holds them, so they cannot drift back.
 *
 * PHASE 2 (owner, 26 Oct 2026: "go to phase 2"): the first view with the
 * five-step core, no more than 33; between asks with three ideas from phones,
 * no more than 40 on one screen (76 in the plan, 58 after phase 1); three
 * routes on an idea's card instead of eight; five steps on the default path.
 *
 * THE RIGHT COLUMN (owner, 28 Oct 2026: "go on the right column, and fold
 * Decided"): Claude now, The brief and History in place of seven folds. The
 * first views hold where they were; between asks lost two (40 to 38, 46 to 44).
 *
 * PHASE 3 (owner, 28 Oct 2026: "then start phase 3"): the Ask the room form
 * for a Choose, no more than 12 controls (17 before), with what Claude gets
 * under More options so writing an ask is two decisions (the kind, Ask the
 * room); and a wrap-up saved, where both layouts lead with Check the report,
 * then End session, and the console never says "No main move now". Between
 * asks gains What's next's Wrap up, its last move once something was decided
 * (PLAN item 15): 38 to 39 on one screen (the plan's phase 2 target was 40),
 * 44 to 45 on the console.
 *
 * The plan's method, reproduced: the real BuildRoomPage in jsdom, the state
 * built by the real server's pure half (build-store.js roomFromRows +
 * hostView), as buildCapabilities.test.jsx builds its fixtures. A control is a
 * button, input, select, textarea, link, summary, tab or switch that is not
 * inside a closed fold. Words are the words of the page's text, the same way.
 *
 * The first view is a new room: no ask yet, Claude Code not connected, four
 * people joined, and (on one screen) a browser that has not chosen screens.
 */
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { SURFACES_KEY } from '../config/surfaces';

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

/** A new room: the state row alone, no Claude, four joined. */
function firstView() {
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 1 }]),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
  return {
    ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null,
  };
}

const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const DECIDED = (id, prompt) => ({
  SK: `BUILD#ASK#${id}`, AskId: id, Source: 'agent', CreatedAt: ago(900), Kind: 'choice', Prompt: prompt, Detail: '', MaxPicks: 1,
  Options: [{ label: 'A', title: 'A calendar', detail: '', url: '' }, { label: 'B', title: "This week's shifts", detail: '', url: '' }],
  Status: 'decided', DecidedAt: ago(700), Decision: { direction: `${prompt}: B`, chosen: ['B'], note: '' },
});
const IDEA = (n, who, text) => ({ SK: `BUILD#IDEA#000000000000${n}#i${n}`, IdeaId: `${n}-i${n}`, Status: 'new', Source: 'room', PlayerName: who, Text: text, CreatedAt: ago(130 - n * 10) });
const THREE_IDEAS = [IDEA(1, 'Ana', 'Show where to park'), IDEA(2, 'Dee', 'Print a rota for the noticeboard'), IDEA(3, 'Sam', 'Text a reminder the day before')];

/**
 * BETWEEN ASKS, THREE IDEAS FROM PHONES (the mockup's frame 4): Claude
 * connected and building, two asks decided, one build shown on this laptop,
 * three ideas waiting, no points and nothing saved for later. The host has
 * answered Share demo's one-time nudge (it shows once, until answered), as in
 * the frame; with the nudge up the page carries its two buttons more.
 */
function betweenAsks() {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 9, AgentSeenAt: ago(6), Phase: 'building' },
    { SK: S.SK.lan, OfferDismissedAt: ago(200) },
    DECIDED('001', 'Which sign-up should volunteers see first?'), DECIDED('002', 'Which header?'),
    { SK: 'BUILD#LOG#0000000000001#s1', LogId: '1-s1', Kind: 'showing', Text: 'The shift list is up', Link: 'http://localhost:5173/', By: 'agent', CreatedAt: ago(300) },
    ...THREE_IDEAS,
  ];
  const view = S.hostView({
    gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: '' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: ['Ana', 'Dee', 'Priya', 'Sam'], now: NOW,
  });
  return {
    ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null,
  };
}

/** Between asks, then the host saved the wrap-up: the mockup's frame 5. */
function wrappedUp() {
  const v = betweenAsks();
  return { ...v, outcome: { summary: 'A one-page sign-up for volunteers.', built: ['The shift list'], links: [], nextSteps: [], by: 'host', updatedAt: ago(20) } };
}

/** The first view once Claude Code has called in: the setup card is one line, the opening leads. */
function connectedFirstView() {
  const view = S.hostView({
    gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: '' }, sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 1, AgentSeenAt: ago(6) }]), players: ['Ana', 'Dee', 'Priya', 'Sam'], now: NOW,
  });
  return {
    ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null,
  };
}

const res = (data) => ({ ok: true, status: 200, json: async () => data });
function serve(state) {
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET' && url.endsWith('/build/state')) return res(state);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true });
  });
}

const CONTROLS = 'button, input, select, textarea, a[href], summary, [role="tab"], [role="switch"]';

/** Every control not inside a closed fold (a <details> without `open`; its own summary counts). */
function countControls(root) {
  return [...root.querySelectorAll(CONTROLS)].filter((el) => {
    const fold = el.parentElement && el.parentElement.closest('details:not([open])');
    if (!fold) return true;
    return el.tagName === 'SUMMARY' && el.parentElement === fold;
  }).length;
}

/**
 * The words a host reads: the page's text, leaving out what is inside a closed
 * fold, screen-reader-only labels and the options of a shut select. Counted
 * this way, the first view was 377 words on one screen and 330 on the console
 * before phase 1 (the plan's 412 came from a scratch count that was not kept).
 */
function countWords(root) {
  const copy = root.cloneNode(true);
  copy.querySelectorAll('details:not([open])').forEach((d) => {
    [...d.childNodes].forEach((n) => { if (n.tagName !== 'SUMMARY') n.remove(); });
  });
  copy.querySelectorAll('.brm-sr, .sr-only, .rws-sr, option').forEach((n) => n.remove());
  return (copy.textContent || '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

async function open({ two = false, state = firstView } = {}) {
  if (two) window.localStorage.setItem(SURFACES_KEY, 'two');
  serve(state());
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findAllByText('Volunteer sign-up');
  const root = document.querySelector('.brm-room');
  return { root, controls: countControls(root), words: countWords(root) };
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
  getAuthToken.mockImplementation(async () => 'id-token');
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

test('one screen: no more than 33 controls and 250 words (59 and 377 before phase 1, 32 after it)', async () => {
  const { controls, words } = await open();
  // Phase 2's target: the brief path shows the core's five lines and one More framing questions.
  expect(controls).toBeLessThanOrEqual(33);
  expect(words).toBeLessThanOrEqual(250);
});

test('two screens: the console\'s first view has no more than 36 controls (57 before), and fewer words than its 330', async () => {
  const { controls, words } = await open({ two: true });
  expect(controls).toBeLessThanOrEqual(36);
  // The plan's word target is the one-screen figure; the console carries its own top line,
  // strip and rail besides, so it holds the ground it gained instead.
  expect(words).toBeLessThanOrEqual(280);
});

test('one panel before the opening, and no choice to make before it: one orange, Connect (PLAN §5 phase 1)', async () => {
  const { root } = await open();
  const now = screen.getByRole('main', { name: 'Now' });
  const panels = [...now.querySelectorAll(':scope > section')];
  expect(panels[0]).toHaveAccessibleName('Before the room starts');
  expect(panels[1]).toHaveClass('brm-opening');
  // Which screen is not asked: one screen until the host says otherwise; Use two screens is a row.
  expect(screen.queryByRole('button', { name: 'Use one screen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Help me pick' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Use two screens' })).toBeInTheDocument();
  // Connect or the opening is not a choice either: Connect is the one orange button.
  const orange = [...root.querySelectorAll('.brm-btn--primary')];
  expect(orange.map((b) => b.textContent.trim())).toEqual(['Connect']);
});

// ── Phase 2: the opening and between asks ─────────────────────────────────────

test('the default opening is five steps: the core on the path, the other four one press away under More framing questions', async () => {
  const { root } = await open();
  const path = screen.getByRole('region', { name: 'The opening: the build brief' });
  const [core, more] = path.querySelectorAll('ol.brm-bp');
  expect(core.querySelectorAll(':scope > li')).toHaveLength(5);
  expect(path.querySelector('details.brm-bp-more').open).toBe(false);
  expect(more.querySelectorAll(':scope > li')).toHaveLength(4);
  expect(root.querySelector('#brm-opening-h').textContent).toBe('Opening · step 1 of 5');
});

test('a connected first view: one press, the orange one, puts the first opening ask live', async () => {
  const { root } = await open({ state: connectedFirstView });
  const orange = [...root.querySelectorAll('.brm-btn--primary')];
  expect(orange.map((b) => b.textContent.trim())).toEqual(['Ask the room to pick']);
});

test('between asks with three ideas, one screen: no more than 39 controls (76 in the plan, 58 after phase 1, 40 after phase 2)', async () => {
  const { controls } = await open({ state: betweenAsks });
  // The right column (owner, 28 Oct 2026): History's chips in place of the folds, Decided folded (38);
  // phase 3 adds What's next's Wrap up, its last move (39).
  expect(controls).toBeLessThanOrEqual(39);
});

test('between asks with three ideas, two screens: the console takes the same cuts (62 after phase 1, 46 after phase 2)', async () => {
  // The console's top line and rail are Call & Answer's and were left as they are (phase 1 did
  // the same); its own panels take every phase 2 cut. Held where it landed, so it cannot drift.
  const { controls } = await open({ two: true, state: betweenAsks });
  expect(controls).toBeLessThanOrEqual(45);
});

test("an idea's card carries three routes and its tick (eight and the tick before); its words open Consider", async () => {
  for (const two of [false, true]) {
    // eslint-disable-next-line no-await-in-loop
    await open({ two, state: betweenAsks });
    const cards = [...document.querySelectorAll('.brm-qidea')];
    expect(cards).toHaveLength(3);
    cards.forEach((card) => {
      const acts = card.querySelector('.brm-idea-acts');
      expect(countControls(acts)).toBe(3);
      expect([...acts.querySelectorAll(':scope > button, :scope > .brm-more > button')].map((b) => b.textContent.trim())).toEqual(['Send to Claude', 'Ask the room', 'More']);
      // The tick, then the three: nothing else on the card until it is used (a reply thread, a mark).
      expect(countControls(card)).toBe(4);
      expect(card.querySelector('.brm-idea-text.is-door')).not.toBeNull();
    });
    cleanup();
    window.localStorage.clear();
  }
});

// ── Phase 3: asking and finishing ─────────────────────────────────────────────

/** The Ask the room form, as the host meets it: opened from the composer's line, then Choose. */
async function askForm(kind = 'Choose') {
  await open();
  fireEvent.click(within(screen.getByRole('region', { name: 'Tell Claude' })).getByRole('button', { name: 'Ask the room' }));
  const dialog = screen.getByRole('dialog', { name: 'Ask the room' });
  fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Kind of ask' })).getByRole('radio', { name: kind }));
  return dialog.querySelector('form');
}

test('the Ask the room form for a Choose: no more than 12 controls (17 before), four kinds on one row', async () => {
  const form = await askForm();
  expect(countControls(form)).toBeLessThanOrEqual(12);
  const kinds = within(within(form).getByRole('radiogroup', { name: 'Kind of ask' })).getAllByRole('radio');
  expect(kinds.map((k) => k.textContent)).toEqual(['Ideas', 'Choose', 'Yes/No', 'Rate']);
});

test('writing your own ask is two decisions: the kind, then Ask the room (what Claude gets is under More options)', async () => {
  const form = await askForm();
  const fold = form.querySelector('details.brm-askmore');
  expect(fold.open).toBe(false);
  // Claude gets it as, the note, the preview links and Save as a draft wait in the closed fold.
  const gets = within(form).getByRole('radiogroup', { name: 'Claude gets it as' });
  expect(fold.contains(gets)).toBe(true);
  expect(fold.querySelector('summary').textContent).toMatch('Claude gets it as Do now');
  // Outside the fold: the kind and the one orange, Ask the room; everything else is typing.
  const choices = [...form.querySelectorAll('[role="radiogroup"]')].filter((g) => !g.closest('details:not([open])'));
  expect(choices.map((g) => g.getAttribute('aria-label'))).toEqual(['Kind of ask']);
  expect([...form.querySelectorAll('.brm-btn--primary')].map((b) => b.textContent)).toEqual(['Ask the room']);
});

test('a Yes/No form is smaller still: its two answers start as Yes and No', async () => {
  const form = await askForm('Yes/No');
  expect(countControls(form)).toBeLessThanOrEqual(11);
  expect(within(form).getByLabelText('The yes answer')).toHaveValue('Yes');
  expect(within(form).getByLabelText('The no answer')).toHaveValue('No');
});

test('wrap-up saved, one screen: the lead move is Check the report, then End session', async () => {
  const { root } = await open({ state: wrappedUp });
  const now = screen.getByTestId('brm-wrappednow');
  const moves = [...now.querySelectorAll('.brm-wn')].map((li) => li.querySelector('b').textContent);
  expect(moves).toEqual(['Check the report', 'End the session']);
  expect([...root.querySelectorAll('.brm-btn--primary')].map((b) => b.textContent.trim())).toEqual(['Report']);
  expect(now.querySelector('[data-next-primary]').textContent).toBe('Report');
});

test('wrap-up saved, two screens: Your part now leads with Check the report, then End session, never "No main move now"', async () => {
  const { root } = await open({ two: true, state: wrappedUp });
  expect(root.textContent).not.toMatch('No main move now');
  expect(root.querySelector('[data-empty-slot]')).toBeNull();
  const card = screen.getByRole('region', { name: 'Your part now' });
  // The main button (Space) is Check the report; its second is End session.
  expect(card.querySelector('.host-action-bar__primary').textContent).toMatch('Check the report');
  expect(card.querySelector('.host-action-bar__secondary').textContent).toMatch('End session');
  expect(card.textContent).toMatch('Wrap-up saved. Check the report, then end the session.');
});
