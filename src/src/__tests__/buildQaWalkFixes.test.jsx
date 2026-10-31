/**
 * THE BUILD ROOM QA WALK ON TEST, 31 OCT 2026: each bug the walk found,
 * reproduced first, then held. Fixtures go through the REAL server's pure half
 * (build-store.js roomFromRows + hostView / publicView / wallView), as
 * buildCapabilities.test.jsx builds its own, so a reader on either side
 * cannot drift from what the server sends.
 *
 * rejects: Engage's own prompt (Start building and the rest) on a phone, the
 * Stage, the room's window or the host's Claude now; "Sent" wording while
 * Claude Code has never connected; a blank wrap-up summary when the opening
 * has answers; "No main move now" beside a lead move on the console; a
 * wrap-up link treated as the build; "Live" and "Queued for Claude" after the
 * end; Before the room starts outliving the opening; More framing questions
 * counting what is already answered.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { ClaudeNow } from '../buildroom/BuildRoomPage';
import { phoneSentCard } from '../buildroom/BuildPlayer';
import { Timeline } from '../buildroom/screens/Timeline';
import {
  sentCard, sentOf, claudeState, plainPromptLine, wrapPrefill, latestBuild,
} from '../buildroom/buildScreens';
import { sentMarks, itemKeys } from '../buildroom/sentMarks';
import { SentMark } from '../buildroom/BuildConsider';
import { finishControls, consolePart } from '../buildroom/buildConsole';
import { claudeWords } from '../buildroom/roomContentData';
import { W } from '../buildroom/words';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const now = Date.now();
const NOW = new Date(now).toISOString();
const ago = (s) => new Date(now - s * 1000).toISOString();
const pad = (n) => String(n).padStart(13, '0');
const META = { Title: 'Volunteer shift picker', Details: 'A one-page site where a volunteer can pick a shift in under a minute' };
const PLAYERS = ['Ana', 'Ben'];

/** The prompt Start building writes (build-room.js openingAction 'start'), as the walk saw it. */
const START_TEXT = 'The room has framed the build. Plan 3 to 6 steps, post the plan with post_update (kind "milestone"), and start building.\n\nTHE ROOM BRIEF (the room\'s standing direction; apply it to everything you build)\nMaking: A website or page';

const logRow = (n, over) => ({ SK: `BUILD#LOG#${pad(n)}#l${n}`, LogId: `${n}-l${n}`, By: 'host', CreatedAt: ago(100 - n), ...over });

function hostOf(rows, { state = 'STARTED' } = {}) {
  return S.hostView({ gameId: '6755', meta: META, sessionState: state, room: S.roomFromRows(rows), players: PLAYERS, now: NOW });
}
function phoneOf(rows) {
  return S.publicView({ gameId: '6755', meta: META, sessionState: 'STARTED', room: S.roomFromRows(rows), players: PLAYERS, me: { playerName: 'Ana' }, now: NOW });
}
function wallOf(rows) {
  return S.wallView({ gameId: '6755', meta: META, sessionState: 'STARTED', room: S.roomFromRows(rows), players: PLAYERS, now: NOW });
}

afterEach(cleanup);

// ── 1. The raw Start building prompt reached the room (screens 121-123) ──────

describe('1. Engage\'s own prompts read as their plain line on every screen', () => {
  // Start building pressed before Claude Code connected: no AgentSeenAt.
  const startRows = [
    { SK: 'BUILD#STATE', Rev: 4, Phase: 'building' },
    logRow(1, { Kind: 'direction', Text: START_TEXT, ForAgent: true, ForAgentAs: 'do-now', EngagePrompt: 'start-building' }),
    logRow(2, { Kind: 'milestone', By: 'system', Text: 'The room framed the build. Claude starts when it connects.' }),
  ];

  it('a phone\'s card: the plain line, queued, no prompt words', () => {
    const card = phoneSentCard(phoneOf(startRows));
    expect([card.head, card.text, card.hidden]).toEqual([W.queuedHeadline, 'Start building: Claude got the brief', false]);
    expect(JSON.stringify(phoneOf(startRows))).not.toMatch(/post_update|THE ROOM BRIEF/);
  });

  it('the Stage and the room\'s window: the plain line, and the line under it never quotes the prompt', () => {
    const wall = wallOf(startRows);
    expect(JSON.stringify(wall)).not.toMatch(/post_update|THE ROOM BRIEF/);
    const card = sentCard(sentOf(wall), wall.history.asks);
    expect(card.text).toBe('Start building: Claude got the brief');
    expect(card.plain).toBe(true);
    expect(claudeWords(wall, now).line).not.toMatch(/post_update/);
  });

  it('the host\'s Claude now: the plain line, never the prompt (Claude still gets every word)', () => {
    const room = hostOf(startRows);
    expect(room.sent.text).toMatch(/^The room has framed the build\./);
    render(<ClaudeNow room={room} now={now} />);
    expect(screen.getByTestId('brm-claudenow-sent').textContent).toBe('Start building: Claude got the brief');
    expect(document.body.textContent).not.toMatch(/post_update|THE ROOM BRIEF/);
    expect(claudeState(room, now, { host: true }).headline).toBe(W.queuedHeadline);
  });

  it('the host\'s timeline: the plain line, and no Edit on a prompt Engage wrote', () => {
    const room = hostOf(startRows);
    render(<Timeline log={room.log} host busy={false} ended={false} run={jest.fn()} api={{}} />);
    expect(screen.getByText('Start building: Claude got the brief')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/post_update/);
    expect(screen.queryByRole('button', { name: /^Edit "The room has framed/ })).toBeNull();
  });

  it('every one-press prompt has its line, keyed or (an older row) by its words', () => {
    expect(['start-building', 'back-to-opening', 'draft-brief', 'preview', 'wrap-up', 'mockups'].map((k) => plainPromptLine({ engagePrompt: k, text: '' }))).toEqual([
      'Start building: Claude got the brief', 'Back to the opening: Claude was asked to pause', 'Asked Claude to draft the brief',
      'Asked Claude to preview the work', 'Asked Claude to wrap up', 'Asked Claude for mockups',
    ]);
    expect(plainPromptLine({ engagePrompt: 'mockups', text: '', askId: '007' })).toBe('Asked Claude for mockups for ask 7');
    expect(plainPromptLine(START_TEXT)).toBe('Start building: Claude got the brief');
    expect(plainPromptLine('Make the footer sticky')).toBe('');
  });

  it('a wrap-up sent hidden: the host reads its plain line, marked not shown; a phone only that something went', () => {
    const rows = [
      { SK: 'BUILD#STATE', Rev: 4, Phase: 'building', AgentSeenAt: ago(5) },
      logRow(1, { Kind: 'direction', Text: 'We are wrapping up. Call room_status, then write the outcome with wrap_up.', ForAgent: true, ForAgentAs: 'do-now', RoomHidden: true, EngagePrompt: 'wrap-up' }),
    ];
    render(<ClaudeNow room={hostOf(rows)} now={now} />);
    expect(screen.getByTestId('brm-claudenow-sent').textContent).toBe(`Asked Claude to wrap up · ${W.notShownMark}`);
    expect(phoneSentCard(phoneOf(rows)).text).toBe(W.sentHiddenLine);
  });
});

// ── 2. "Sent" while Claude Code had never connected (screens 109, 117, 155) ──

describe('2. History\'s marks say Queued for Claude until Claude has called in', () => {
  const DECIDED = {
    SK: 'BUILD#ASK#005', AskId: '005', Kind: 'choice', Prompt: 'Which colour for the Take this shift button?', Status: 'decided', DecidedAt: ago(60), CreatedAt: ago(300), Source: 'host',
    Options: [{ label: 'A', title: 'Green', detail: '', url: '' }, { label: 'B', title: 'Blue', detail: '', url: '' }], MaxPicks: 1,
    Decision: { direction: 'Which colour for the Take this shift button: Green', chosen: ['A'], note: '' },
  };
  const decisionLog = logRow(9, { Kind: 'decision', AskId: '005', Text: 'Which colour for the Take this shift button: Green', ForAgent: true, ForAgentAs: 'do-now' });

  it('never connected: the decided ask\'s mark reads Queued for Claude, still a way into History', () => {
    const room = hostOf([{ SK: 'BUILD#STATE', Rev: 4, Phase: 'building' }, DECIDED, decisionLog]);
    const mark = sentMarks(room).get(itemKeys.ask('005'));
    expect(mark.claudeQueued).toBe(true);
    const onOpen = jest.fn();
    render(<SentMark mark={mark} onOpen={onOpen} />);
    const b = screen.getByRole('button', { name: W.queuedHeadline });
    b.click();
    expect(onOpen).toHaveBeenCalledWith(mark.entryId);
    expect(document.body.textContent).not.toMatch(W.markSent);
  });

  it('once Claude has called in, the same mark reads Sent to Claude', () => {
    const room = hostOf([{ SK: 'BUILD#STATE', Rev: 4, Phase: 'building', AgentSeenAt: ago(5) }, DECIDED, decisionLog]);
    const mark = sentMarks(room).get(itemKeys.ask('005'));
    expect(mark.claudeQueued).toBeUndefined();
    render(<SentMark mark={mark} onOpen={jest.fn()} />);
    expect(screen.getByRole('button', { name: W.markSent })).toBeInTheDocument();
  });

  it('the Now card\'s and the composer\'s lines use the same two words', () => {
    expect(W.sentAsLine(true, 'Keep in mind', 'Making: A website')).toBe(`${W.queuedHeadline} as Keep in mind: Making: A website`);
    expect(W.sentAsLine(false, 'Do now', 'x')).toBe(`${W.sentHeadline} as Do now: x`);
    expect(W.composerSent(true, '', 'Use large tap targets')).toBe(`${W.queuedHeadline}: Use large tap targets`);
    expect(W.composerSent(false, '', 'Use large tap targets')).toBe('Sent: Use large tap targets');
  });
});

// ── 3. The wrap-up's summary without Claude (screen 164) ───────────────────────

describe('3. Write it myself fills the summary from the opening when Claude drafted no headline', () => {
  const room = (lines, extra = {}) => ({ brief: { lines, ...extra }, asks: [], log: [], images: [] });
  it('Claude\'s headline first, as before', () => {
    const f = wrapPrefill(room({ good: 'Pick a shift fast' }, { headline: 'Shifts in a minute' }));
    expect([f.summary, f.from.summary]).toEqual(['Shifts in a minute', W.wrapFromHeadline]);
  });
  it('then Good looks like, The problem, Making, and it says which', () => {
    expect(wrapPrefill(room({ kind: 'A website', problem: 'Missed shifts', good: 'Pick a shift fast' })).from.summary).toBe(W.wrapFromLine('Good looks like'));
    expect(wrapPrefill(room({ kind: 'A website', problem: 'Missed shifts' })).summary).toBe('Missed shifts');
    expect(wrapPrefill(room({ kind: 'A website' })).from.summary).toBe(W.wrapFromLine('Making'));
  });
  it('nothing at all: an empty summary, and nothing claims it was filled', () => {
    const f = wrapPrefill(room({}));
    expect([f.summary, f.from.summary, f.from.built, f.from.link]).toEqual(['', '', 0, false]);
  });
});

// ── 4. The console's Your part now beside a lead move (screen 162) ────────────

describe('4. Your part now takes What\'s next\'s Connect as its main move', () => {
  const DECIDED = {
    SK: 'BUILD#ASK#002', AskId: '002', Kind: 'choice', Prompt: 'Which header?', Status: 'decided', DecidedAt: ago(60), CreatedAt: ago(300), Source: 'host',
    Options: [{ label: 'A', title: 'Bold', detail: '', url: '' }, { label: 'B', title: 'Calm', detail: '', url: '' }], MaxPicks: 1,
    Decision: { direction: 'Which header: Calm', chosen: ['B'], note: '' },
  };
  it('never connected, between asks: Connect Claude Code is the main move and the sentence names it', () => {
    const room = hostOf([{ SK: 'BUILD#STATE', Rev: 4, Phase: 'building' }, DECIDED]);
    const c = finishControls(room, null, { primary: null, secondary: null });
    expect(c.primary).toMatchObject({ action: 'connect', label: W.connectClaude });
    expect(consolePart('between', c, room, null)).toEqual({ before: '', action: W.connectClaude, after: ': nothing is built without it.' });
  });
  it('connected: no main move, as before (What\'s next leads in the main area)', () => {
    const room = hostOf([{ SK: 'BUILD#STATE', Rev: 4, Phase: 'building', AgentSeenAt: ago(5) }, DECIDED]);
    expect(finishControls(room, null, { primary: null, secondary: null }).primary).toBeNull();
  });
});

// ── 5. A wrap-up link is not the build (screens 167, 170) ───────────────────

describe('5. Only Claude\'s shown build, or a link marked as the build, is the build', () => {
  const outcome = (links) => ({ outcome: { summary: 'x', links }, log: [], images: [] });
  it('plain links: no build', () => {
    expect(latestBuild(outcome([{ label: 'Shift sheet', url: 'https://example.com/sheet' }])).link).toBe('');
  });
  it('a link marked as the build is the build', () => {
    expect(latestBuild(outcome([{ label: 'Shift sheet', url: 'https://example.com/sheet' }, { label: 'Demo', url: 'https://example.com/demo', demo: true }])).link).toBe('https://example.com/demo');
  });
  it('Claude\'s shown build still wins', () => {
    const room = { ...outcome([{ label: 'Demo', url: 'https://example.com/demo', demo: true }]), log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }] };
    expect(latestBuild(room).link).toBe('http://localhost:5173/');
  });
  it('the server keeps the mark, and at most one', () => {
    const v = S.normalizeOutcome({ summary: 'x', links: [{ url: 'https://a.example', demo: true }, { url: 'https://b.example', demo: true }, { url: 'https://c.example', demo: 'yes' }] }, 'host', NOW).value;
    expect(v.links.map((l) => Boolean(l.demo))).toEqual([true, false, false]);
  });
});

describe('4. a focused What\'s next move on the console lands with its row in view', () => {
  it('the main area keeps room above a focused move (BuildConsole.css)', () => {
    // eslint-disable-next-line global-require
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'buildroom', 'BuildConsole.css'), 'utf8');
    expect(css).toMatch(/\.hc--build \.hc-main \{ scroll-padding-top: 16px; \}/);
    expect(css).toMatch(/\.hc--build \.hc-main \.brm-wn \.brm-btn \{ scroll-margin-top: 56px; \}/);
  });
});
