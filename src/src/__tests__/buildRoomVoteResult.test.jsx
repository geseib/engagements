/**
 * A BUILD ROOM ASK ON THE ROOM'S SCREENS, 18 OCT 2026 (docs/design/room-content-v2
 * frames 7 and 8; config/roomContent.js BUILD_ASK / BUILD_RESULTS). The Stage is
 * the same component on the host's one screen and on the room's window
 * (present/buildwall), so these hold both:
 *
 *   - while the ask is open the room sees what it votes on (each option's title
 *     AND its detail, on Room too) and NO tally: no count, no percent, no bar,
 *     on any kind; one small line says where to answer;
 *   - on the result the votes rise inside each option, the count large; the
 *     winner is "The room's pick" with a gold border and the room's best
 *     reason quoted;
 *   - once the host sends the decision, the result stays up with a "Sent to
 *     Claude" band carrying the direction, which is Claude's one status line
 *     (never a second Sent to Claude), until Claude says what it is doing.
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, cleanup } from '@testing-library/react';
import BuildStageScreen from '../buildroom/screens/BuildStageScreen';
import { AskStage } from '../buildroom/screens/AskStage';
import { wallRoom } from '../present/buildwall/wallRoom';
import { buildRoomContent, buildMomentOf } from '../buildroom/roomContentData';
import { bestWhy, sentStageAsk, BEST_WHY_MAX } from '../buildroom/buildScreens';
import { PROFILES } from '../config/displayProfile';

const F = require('../testing/buildWallFixture');

afterEach(cleanup);

const now = Date.now();
const ago = (s) => new Date(now - s * 1000).toISOString();

/** A wall room whose current ask carries option details, and (host-like) live results when asked. */
function wall(opts = {}, { results = null, kind = null } = {}) {
  const room = wallRoom(F.wallBody(opts));
  room.asks = room.asks.map((a) => {
    if (a.askId !== room.currentAskId) return a;
    const out = { ...a, options: a.options.map((o) => ({ ...o, detail: `OPT-DETAIL-${o.label}` })) };
    if (results) out.results = results;
    if (kind) out.kind = kind;
    return out;
  });
  return room;
}

const current = (room) => room.asks.find((a) => a.askId === room.currentAskId);

/** What the one-screen Stage reads while voting: the host's read carries live counts. */
const LIVE_COUNTS = {
  total: 3,
  options: [{ label: 'A', title: 'Bold banner', count: 1, pct: 33 }, { label: 'B', title: 'Calm photo', count: 2, pct: 67 }],
  whys: [{ label: 'B', text: 'Calmer' }],
};

const TALLY = '.brm-count, .brm-score, .brm-bar, .brm-fill, .brm-sug-votes, .brm-rating-avg, .brm-dist';

describe('frame 7: the ask while the room votes', () => {
  it.each(PROFILES)('%s: no tally text while open, even when the read carries live counts', (profile) => {
    ['live', 'voting'].forEach((status) => {
      const room = wall({ ask: status }, { results: LIVE_COUNTS });
      const { container, unmount } = render(<BuildStageScreen room={room} now={now} profile={profile} />);
      const board = container.querySelector('.brm-stage[data-room-view]');
      expect(board).not.toBeNull();
      expect(board.querySelector(TALLY)).toBeNull();
      expect(board.textContent).not.toMatch(/\d+%/);
      expect(board.textContent).not.toMatch(/\bvotes?\b/);
      expect(board.querySelector('[data-pick]')).toBeNull();
      unmount();
    });
  });

  it.each(PROFILES)('%s: each option\'s title and its detail, on Room too', (profile) => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'live' })} now={now} profile={profile} />);
    const cards = [...container.querySelectorAll('.brm-choice')];
    expect(cards.map((c) => c.querySelector('.brm-ct').textContent)).toEqual(['Choice A: Bold banner', 'Choice B: Calm photo']);
    expect(cards.map((c) => c.querySelector('.brm-cd').textContent)).toEqual(['OPT-DETAIL-A', 'OPT-DETAIL-B']);
  });

  it('the details give way together, through one gate, after the cue and never before', () => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'live' })} now={now} profile="room" />);
    const gate = container.querySelector('.brm-cdgate');
    expect(gate).not.toBeNull();
    expect(container.querySelectorAll('.brm-cd[data-drop]').length).toBe(0);
    const cue = container.querySelector('.brm-cue');
    expect(cue.textContent).toBe('Choose on your phone, and say why if you like: Claude reads the reasons.');
    expect(Number(cue.getAttribute('data-drop'))).toBeLessThan(Number(gate.getAttribute('data-drop')));
    const css = readFileSync(join(__dirname, '..', 'buildroom', 'BuildRoom.css'), 'utf8');
    expect(css).toMatch(/\.brm \.brm-cdgate\[hidden\] ~ \.brm-choices \.brm-cd \{ display: none; \}/);
  });

  it('a rating shows its scale, not the average so far; ideas show no votes while voting', () => {
    const rating = wall({ ask: 'live' }, { kind: 'rating', results: { total: 3, rating: { avg: 4.2, count: 3, dist: [0, 0, 1, 1, 1] }, whys: [] } });
    const r = render(<BuildStageScreen room={rating} now={now} profile="room" />);
    expect(r.container.querySelector('.brm-ratescale')).not.toBeNull();
    expect(r.container.textContent).not.toContain('4.2');
    expect(r.container.querySelector(TALLY)).toBeNull();
    expect(r.container.querySelector('.brm-cue').textContent).toMatch(/^Rate it on your phone/);
    r.unmount();

    const ideas = wall({ ask: 'voting' }, { kind: 'suggest' });
    const ask = current(ideas);
    ask.responses = [{ respId: 'r1', text: 'A parking map', votes: 1 }, { respId: 'r2', text: 'Bigger dates', votes: 4 }];
    ask.results = { total: 5, ranked: [] };
    const s = render(<BuildStageScreen room={ideas} now={now} profile="room" />);
    expect([...s.container.querySelectorAll('.brm-sug-text')].map((e) => e.textContent)).toEqual(['A parking map', 'Bigger dates']);
    expect(s.container.querySelector(TALLY)).toBeNull();
    expect(s.container.textContent).not.toMatch(/\bvotes?\b/);
  });

  it('the host\'s own board (the Host screen\'s path) keeps its live counts', () => {
    const room = wall({ ask: 'live' }, { results: LIVE_COUNTS });
    const rc = buildRoomContent('BUILD_ASK', 'room', room, current(room), now);
    const { container } = render(<AskStage ask={current(room)} host busy={false} ended={false} run={() => {}} api={null} pathMode rc={rc} />);
    expect(container.textContent).toContain('67%');
    expect(container.querySelector('.brm-cue')).toBeNull();
  });
});

describe('frame 8: the result', () => {
  it.each(PROFILES)('%s: the votes inside each option, the count large; the winner badged with its best reason', (profile) => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'results' })} now={now} profile={profile} />);
    const cards = [...container.querySelectorAll('.brm-choice')];
    expect(cards.map((c) => c.querySelector('.brm-score b').textContent)).toEqual(['1', '2']);
    expect(cards.map((c) => c.querySelector('.brm-score span').textContent)).toEqual(['vote · 33%', 'votes · 67%']);
    expect(cards.map((c) => c.querySelector('.brm-fill').style.height)).toEqual(['33%', '67%']);
    // The title and detail stay: the room sees what won and what it was.
    expect(cards[1].querySelector('.brm-cd').textContent).toBe('OPT-DETAIL-B');
    const pick = container.querySelectorAll('[data-pick]');
    expect(pick.length).toBe(1);
    expect(pick[0]).toBe(cards[1]);
    expect(pick[0].classList.contains('is-pick')).toBe(true);
    expect(pick[0].querySelector('.brm-pickbadge').textContent).toBe("The room's pick");
    expect(pick[0].querySelector('.brm-pickwhy').textContent).toBe('“Because it reads well”');
    expect(cards[0].querySelector('.brm-pickbadge, .brm-pickwhy')).toBeNull();
    expect(container.querySelector('.brm-cue')).toBeNull();
  });

  it('a tie has no pick: no badge, no quote', () => {
    const room = wall({ ask: 'results' });
    const ask = current(room);
    ask.results = { ...ask.results, options: ask.results.options.map((o) => ({ ...o, count: 2, pct: 50 })), tied: ['A', 'B'] };
    const { container } = render(<BuildStageScreen room={room} now={now} profile="room" />);
    expect(container.querySelector('[data-pick], .brm-pickbadge, .brm-pickwhy')).toBeNull();
    expect(container.querySelectorAll('.brm-score').length).toBe(2);
  });

  it('the best reason: the fullest that reads at a glance, else the shortest; the winner\'s only', () => {
    const whys = [
      { label: 'B', text: 'Calm' },
      { label: 'A', text: 'A much longer reason for the other option entirely' },
      { label: 'B', text: 'Nobody sees the pricing page if they cannot get in.' },
      { label: 'B', text: 'x'.repeat(BEST_WHY_MAX + 1) },
    ];
    expect(bestWhy(whys, 'B')).toBe('Nobody sees the pricing page if they cannot get in.');
    expect(bestWhy([{ label: 'B', text: 'y'.repeat(BEST_WHY_MAX + 5) }, { label: 'B', text: 'z'.repeat(BEST_WHY_MAX + 2) }], 'B')).toBe('z'.repeat(BEST_WHY_MAX + 2));
    expect(bestWhy(whys, 'C')).toBe('');
    expect(bestWhy(null, 'B')).toBe('');
  });

  it('the pick takes the gold role, never a raw colour (BuildRoom.css)', () => {
    const css = readFileSync(join(__dirname, '..', 'buildroom', 'BuildRoom.css'), 'utf8');
    const rule = (sel) => {
      const i = css.indexOf(`${sel} {`);
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
    };
    expect(rule('.brm .brm-choice.is-pick')).toMatch(/border-color:\s*var\(--gold\)/);
    expect(rule('.brm .brm-pickbadge')).toMatch(/background:\s*var\(--gold\)/);
    expect(rule('.brm .brm-pickwhy')).toMatch(/border-left:\s*4px solid var\(--gold\)/);
    // Support never at the meta step: the count at primary, its words and the reason at body.
    expect(rule('.brm .brm-score b')).toMatch(/var\(--brm-st-q\)/);
    expect(rule('.brm .brm-score')).toMatch(/font-size:\s*var\(--brm-st-body\)/);
    expect(rule('.brm .brm-pickwhy')).toMatch(/font-size:\s*var\(--brm-st-body\)/);
  });
});

/** The room right after the host sent the decision on ask 3, before Claude says anything. */
function sentRoom({ claudeSpoke = false, verb = 'decided', askId = '003' } = {}) {
  const room = wall({ ask: 'results' });
  room.asks = room.asks.map((a) => (a.askId === '003' ? {
    ...a, status: 'decided', decidedAt: ago(20), decision: { direction: 'Go with the calm photo header', chosen: ['B'], sentToAgent: true, method: 'vote' },
  } : a));
  room.sent = { verb, text: 'Go with the calm photo header', askId, at: ago(20), pickedAt: null };
  room.doing = claudeSpoke ? { text: 'Building the calm photo header', startedAt: ago(5), lastActiveAt: ago(1) } : null;
  return room;
}

// THE SENT TO CLAUDE CARD (owner, 23 Oct 2026) replaced frame 8's band: what
// Claude was told leads the Stage, with the pick, until the next ask opens.
describe('frame 8, as the Sent to Claude card', () => {
  it.each(PROFILES)('%s: the card leads with the words and the room\'s pick; the status under it, drawn once', (profile) => {
    const room = sentRoom();
    room.sent.pick = { method: 'vote', items: [{ label: 'B', title: 'Calm photo' }] };
    const { container } = render(<BuildStageScreen room={room} now={now} profile={profile} />);
    expect(container.querySelector('[data-room-moment]').getAttribute('data-room-moment')).toBe('BUILD_SENT');
    const card = container.querySelector('[data-testid="brm-sentcard"]');
    expect(card.querySelector('.brm-sentq').textContent).toBe('\u201cGo with the calm photo header\u201d');
    expect(card.querySelector('.brm-sentpick').textContent).toBe('The room chose B \u00b7 Calm photo');
    expect(container.querySelectorAll('[data-claude-status]').length).toBe(1);
    expect(container.textContent.match(/Sent to Claude/g).length).toBe(1);
    expect(container.querySelector('.brm-choice')).toBeNull();
    expect(container.querySelectorAll('button, [role="button"]').length).toBe(0);
  });

  it('when Claude says what it is doing, the card stays and Claude\'s status sits under it', () => {
    const room = sentRoom({ claudeSpoke: true });
    expect(sentStageAsk(room, now)).toBeNull();
    const { container } = render(<BuildStageScreen room={room} now={now} profile="room" />);
    const card = container.querySelector('[data-testid="brm-sentcard"]');
    expect(card.querySelector('.brm-sentq').textContent).toBe('\u201cGo with the calm photo header\u201d');
    expect(card.querySelector('[data-claude-status]').textContent).toContain('Claude is building the calm photo header');
  });

  it('only the decided ask that was sent, and only while it is current', () => {
    expect(sentStageAsk(sentRoom({ askId: '002' }), now)).toBeNull();
    expect(sentStageAsk(sentRoom({ verb: 'told' }), now)).toBeNull();
    const moved = sentRoom();
    moved.currentAskId = null;
    expect(sentStageAsk(moved, now)).toBeNull();
    expect(buildMomentOf({ current: { status: 'decided' } })).toBe('BUILD_RESULTS');
  });

  it('the room\'s window draws the same card from the wall read', () => {
    const body = F.wallBody({ ask: 'results' });
    body.current = { ...body.current, status: 'decided', decision: { direction: 'Go with the calm photo header', chosen: ['B'], sentToAgent: true } };
    body.history.asks = (body.history.asks || []).map((a) => (a.askId === '003' ? body.current : a));
    body.sent = { verb: 'decided', text: 'Go with the calm photo header', askId: '003', at: ago(20), pickedAt: null };
    body.doing = null;
    const room = wallRoom(body);
    const { container } = render(<BuildStageScreen room={room} now={now} profile="room" />);
    expect(container.querySelector('[data-testid="brm-sentcard"] .brm-sentq').textContent).toBe('\u201cGo with the calm photo header\u201d');
  });
});
