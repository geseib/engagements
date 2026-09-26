/**
 * The scoreboard's rules, as arithmetic — config/scoreboard.js.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md. Everything the three
 * surfaces (stage, phone remote, session menu) must agree about lives in that
 * one module, the same deal config/stageFocus.js has: the vocabulary of looks,
 * who gets a board and when it may open, the places per page on each display
 * profile, how a place and a movement are written, the auto-flip's pace, and
 * which key means what.
 */
import {
  SCOREBOARD_STYLES, DEFAULT_STYLE, STYLE_LABELS, CLOSED_SCOREBOARD,
  normaliseScoreboard, nextStyle, hasScoreboard, scoreboardAvailability,
  NOT_SCORED_YET, placesPerPage, boardRows, movementLabel, pageCount,
  pageRows, pageRange, pageDwellMs, scoreboardRequest, scoreboardKeyIntent,
  previousOrder,
} from '../config/scoreboard';

describe('the looks', () => {
  test('three, departure first and the default', () => {
    expect(SCOREBOARD_STYLES).toEqual(['departure', 'olympic', 'tote']);
    expect(DEFAULT_STYLE).toBe('departure');
    expect(Object.keys(STYLE_LABELS)).toEqual(SCOREBOARD_STYLES);
  });

  test('V cycles them in order and wraps', () => {
    expect(nextStyle('departure')).toBe('olympic');
    expect(nextStyle('olympic')).toBe('tote');
    expect(nextStyle('tote')).toBe('departure');
    expect(nextStyle('hologram')).toBe('olympic');
  });
});

describe('normaliseScoreboard', () => {
  test('nothing stored is a closed board in the default look', () => {
    expect(normaliseScoreboard(undefined)).toEqual(CLOSED_SCOREBOARD);
    expect(CLOSED_SCOREBOARD).toEqual({ open: false, style: 'departure', page: 0, openedAt: null, rev: 0 });
  });

  test('an unknown look reads as the default, a junk page as 0', () => {
    expect(normaliseScoreboard({ open: true, style: 'neon', page: 'x', openedAt: 't' }))
      .toEqual({ open: true, style: 'departure', page: 0, openedAt: 't', rev: 0 });
  });

  test('the revision travels, and junk reads as 0', () => {
    expect(normaliseScoreboard({ rev: 7 }).rev).toBe(7);
    expect(normaliseScoreboard({ rev: -1 }).rev).toBe(0);
    expect(normaliseScoreboard({ rev: '7' }).rev).toBe(0);
  });

  test('open must be literally true', () => {
    expect(normaliseScoreboard({ open: 'yes' }).open).toBe(false);
  });
});

describe('who gets a board', () => {
  test('Trivia and Call & Answer, including their legacy spellings', () => {
    for (const t of ['trivia', 'quiz', 'call-and-answer', 'callandanswer']) expect(hasScoreboard(t)).toBe(true);
  });

  test('Poll, Wavelength and Survey do not', () => {
    for (const t of ['poll', 'polls', 'wavelength', 'survey']) expect(hasScoreboard(t)).toBe(false);
  });

  test('a session with no type plays call-and-answer, so it has one', () => {
    expect(hasScoreboard(undefined)).toBe(true);
  });

  test('another type gets no control at all', () => {
    expect(scoreboardAvailability({ gameType: 'poll', afterRound: 3 }))
      .toEqual({ show: false, enabled: false, reason: '' });
  });

  test('before any round is scored the control is there, disabled, with its reason', () => {
    expect(scoreboardAvailability({ gameType: 'trivia', afterRound: null }))
      .toEqual({ show: true, enabled: false, reason: NOT_SCORED_YET });
    expect(NOT_SCORED_YET).toBe('Scores appear after the first round');
  });

  test('once a round is scored it may open', () => {
    expect(scoreboardAvailability({ gameType: 'trivia', afterRound: 1 }))
      .toEqual({ show: true, enabled: true, reason: '' });
  });
});

describe('places per page, per display profile', () => {
  test('room 10, table 10, tv 5, call 5', () => {
    expect(placesPerPage('room')).toBe(10);
    expect(placesPerPage('table')).toBe(10);
    expect(placesPerPage('tv')).toBe(5);
    expect(placesPerPage('call')).toBe(5);
    expect(placesPerPage('nonsense')).toBe(10);
  });
});

const ROSTER = [
  { playerName: 'Marcus', totalScore: 78, rank: 2, movement: -1, previousScore: 70 },
  { playerName: 'Priya', totalScore: 81, rank: 1, movement: 1, previousScore: 66 },
  { playerName: 'Tomás', totalScore: 66, rank: 4, movement: 1, previousScore: 58 },
  { playerName: 'Hannah', totalScore: 66, rank: 4, movement: 2, previousScore: 52 },
  { playerName: 'Oluwaseun Adebayo-Richardson', totalScore: 72, rank: 3, movement: 0, previousScore: 60 },
  { playerName: 'Keiko', totalScore: 63, rank: 6, movement: -2, previousScore: 59 },
  { playerName: 'Inès', totalScore: 14, rank: 7, movement: 'new', previousScore: null },
];

describe('boardRows', () => {
  const rows = boardRows(ROSTER);

  test('sorted by place, then by name', () => {
    expect(rows.map((r) => r.name)).toEqual([
      'Priya', 'Marcus', 'Oluwaseun Adebayo-Richardson', 'Hannah', 'Tomás', 'Keiko', 'Inès',
    ]);
  });

  test('a tie is written with =, and only a tie', () => {
    expect(rows.map((r) => r.place)).toEqual(['1', '2', '3', '=4', '=4', '6', '7']);
  });

  test('carries the total, movement and previous total', () => {
    expect(rows[0]).toMatchObject({ total: 81, movement: 1, previousScore: 66 });
    expect(rows[6]).toMatchObject({ movement: 'new', previousScore: null });
  });

  test('an empty or missing roster is an empty board', () => {
    expect(boardRows(undefined)).toEqual([]);
  });
});

describe('movementLabel', () => {
  test('▲n, ▼n, NEW and –', () => {
    expect(movementLabel(2)).toEqual({ text: '▲2', kind: 'up', spoken: 'up 2' });
    expect(movementLabel(-1)).toEqual({ text: '▼1', kind: 'dn', spoken: 'down 1' });
    expect(movementLabel('new')).toEqual({ text: 'NEW', kind: 'new', spoken: 'new' });
    expect(movementLabel(0)).toEqual({ text: '–', kind: 'eq', spoken: 'no change' });
    expect(movementLabel(undefined)).toEqual({ text: '–', kind: 'eq', spoken: 'no change' });
  });
});

describe('paging', () => {
  test('14 players at 10 a page is two pages; at 5 it is three', () => {
    expect(pageCount(14, 10)).toBe(2);
    expect(pageCount(14, 5)).toBe(3);
    expect(pageCount(0, 10)).toBe(1);
  });

  test('pageRows slices, and wraps a page index from either side', () => {
    const rows = Array.from({ length: 14 }, (_, i) => i);
    expect(pageRows(rows, 1, 10)).toEqual([10, 11, 12, 13]);
    expect(pageRows(rows, 2, 10)).toEqual(rows.slice(0, 10));
    expect(pageRows(rows, -1, 10)).toEqual([10, 11, 12, 13]);
  });

  test('the range the rail prints', () => {
    expect(pageRange(0, 10, 14)).toBe('1–10');
    expect(pageRange(1, 10, 14)).toBe('11–14');
    expect(pageRange(0, 10, 0)).toBe('0');
  });

  test('a full Room page dwells about 7-8 seconds', () => {
    const ms = pageDwellMs(10, 'departure', false);
    expect(ms).toBeGreaterThanOrEqual(7000);
    expect(ms).toBeLessThanOrEqual(8500);
  });

  test('14 players on Room: back on page 1 about 15 seconds after opening', () => {
    const total = pageDwellMs(10, 'departure', false) + pageDwellMs(4, 'departure', false);
    expect(total).toBeGreaterThanOrEqual(13000);
    expect(total).toBeLessThanOrEqual(16000);
  });

  test('the tote board\'s first visit replays the round, so it dwells longer', () => {
    expect(pageDwellMs(10, 'tote', true)).toBeGreaterThan(pageDwellMs(10, 'tote', false));
  });
});

describe('previousOrder — what the tote board shows before the field moves', () => {
  test('the players who had a place, by their previous total', () => {
    const order = previousOrder(boardRows(ROSTER));
    expect(order.map((r) => r.name)).toEqual([
      'Marcus', 'Priya', 'Oluwaseun Adebayo-Richardson', 'Keiko', 'Tomás', 'Hannah',
    ]);
    expect(order.map((r) => r.previousPlace)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('scoreboardRequest', () => {
  test('the body POST /scoreboard wants', () => {
    expect(scoreboardRequest({ open: true })).toEqual({ open: true });
    expect(scoreboardRequest({ style: 'tote' })).toEqual({ style: 'tote' });
    expect(scoreboardRequest({ step: 'next' })).toEqual({ step: 'next' });
  });

  test('nothing sendable is null', () => {
    expect(scoreboardRequest({})).toBeNull();
    expect(scoreboardRequest({ style: 'neon' })).toBeNull();
    expect(scoreboardRequest({ step: 'up' })).toBeNull();
  });
});

describe('scoreboardKeyIntent', () => {
  const key = (k, extra = {}) => ({ key: k, target: document.body, ...extra });

  test('S opens and closes, in either case', () => {
    expect(scoreboardKeyIntent(key('s'), { open: false })).toBe('toggle');
    expect(scoreboardKeyIntent(key('S'), { open: true })).toBe('toggle');
  });

  test('with the board open: arrows page, V cycles, Escape and Space close', () => {
    const open = { open: true };
    expect(scoreboardKeyIntent(key('ArrowRight'), open)).toBe('next');
    expect(scoreboardKeyIntent(key('ArrowLeft'), open)).toBe('prev');
    expect(scoreboardKeyIntent(key('v'), open)).toBe('style');
    expect(scoreboardKeyIntent(key('Escape'), open)).toBe('close');
    expect(scoreboardKeyIntent(key(' '), open)).toBe('close');
    expect(scoreboardKeyIntent(key('Spacebar'), open)).toBe('close');
  });

  test('with the board closed those keys are not the board\'s', () => {
    const closed = { open: false };
    for (const k of ['ArrowRight', 'ArrowLeft', 'v', 'Escape', ' ']) {
      expect(scoreboardKeyIntent(key(k), closed)).toBeNull();
    }
  });

  test('never while typing', () => {
    const input = document.createElement('input');
    expect(scoreboardKeyIntent(key('s', { target: input }), { open: false })).toBeNull();
    const area = document.createElement('textarea');
    expect(scoreboardKeyIntent(key(' ', { target: area }), { open: true })).toBeNull();
  });

  test('never inside the session menu', () => {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const button = document.createElement('button');
    panel.appendChild(button);
    expect(scoreboardKeyIntent(key('s', { target: button }), { open: false })).toBeNull();
  });

  test('never with a modifier held', () => {
    expect(scoreboardKeyIntent(key('s', { metaKey: true }), { open: false })).toBeNull();
    expect(scoreboardKeyIntent(key('v', { ctrlKey: true }), { open: true })).toBeNull();
  });

  test('a held S does not flap the board open and shut', () => {
    expect(scoreboardKeyIntent(key('s', { repeat: true }), { open: false })).toBeNull();
  });
});
