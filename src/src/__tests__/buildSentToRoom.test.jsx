/**
 * SENT TO CLAUDE, DON'T SHOW THE ROOM, AND LIVE TYPING (owner, 23 Oct 2026:
 * "nobody can see what Claude was actually told"; "live typing can be local
 * only with the room window. but once entered, the phones, laptops can see").
 *
 * rejects: a send that never reaches the Stage, the room's window or a phone;
 * a card that outlives the next ask; the words of a send the host kept from
 * the room on any screen the room sees (the host's one screen included), or in
 * the room's History; a host view that loses the words; the typing toggle on
 * one screen, or on by default; a mirror that floods the channel, mirrors the
 * Why, or never clears; a browser without BroadcastChannel crashing.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import BuildStageScreen from '../buildroom/screens/BuildStageScreen';
import { Timeline } from '../buildroom/screens/Timeline';
import { DecidePanel, ClaudeNow } from '../buildroom/BuildRoomPage';
import BuildPlayer, { phoneSentCard } from '../buildroom/BuildPlayer';
import {
  SendOptionsProvider, SendExtras, useMirror,
} from '../buildroom/BuildSendOptions';
import {
  createTypingSender, listenForTyping, openTypingChannel, mirrorKey, typingChannelName, TYPING_THROTTLE_MS, TYPING_CLEAR_MS, TYPING_MAX,
} from '../buildroom/typingMirror';
import { useHostTyping } from '../present/buildwall/BuildWall';
import {
  sentCard, sentOf, roomStory, decideBody,
} from '../buildroom/buildScreens';
import { wallRoom } from '../present/buildwall/wallRoom';
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
const F = require('../testing/buildWallFixture');

const now = Date.now();
const ago = (s) => new Date(now - s * 1000).toISOString();
const SECRET = 'SECRET-WORDS-91 rename the pricing tiers';

/** An in-memory BroadcastChannel: every channel of one name hears the others. */
const bus = new Map();
class FakeChannel {
  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    this.posted = [];
    if (!bus.has(name)) bus.set(name, new Set());
    bus.get(name).add(this);
  }

  postMessage(data) {
    this.posted.push(data);
    bus.get(this.name).forEach((c) => { if (c !== this) c.listeners.forEach((fn) => fn({ data })); });
  }

  addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }

  removeEventListener(type, fn) { this.listeners.delete(fn); }

  close() { bus.get(this.name).delete(this); }
}

afterEach(() => {
  cleanup();
  bus.clear();
  delete global.BroadcastChannel;
  try { window.localStorage.clear(); } catch (e) { /* none */ }
});

// ── The card, per kind of send ─────────────────────────────────────────────

const asks = [{ askId: '003', openedAt: ago(600) }];
const card = (sent, list = asks) => sentCard(sentOf({ sent }), list);

describe('the Sent to Claude card, for every kind of send', () => {
  it('a decided ask: the words and the room\'s pick', () => {
    const c = card({ verb: 'decided', text: 'Go with the calm photo header', askId: '003', at: ago(20), pick: { method: 'vote', items: [{ label: 'B', title: 'Calm photo' }] } });
    expect([c.head, c.text, c.pick, c.hidden]).toEqual(['Sent to Claude', 'Go with the calm photo header', 'The room chose B · Calm photo', false]);
  });
  it('a decision the host reworded: the host\'s words, and still the pick it came from', () => {
    const c = card({ verb: 'decided', text: 'Calm photo, with a darker overlay for contrast', askId: '003', at: ago(20), pick: { method: 'host', items: [{ label: 'B', title: 'Calm photo' }] } });
    expect([c.text, c.pick]).toEqual(['Calm photo, with a darker overlay for contrast', 'The host chose B · Calm photo']);
  });
  it.each([
    ['Add something / a direct message', 'told', 'Make the footer sticky'],
    ["Consider's Send to Claude", 'told', 'Dark mode, toggle in the header'],
    ['the Later list', 'told', 'An export button'],
    ["What's next's Combine, sent from the composer", 'told', 'Which header?: Calm photo. Which footer?: Bold'],
    ['Ask Claude', 'asked', 'Is a calendar view possible this hour?'],
  ])('%s: the words, no pick', (_, verb, text) => {
    const c = card({ verb, text, at: ago(10) });
    expect([c.text, c.pick, c.hidden]).toEqual([text, '', false]);
  });
  it('a send the host kept from the room: only that something went', () => {
    expect(card({ verb: 'told', text: '', hidden: true, at: ago(10) })).toMatchObject({ text: W.sentHiddenLine, pick: '', hidden: true });
    // The host's own read keeps the words; the card never draws them.
    expect(card({ verb: 'decided', text: SECRET, hidden: true, at: ago(10), pick: { method: 'vote', items: [{ label: 'B', title: 'x' }] } })).toMatchObject({ text: W.sentHiddenLine, pick: '' });
  });
  it('goes when the next ask opens, and is never there with nothing sent', () => {
    expect(card({ verb: 'told', text: 'x', at: ago(700) })).toBeNull();
    expect(card({ verb: 'told', text: 'x', at: ago(10) }, [...asks, { askId: '004', openedAt: ago(5) }])).toBeNull();
    expect(sentCard(sentOf({}), asks)).toBeNull();
  });
});

// ── The Stage: the host's one screen and the room's window ──────────────────

/** The room's window, read through the real wall read, with one more log row. */
function wallWith(extra) {
  const rows = F.rows({ now }).concat(extra);
  const body = S.wallView({
    gameId: '4821', meta: { Title: 'Volunteer sign-up' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: F.NAMES.slice(), now: new Date(now).toISOString(),
  });
  return wallRoom(body);
}
const dirRow = (over = {}) => ({ SK: `BUILD#LOG#${String(now - 5000).padStart(15, '0')}#x1`, LogId: 'x1', Kind: 'direction', Text: SECRET, ForAgent: true, ForAgentAs: 'do-now', By: 'host', CreatedAt: ago(5), ...over });

describe('the Stage', () => {
  it('the room\'s window: a shared direction leads, word for word, with Claude\'s status under it', () => {
    const room = wallWith(dirRow({ Text: 'Make the footer sticky' }));
    const { container } = render(<BuildStageScreen room={room} now={now} profile="room" />);
    expect(container.querySelector('[data-room-moment]').getAttribute('data-room-moment')).toBe('BUILD_SENT');
    expect(container.querySelector('.brm-sentq').textContent).toBe('“Make the footer sticky”');
    expect(container.querySelector('[data-testid="brm-sentcard"] [data-claude-status]')).not.toBeNull();
    expect(container.querySelectorAll('button, a').length).toBe(0);
  });
  it('the room\'s window: a hidden send says only that something went', () => {
    const room = wallWith(dirRow({ RoomHidden: true }));
    const { container } = render(<BuildStageScreen room={room} now={now} profile="room" />);
    expect(container.querySelector('.brm-sentq').textContent).toBe(W.sentHiddenLine);
    expect(container.textContent).not.toContain('SECRET-WORDS-91');
  });
  it('the host\'s one screen: its read has the words, the Stage never draws them', () => {
    const view = S.hostView({
      gameId: '4821', meta: { Title: 'x' }, sessionState: 'STARTED', room: S.roomFromRows(F.rows({ now }).concat(dirRow({ RoomHidden: true }))), players: [], now: new Date(now).toISOString(),
    });
    expect([view.sent.text, view.sent.hidden]).toEqual([SECRET, true]);
    const { container } = render(<BuildStageScreen room={view} now={now} profile="room" />);
    expect(container.querySelector('.brm-sentq').textContent).toBe(W.sentHiddenLine);
    expect(container.textContent).not.toContain('SECRET-WORDS-91');
  });
  it('a new ask leads as before', () => {
    const room = wallWith(dirRow({ Text: 'Make the footer sticky' }));
    room.asks = [...room.asks, { ...room.asks[0], askId: '009', status: 'live', openedAt: ago(1), decision: null }];
    room.currentAskId = '009';
    const { container } = render(<BuildStageScreen room={room} now={now} profile="room" />);
    expect(container.querySelector('[data-testid="brm-sentcard"]')).toBeNull();
  });
});

// ── The phone ──────────────────────────────────────────────────────────────

describe('the phone\'s Now', () => {
  const API = 'http://localhost:3000/api/';
  const view = (over) => ({
    gameId: '4821', title: 'T', goal: '', state: 'STARTED', playerCount: 3, currentAskId: null, current: null, decisions: [], log: [], myIdeas: [],
    outcome: null, agentConnected: true, mine: { responses: [], vote: [], answer: null }, rev: 1, history: { asks: asks.slice(), ideas: [], sent: [] }, ...over,
  });
  const mount = async (v) => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => v }));
    await act(async () => { render(<BuildPlayer gameId="4821" playerName="Priya" clientId="c1" apiBase={API} rev={0} />); });
  };
  it('a shared send: the words and the pick, above Claude\'s status', async () => {
    await mount(view({ sent: { verb: 'decided', text: 'Go with the calm photo header', askId: '003', at: ago(10), pick: { method: 'vote', items: [{ label: 'B', title: 'Calm photo' }] } } }));
    const c = await screen.findByTestId('bpl-sentcard');
    expect(c.textContent).toContain('“Go with the calm photo header”');
    expect(c.textContent).toContain('The room chose B · Calm photo');
    // eslint-disable-next-line no-bitwise
    expect(c.compareDocumentPosition(screen.getByText('Claude is building')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('a hidden send: only that something went', async () => {
    await mount(view({ sent: { verb: 'told', text: '', hidden: true, at: ago(10) } }));
    expect((await screen.findByTestId('bpl-sentcard')).textContent).toContain(W.sentHiddenLine);
  });
  it('no card once the next ask opened', () => {
    expect(phoneSentCard(view({ sent: { verb: 'told', text: 'x', at: ago(10) }, current: { askId: '004', openedAt: ago(2) } }))).toBeNull();
  });
});

// ── History: the room's copy and the host's ────────────────────────────────

describe('History', () => {
  const entry = (over) => ({ logId: 'e1', kind: 'direction', considered: true, forAgent: true, createdAt: ago(10), from: { askIds: [], ideaIds: [], items: ['resp:003:r1'] }, ...over });
  it('the room\'s copy marks it "Sent to Claude, not shown", with no words and no why', () => {
    const [it] = roomStory({ log: [entry({ text: '', why: '', hidden: true })], asks: [], gave: [] });
    expect([it.text, it.notShown, it.sent]).toEqual([W.historyNotShown, 'blank', undefined]);
  });
  it('the host\'s copy keeps the words, with the mark', () => {
    const [it] = roomStory({ log: [entry({ text: SECRET, why: 'because', hidden: true })], asks: [], gave: [] });
    expect([it.text, it.notShown]).toEqual([SECRET, 'mark']);
  });
  it('a hidden decision: the room sees the ask, not the words', () => {
    const ask = { askId: '003', status: 'decided', decidedAt: ago(5), decision: { direction: '', chosen: ['B'], hidden: true } };
    const items = roomStory({ log: [], asks: [ask], gave: [] });
    expect(items.find((i) => i.type === 'decided')).toMatchObject({ text: W.historyNotShown, notShown: 'blank' });
  });
  it('the host\'s timeline says "not shown to the room"; the room\'s copy has no words', () => {
    const { container, unmount } = render(<Timeline log={[{ logId: 'a', kind: 'idea', text: SECRET, hidden: true, by: 'room', createdAt: ago(3) }]} host busy={false} ended run={() => {}} api={null} deleteAs="" />);
    expect(container.textContent).toContain(SECRET);
    expect(container.textContent).toContain(W.notShownMark);
    unmount();
    const room = render(<Timeline log={[{ logId: 'a', kind: 'idea', text: '', hidden: true, by: 'room', createdAt: ago(3) }]} host={false} busy={false} ended run={() => {}} api={null} deleteAs="" />);
    expect(room.container.textContent).toContain(W.historyNotShown);
    expect(room.container.textContent).not.toContain(W.notShownMark);
  });
});

// ── The host's own screens ─────────────────────────────────────────────────

// Claude now, the right column's first section on both layouts (owner, 28 Oct 2026), carries
// what the console's status line said.
describe('the host\'s Claude now (Host screen, console)', () => {
  it('shows the full words with a small "not shown to the room" mark', () => {
    const room = { sent: { verb: 'told', text: SECRET, hidden: true, at: ago(5) }, agent: { connected: true }, log: [] };
    render(<ClaudeNow room={room} now={now} />);
    const line = screen.getByTestId('brm-claudenow-sent');
    expect(line.textContent).toBe(`“${SECRET}” · ${W.notShownMark}`);
  });
});

// ── Don't show the room, beside Send ───────────────────────────────────────

describe('"Don\'t show the room"', () => {
  const ask = {
    askId: '004', kind: 'choice', prompt: 'Which?', status: 'results', options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }],
    results: { total: 3, options: [{ label: 'A', title: 'Calm', count: 1 }, { label: 'B', title: 'Playful', count: 2 }] },
  };
  const run = async (fn) => fn();
  it('is unticked by default: the decision goes without the flag', async () => {
    const askAction = jest.fn(async () => ({ ask: {} }));
    render(<DecidePanel ask={ask} busy={false} run={run} api={{ askAction }} playerCount={3} />);
    expect(screen.getByRole('checkbox', { name: W.hideFromRoom }).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Send B to Claude' }));
    await waitFor(() => expect(askAction).toHaveBeenCalledTimes(1));
    expect(askAction.mock.calls[0][1]).not.toHaveProperty('hideFromRoom');
  });
  it('ticked, the body carries hideFromRoom: true; the words go unchanged', async () => {
    const askAction = jest.fn(async () => ({ ask: {} }));
    render(<DecidePanel ask={ask} busy={false} run={run} api={{ askAction }} playerCount={3} />);
    fireEvent.click(screen.getByRole('checkbox', { name: W.hideFromRoom }));
    fireEvent.click(screen.getByRole('button', { name: 'Send B to Claude' }));
    await waitFor(() => expect(askAction).toHaveBeenCalledTimes(1));
    expect(askAction.mock.calls[0][1]).toMatchObject({ action: 'decide', hideFromRoom: true });
  });
  it('never rides on a decision that is only recorded', () => {
    expect(decideBody(ask, { direction: 'x', chosen: ['B'], send: false, hide: true })).not.toHaveProperty('hideFromRoom');
  });
});

// ── Live typing: the toggle, the throttle, the window ──────────────────────

function Box() {
  const m = useMirror();
  return (
    <>
      <SendExtras hide={false} setHide={() => {}} />
      <textarea aria-label="Direction for Claude" onChange={(e) => m.draft(e.target.value)} />
      <input aria-label="Why?" onChange={() => {}} />
      <button type="button" onClick={m.done}>Send</button>
    </>
  );
}

describe('"Show my typing to the room"', () => {
  it('is not offered on one screen', () => {
    render(<SendOptionsProvider gameId="4821" twoScreens={false}><Box /></SendOptionsProvider>);
    expect(screen.queryByRole('checkbox', { name: new RegExp(W.mirrorTyping) })).toBeNull();
  });
  it('on two screens it is offered, off by default, and remembered per session', () => {
    const { unmount } = render(<SendOptionsProvider gameId="4821" twoScreens><Box /></SendOptionsProvider>);
    const box = screen.getByRole('checkbox', { name: new RegExp(W.mirrorTyping) });
    expect(box.checked).toBe(false);
    expect(screen.getByText(W.mirrorTypingTip)).toBeInTheDocument();
    fireEvent.click(box);
    expect(window.localStorage.getItem(mirrorKey('4821'))).toBe('on');
    unmount();
    render(<SendOptionsProvider gameId="4821" twoScreens><Box /></SendOptionsProvider>);
    expect(screen.getByRole('checkbox', { name: new RegExp(W.mirrorTyping) }).checked).toBe(true);
    cleanup();
    render(<SendOptionsProvider gameId="5555" twoScreens><Box /></SendOptionsProvider>);
    expect(screen.getByRole('checkbox', { name: new RegExp(W.mirrorTyping) }).checked).toBe(false);
  });
  it('on: the direction box goes to the session\'s channel; the Why never does; Send clears it', () => {
    global.BroadcastChannel = FakeChannel;
    window.localStorage.setItem(mirrorKey('4821'), 'on');
    const wall = new FakeChannel(typingChannelName('4821'));
    const heard = [];
    wall.addEventListener('message', (e) => heard.push(e.data.text));
    render(<SendOptionsProvider gameId="4821" twoScreens><Box /></SendOptionsProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'Make it' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Why?' }), { target: { value: 'WHY-NEVER' } });
    expect(heard).toEqual(['Make it']);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(heard).toEqual(['Make it', '']);
  });
  it('off: nothing is posted', () => {
    global.BroadcastChannel = FakeChannel;
    const wall = new FakeChannel(typingChannelName('4821'));
    const heard = [];
    wall.addEventListener('message', (e) => heard.push(e.data.text));
    render(<SendOptionsProvider gameId="4821" twoScreens><Box /></SendOptionsProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'Make it' } });
    expect(heard).toEqual([]);
  });
});

describe('the throttle', () => {
  it('about 4 a second while typing, plus a final send with the last words', () => {
    let t = 0;
    const timers = [];
    const ch = { posted: [], postMessage(d) { this.posted.push(d.text); } };
    const s = createTypingSender(ch, { now: () => t, setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimer: () => {} });
    const tick = (ms) => { t += ms; timers.splice(0).forEach((x) => (x.at <= t ? x.fn() : timers.push(x))); };
    s.push('M');
    for (let i = 2; i <= 20; i += 1) { tick(50); s.push('Make it sticky'.slice(0, i)); }
    tick(TYPING_THROTTLE_MS);
    // 19 keystrokes over about a second: the first at once, then one per 250 ms, the last words always.
    expect(ch.posted.length).toBeLessThanOrEqual(6);
    expect(ch.posted[0]).toBe('M');
    expect(ch.posted[ch.posted.length - 1]).toBe('Make it sticky');
    s.clear();
    expect(ch.posted[ch.posted.length - 1]).toBe('');
  });
  it('carries at most the last 300 characters', () => {
    const ch = { posted: [], postMessage(d) { this.posted.push(d.text); } };
    createTypingSender(ch).push(`${'x'.repeat(400)}END`);
    expect(ch.posted[0].length).toBe(TYPING_MAX);
    expect(ch.posted[0].endsWith('END')).toBe(true);
  });
});

function WallTyping({ gameId = '4821', sentAt = null }) {
  const text = useHostTyping(gameId, sentAt);
  return <BuildStageScreen room={{ ...wallWith([]), sent: null }} now={now} profile="room" typing={text} />;
}

describe('the room\'s window', () => {
  it('shows "The host is writing to Claude…" with the words and a caret, in the card\'s place', () => {
    const { container } = render(<BuildStageScreen room={{ ...wallWith(dirRow({ Text: 'old send' })) }} now={now} profile="room" typing="Make the footer" />);
    const t = screen.getByTestId('brm-typing');
    expect(t.textContent).toContain(W.hostWriting);
    expect(t.querySelector('.brm-sentq').textContent).toBe('Make the footer');
    expect(t.querySelector('.brm-caret')).not.toBeNull();
    expect(container.querySelector('[data-testid="brm-sentcard"]')).toBeNull();
  });
  it('hears the laptop, clears on an empty text, after 10 s of silence, and on a new send', () => {
    jest.useFakeTimers();
    try {
      global.BroadcastChannel = FakeChannel;
      const host = new FakeChannel(typingChannelName('4821'));
      const { rerender } = render(<WallTyping />);
      act(() => { host.postMessage({ text: 'Make the footer', at: ago(0) }); });
      expect(screen.getByTestId('brm-typing').textContent).toContain('Make the footer');
      act(() => { host.postMessage({ text: '', at: ago(0) }); });
      expect(screen.queryByTestId('brm-typing')).toBeNull();
      act(() => { host.postMessage({ text: 'Again', at: ago(0) }); });
      act(() => { jest.advanceTimersByTime(TYPING_CLEAR_MS - 100); });
      expect(screen.queryByTestId('brm-typing')).not.toBeNull();
      act(() => { jest.advanceTimersByTime(200); });
      expect(screen.queryByTestId('brm-typing')).toBeNull();
      act(() => { host.postMessage({ text: 'Once more', at: ago(0) }); });
      rerender(<WallTyping sentAt={ago(0)} />);
      expect(screen.queryByTestId('brm-typing')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
  it('no BroadcastChannel: nothing is sent, nothing shows, nothing breaks', () => {
    delete global.BroadcastChannel;
    expect(openTypingChannel('4821')).toBeNull();
    expect(() => listenForTyping(null, () => {})()).not.toThrow();
    const s = createTypingSender(null);
    expect(() => { s.push('x'); s.clear(); s.close(); }).not.toThrow();
    render(<WallTyping />);
    expect(screen.queryByTestId('brm-typing')).toBeNull();
    render(<SendOptionsProvider gameId="4821" twoScreens><Box /></SendOptionsProvider>);
    expect(() => fireEvent.change(screen.getByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'x' } })).not.toThrow();
  });
});
