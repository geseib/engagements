/**
 * THE SESSION TAB ON THE PHONE — players, rounds, questions.
 *
 *   *"it no longer list the players that joined in the beginning, it would be
 *    nice if it had the same menu as the main screen with listing the players,
 *    the rounds, the questions. can this just be a mobile friendly version of
 *    the session tab?"*
 *
 * Two kinds of assertion live here and they are kept apart on purpose:
 *
 *   THE CALL SITE. `config/hostRemote.js:rosterListing` is unit-tested next
 *   door and that is not enough — this codebase has shipped a correct module
 *   wired to nothing more than once. Everything in the first half fails if
 *   HostRemote stops rendering what it computes.
 *
 *   THE CSS CONTRACT, read as TEXT. jsdom has no layout engine: every rect is
 *   zero, so "it fits on a phone", "the tab bar is above the list" and "the tap
 *   target is big enough" are all unfalsifiable as rendered assertions and
 *   would pass against a deleted stylesheet. `modalReachability.test.js` is the
 *   pattern; the second half copies it. What that buys is narrow and worth
 *   saying: it pins that the contract has not been reverted, not that the
 *   surface works on a phone. Only a phone can say that.
 *
 * DOCUMENT ORDER IS ASSERTED WHERE POSITION MATTERS, because jsdom does model
 * that — `compareDocumentPosition` is real, `getBoundingClientRect` is not.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostRemote from '../HostRemote';

// Delegates to the same router `serve()` installs on global.fetch.
//
// It used to answer every call with `{}`, which was harmless only while the
// authenticated calls were ones this file did not assert on. The question-set
// routes (`/questions`, `/categories`) moved onto `authFetch` when they stopped
// being public — a blanket stub then fed the browser an empty set and the
// failures read as "the browser lists nothing", pointing at the component
// rather than at the mock. Route both transports through one place so the
// fixtures below are what the component actually receives, whichever it uses.
jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn((...args) => global.fetch(...args)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

/* ------------------------------------------------------------- fixtures */

const person = (playerName, extra = {}) => ({
  playerName,
  totalScore: 0,
  isConnected: true,
  readiness: { isReady: false, type: 'none', hasAnswered: false, hasVoted: false },
  ...extra,
});

/**
 * `POST /games/{id}/report`'s REAL ENVELOPE.
 *
 * `{ success, gameId, report: { detailedQuestions } }` — one level deeper than
 * it reads. config/sessionHistory.js carries the incident: the rounds tab was
 * shipped reading `payload.detailedQuestions`, always undefined, so every
 * session said "No rounds yet" no matter how many rounds it had, and the tests
 * passed because their fixture was built from that same wrong reading. A
 * fixture that agrees with the client and disagrees with the handler proves
 * only that the client is self-consistent.
 */
const REPORT = {
  success: true,
  gameId: '4821',
  report: {
    detailedQuestions: [
      {
        questionNumber: 2,
        questionData: { title: 'What would you stop doing?', category: 'Focus' },
        answers: [
          // `answerText`, not `answer` — create-report.js:384-415's spelling.
          { answerIndex: 0, playerName: 'Ada', answerText: 'Weekly status decks', rank: 1 },
          // No `playerName` at all: create-report omits it on a redacted round.
          { answerIndex: 1, answerText: 'The Tuesday sync', rank: 2 },
        ],
        aiSummary: { summaryText: 'The room wants fewer meetings.' },
      },
      {
        questionNumber: 1,
        questionData: { title: 'Where does time go?', category: 'Focus' },
        answers: [],
        aiSummary: null,
      },
    ],
  },
};

function serve({ state = 'STARTED', players = [], report = REPORT, progress = {} } = {}) {
  const posts = [];
  global.fetch = jest.fn((url, init) => {
    const href = String(url);
    if (init?.method === 'POST') {
      posts.push(href);
      if (href.includes('/report')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => report });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (href.includes('/state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821',
          state,
          stageBeat: 'results',
          currentQuestion: 2,
          gameType: 'call-and-answer',
          gameMetadata: { title: 'Offsite', gameType: 'call-and-answer', questionSetId: 'pricing' },
          ...progress,
        }),
      });
    }
    if (href.includes('/players')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ players, stats: { totalPlayers: players.length } }),
      });
    }
    if (href.includes('/categories')) {
      return Promise.resolve({ ok: true, json: async () => ({ categories: [] }) });
    }
    if (href.includes('/questions')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          questions: [{ id: '004', title: 'Which pricing change?' }],
          setName: 'Strategic Pricing Plays',
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  return posts;
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  await waitFor(() => expect(screen.queryByLabelText(/session code/i)).not.toBeInTheDocument());
}

const openPanel = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /players & rounds/i }));
  return screen.findByRole('tablist', { name: /session/i });
};

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

/* --------------------------------------------------------- the call site */

describe('the players list the owner asked for', () => {
  // THE REPORTED DEFECT. The names have been in this component's memory since
  // pollRoster stopped throwing the array away, and the only thing reading them
  // was `waitingOn` — which is scoped to ASK and VOTE, so in the lobby the
  // phone printed a count and nothing else.
  it('names everyone who has joined, before a round has been dealt', async () => {
    serve({ state: 'STARTED', players: [person('Ada'), person('Dana')] });
    await connect();
    await openPanel();

    const pane = screen.getByRole('tabpanel', { name: /players/i });
    expect(within(pane).getByText('Ada')).toBeInTheDocument();
    expect(within(pane).getByText('Dana')).toBeInTheDocument();
  });

  // Rejects: a joined list under a waiting caption. RoomMeter.jsx emits the same
  // attribute for the same reason — the polarity is a fact in the markup, not
  // something inferred from copy that a wording pass can quietly flip.
  it('says in the markup which SET the list is', async () => {
    serve({ state: 'STARTED', players: [person('Ada')] });
    await connect();
    await openPanel();
    expect(screen.getByRole('tabpanel', { name: /players/i })).toHaveAttribute(
      'data-list-kind', 'joined',
    );
  });

  it('switches to the whole-room list once a round is running', async () => {
    serve({
      state: 'ASK#002',
      players: [person('Ada', { readiness: { hasAnswered: true } }), person('Dana')],
      progress: { answerProgress: { answersReceived: 1, totalPlayers: 2 } },
    });
    await connect();
    await openPanel();

    const pane = screen.getByRole('tabpanel', { name: /players/i });
    expect(pane).toHaveAttribute('data-list-kind', 'everyone');
    // BOTH names, unlike the waiting chips on the round view, which name only
    // who is holding the room up. This list is the desktop session tab's.
    expect(within(pane).getByText('Ada')).toBeInTheDocument();
    expect(within(pane).getByText('Dana')).toBeInTheDocument();
  });

  // Rejects: an empty list with nothing under it. "Nothing exists" and "nothing
  // matches" are different situations with different exits, and the exit for an
  // empty room is the join QR — which is one tap away on the round view, so the
  // copy has to say where.
  it('says the room is empty AND how to fill it', async () => {
    serve({ state: 'CREATED', players: [] });
    await connect();
    await openPanel();
    const pane = screen.getByRole('tabpanel', { name: /players/i });
    expect(within(pane).getByText(/nobody has joined yet/i)).toBeInTheDocument();
    expect(within(pane).getByText(/put the QR in front of the room/i)).toBeInTheDocument();
  });
});

describe('the rounds list', () => {
  // Rejects: a second endpoint for session history. `POST /games/{id}/report`
  // already assembles every round with its answers and its AI summary, and it
  // is already the route that redacts them correctly.
  it('reads the rounds from the report route, in the order they were played', async () => {
    const posts = serve({ state: 'RESULTS#002' });
    await connect();
    await openPanel();
    fireEvent.click(screen.getByRole('tab', { name: /rounds/i }));

    await screen.findByText('Where does time go?');
    expect(posts).toContain('https://api.test/games/4821/report');

    // Round 1 before round 2, though the payload lists them the other way —
    // create-report iterates a Map keyed by strings, where "10" sorts before
    // "2". Document order is the assertion because jsdom models it.
    const first = screen.getByText('Where does time go?');
    const second = screen.getByText('What would you stop doing?');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  // Rejects: reading `answer` instead of `answerText`. Every past round would
  // render with no responses at all — the exact defect config/sessionHistory.js
  // is named after, which shipped once with a green suite behind it.
  it('opens a round in place and shows what the room actually said', async () => {
    serve({ state: 'RESULTS#002' });
    await connect();
    await openPanel();
    fireEvent.click(screen.getByRole('tab', { name: /rounds/i }));

    const row = await screen.findByRole('button', { name: /what would you stop doing/i });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Weekly status decks')).toBeInTheDocument();
    expect(screen.getByText(/the room wants fewer meetings/i)).toBeInTheDocument();
  });

  // Rejects: labelling a redacted answer with an empty name, the string "null",
  // or a name taken from somewhere else. create-report OMITS `playerName` on a
  // redacted round and `displayLabelFor` reads the row, which is where that
  // per-round decision was made.
  it('labels a redacted answer Response N rather than inventing an author', async () => {
    serve({ state: 'RESULTS#002' });
    await connect();
    await openPanel();
    fireEvent.click(screen.getByRole('tab', { name: /rounds/i }));
    fireEvent.click(await screen.findByRole('button', { name: /what would you stop doing/i }));

    const redacted = screen.getByText('The Tuesday sync').closest('li');
    expect(within(redacted).getByText('Response 2')).toBeInTheDocument();
    expect(within(screen.getByText('Weekly status decks').closest('li')).getByText('Ada'))
      .toBeInTheDocument();
  });

  // A session with no completed round has no report. That is the normal state
  // for the first minutes of every game, not an error worth a red flash.
  it('says why the list is empty rather than showing nothing', async () => {
    serve({ state: 'STARTED', report: { report: { detailedQuestions: [] } } });
    await connect();
    await openPanel();
    fireEvent.click(screen.getByRole('tab', { name: /rounds/i }));
    expect(await screen.findByText(/no rounds yet/i)).toBeInTheDocument();
  });
});

describe('the questions tab is the browser that already existed', () => {
  // Rejects: building a second question list beside `RemoteQuestionBrowser`.
  // The tab must reach the same component, options, CORRECT flag and all.
  it('lists the set from inside the panel', async () => {
    serve({ state: 'ASK#002' });
    await connect();
    await openPanel();
    fireEvent.click(screen.getByRole('tab', { name: /questions/i }));

    expect(await screen.findByText('Which pricing change?')).toBeInTheDocument();
    expect(screen.getByText(/Strategic Pricing Plays/)).toBeInTheDocument();
  });

  // Rejects: pointing `Choose next question` at anything but this panel. The
  // round view's button and the Session card's button are two doors into one
  // place, which is only true if they land on the same tablist.
  it('is where Choose next question lands', async () => {
    serve({ state: 'ASK#002' });
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /choose next question/i }));

    const tabs = await screen.findByRole('tablist', { name: /session/i });
    expect(within(tabs).getByRole('tab', { name: /questions/i }))
      .toHaveAttribute('aria-selected', 'true');
  });
});

describe('the primary action survives a list being open', () => {
  /**
   * THE NAVIGATION DECISION, PINNED.
   *
   * The question browser used to be a whole screen whose dock said "Back to the
   * round", so for as long as the host was reading, the advance was gone.
   * Three lists would make that trade three times as often. If a future change
   * puts the way back into the dock again, this fails.
   */
  it('keeps the advance in the dock while the panel is open', async () => {
    serve({ state: 'RESULTS#002' });
    await connect();
    await screen.findByRole('button', { name: /what we heard/i });

    await openPanel();
    expect(screen.getByRole('button', { name: /what we heard/i })).toBeInTheDocument();
  });

  // Rejects: a way back that scrolls away with the list, or none at all.
  it('offers the way back in the bar, and it returns to the round', async () => {
    serve({ state: 'STARTED', players: [person('Ada')] });
    await connect();
    await openPanel();

    const back = screen.getByRole('button', { name: /back to the round/i });
    // ABOVE the list, which jsdom can answer honestly — unlike "in the bar",
    // which is a geometric claim it would answer `true` to no matter what.
    const tabs = screen.getByRole('tablist', { name: /session/i });
    expect(back.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(back);
    expect(screen.queryByRole('tablist', { name: /session/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /players & rounds/i })).toBeInTheDocument();
  });

  // Rejects: leaving the panel open after a choice, and rejects a back button
  // that survives the return. The host chose; what they need next is the meter.
  it('closes itself when a question is asked from the Questions tab', async () => {
    serve({ state: 'ASK#002' });
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /choose next question/i }));
    await screen.findByText('Which pricing change?');

    fireEvent.click(screen.getByRole('button', { name: /ask this next/i }));

    await waitFor(() =>
      expect(screen.queryByRole('tablist', { name: /session/i })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /back to the round/i })).not.toBeInTheDocument();
  });
});

describe('the remote paints dusk, not the document\'s paper', () => {
  /**
   * `public/index.html:2` is `<html data-theme="light">`, and `:root` IS
   * `html` — so `styles.css:58-66`'s paper block wins and every token this
   * surface reads resolved to the LIGHT value until `data-theme="dark"` was put
   * on the root here. The same one-line defect and the same one-line fix as
   * `PlayerPage.jsx:69` (AUDIT citation 5).
   *
   * ASSERTED AS AN ATTRIBUTE, NOT AS A COLOUR. jsdom loads no stylesheet and
   * resolves no custom property, so `getComputedStyle(...).backgroundColor`
   * here is the empty string whether the fix is present or not.
   */
  it('declares the dark theme on its root, in both views', async () => {
    serve({ state: 'STARTED' });
    render(<HostRemote />);
    expect(document.querySelector('.hr--entry')).toHaveAttribute('data-theme', 'dark');

    fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.queryByLabelText(/session code/i)).not.toBeInTheDocument());
    expect(document.querySelector('.hr')).toHaveAttribute('data-theme', 'dark');
  });

  // The panel and the browser render INSIDE `.hr`, so they inherit that theme
  // and must not re-declare one. A second declaration is a second thing to keep
  // in step, and the failure mode is a pane in the other polarity.
  it('does not re-declare a theme on the panel inside it', async () => {
    serve({ state: 'STARTED', players: [person('Ada')] });
    await connect();
    await openPanel();
    expect(document.querySelector('.hrs')).not.toHaveAttribute('data-theme');
  });
});

/* ------------------------------------------------------- the CSS contract */

const PANEL_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'RemoteSessionPanel.css'), 'utf8',
);
const REMOTE_CSS = fs.readFileSync(path.join(__dirname, '..', 'HostRemote.css'), 'utf8');

/** Comments stripped, so a hex or a selector inside prose is not a finding. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule's declaration block, by exact selector. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = strip(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — did the selector get renamed?`);
  return match[2];
}

describe('the session panel stylesheet', () => {
  // Rejects: a bare `.row`, `.tab`, `.badge` or `.list`. styles.css is an
  // 11,665-line unscoped monolith that already owns names like those, and a
  // collision would repaint a surface nobody was editing.
  it('declares nothing outside its own scope', () => {
    const selectors = strip(PANEL_CSS)
      .replace(/@media[^{]*\{/g, '')
      .match(/(^|\})\s*([^{}@]+)\{/gm) || [];
    const offenders = selectors
      .map((s) => s.replace(/^\}?\s*/, '').replace(/\s*\{$/, '').trim())
      // Split on the commas that separate SELECTORS, not on the ones inside
      // `:is(button, input)` — which would produce "input)" and read as an
      // unscoped element selector.
      .flatMap((s) => s.split(/,(?![^(]*\))/))
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith('.hrs'));
    expect(offenders).toEqual([]);
  });

  // Rejects: a raw hex creeping in. Every colour on this surface is a
  // styles.css token whose contrast is already measured; a literal is a pairing
  // nobody has measured, on the one screen a host reads in a dim room.
  it('uses tokens for colour and declares no hex of its own', () => {
    expect(strip(PANEL_CSS).match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
  });

  // THE HARD RULE. `--danger` is 4.38:1 on `--surface` and 3.56:1 on
  // `--surface-2` — under AA. It may hold borders and bar fills; `--danger-text`
  // is what exists for copy.
  it('never puts text in --danger', () => {
    expect(strip(PANEL_CSS)).not.toMatch(/color:\s*var\(--danger\)/);
  });

  // An undefined custom property invalidates the WHOLE declaration, silently.
  // Every var here must be one styles.css declares or one this file declares.
  it('borrows no custom property that is not declared somewhere', () => {
    const GLOBAL = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    const declared = new Set(
      [...strip(PANEL_CSS).matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1])
        .concat([...GLOBAL.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1])),
    );
    const used = [...strip(PANEL_CSS).matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });

  /**
   * THE PHONE'S TAP FLOOR.
   *
   * 44px is the platform minimum and this surface is pressed one-handed, in a
   * dim room, by someone looking at people rather than at the phone. The remote
   * already sets 48px on its own buttons (`.hr-btn`), and the two controls
   * added here — the tab and the round row — are pressed just as often.
   *
   * ASSERTED FROM THE STYLESHEET, NOT FROM A RECT. `getBoundingClientRect()` is
   * all zeroes in jsdom, so a rendered assertion here would pass against a
   * stylesheet with no heights in it at all.
   */
  it('gives every control a thumb-sized target', () => {
    expect(block(PANEL_CSS, '.hrs')).toMatch(/--hrs-tap:\s*48px/);
    expect(block(PANEL_CSS, '.hrs-tab')).toMatch(/min-height:\s*var\(--hrs-tap\)/);
    expect(block(PANEL_CSS, '.hrs-round')).toMatch(/min-height:\s*var\(--hrs-tap\)/);
    expect(block(PANEL_CSS, '.hrs-row')).toMatch(/min-height:\s*44px/);
    expect(block(REMOTE_CSS, '.hr-back')).toMatch(/width:\s*44px/);
    expect(block(REMOTE_CSS, '.hr-back')).toMatch(/height:\s*44px/);
  });

  /**
   * THE TRUNCATION TRAP, twice.
   *
   * `text-overflow` is INERT on a flex container with span children — the text
   * is cut with no ellipsis and nothing to recover it. A truncating element has
   * to be a single text node with `min-width: 0`. AdminShell.css:229-238
   * documents the same trap; a player's name and a tab's label are exactly the
   * strings long enough to hit it.
   */
  it('truncates the name and the tab label as single text nodes', () => {
    for (const selector of ['.hrs-name', '.hrs-tab']) {
      const rule = block(PANEL_CSS, selector);
      expect(rule).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule).toMatch(/min-width:\s*0/);
      expect(rule).not.toMatch(/display:\s*flex/);
    }
  });

  // Rejects: a fixed row width or a nowrap list that pushes the page sideways.
  // `.hr` sets `overflow-x: hidden`, so anything that overflows is not merely
  // ugly — it is unreachable.
  it('lets every column shrink rather than widening the page', () => {
    expect(block(PANEL_CSS, '.hrs')).toMatch(/min-width:\s*0/);
    expect(block(PANEL_CSS, '.hrs-pane')).toMatch(/min-width:\s*0/);
    expect(strip(PANEL_CSS)).not.toMatch(/\bwidth:\s*\d+px/);
  });

  /**
   * THE PANEL DOES NOT OWN THE DOCK, AND THAT IS THE NAVIGATION DECISION.
   *
   * If a future change gives this stylesheet a fixed bottom bar, the advance
   * button is either covered or replaced — which is exactly what the old
   * full-screen browser did and what this panel exists to stop.
   */
  it('declares no dock of its own', () => {
    expect(strip(PANEL_CSS)).not.toMatch(/position:\s*fixed/);
  });

  /**
   * NOT A STAGE DISPLAY PROFILE.
   *
   * `config/displayProfile.js`'s four profiles (`.d-room`, `.d-tv`, `.d-call`,
   * `.d-table`) are derived for screens a ROOM reads from 2 to 30 feet away.
   * None of them is a phone at 14 inches, and Table's 16px floor is a laptop's.
   * This surface follows the entry/welcome pattern instead — one ladder. If a
   * consistency pass ever wires a `--L-*` ladder in here, it is importing the
   * projector's arithmetic onto a phone.
   */
  it('uses no stage ladder', () => {
    expect(strip(PANEL_CSS)).not.toMatch(/var\(--L-/);
    expect(strip(PANEL_CSS)).not.toMatch(/\.d-(room|tv|call|table)/);
  });
});
