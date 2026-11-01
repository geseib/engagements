/**
 * NEEDS YOU, WORKED OUT (config/needsYou.js; experience plan §4, Phase 1a).
 *
 * One pure function turns what the host page already holds into the list the
 * Needs-you line, the bell, the People rows and the phone Remote all read.
 *
 * // rejects: the owner's 1 Nov report, a name request that existed only as a
 * //          tinted row inside the Session panel: here it is a Now item, named,
 * //          with Let them / Not now / See in People.
 * // rejects: a request that stays on the host's screen for the rest of the
 * //          session after its asker gave up (it lapses at ten minutes).
 */
import {
  needsYou, askingNow, openNow, markHandoverRequested, kindSummary, agoText, leftText,
  REQUEST_LAPSE_MS, NEEDS_ACTIONS, NEEDS_LEVELS,
} from '../config/needsYou';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const player = (name, handover = {}, more = {}) => ({ name, playerName: name, handover, ...more });

describe('one item per event (PLAN §4.2)', () => {
  test('rows 1/16: a name request is Now, named, with Let them · Not now · See in People', () => {
    const n = needsYou({ players: [player('Sam', { requested: true, requestedAt: iso(20000) }, { deviceConnected: false, isConnected: true })], now: NOW });
    expect(n.nowCount).toBe(1);
    expect(n.top).toMatchObject({
      kind: 'name-request', level: NEEDS_LEVELS.NOW, name: 'Sam',
      text: 'Sam wants their name on a new device', kindText: 'A name request',
    });
    expect(n.top.detail).toBe("Asked 0:20 ago · Sam's first device is away");
    expect(n.top.actions).toEqual([NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW, NEEDS_ACTIONS.SEE]);
    expect(n.top.armLet).toBe(false);
  });

  test('the first device still answering (deviceConnected, never isConnected): Let them arms', () => {
    const live = needsYou({ players: [player('Sam', { requested: true, requestedAt: iso(20000) }, { deviceConnected: true })], now: NOW });
    expect(live.top.armLet).toBe(true);
    expect(live.top.detail).toBe('Asked 0:20 ago · Sam is still answering on their first device');
    // isConnected is set at join and never cleared: it says nothing here.
    const stale = needsYou({ players: [player('Sam', { requested: true }, { isConnected: true })], now: NOW });
    expect(stale.top.armLet).toBe(false);
  });

  test('row 2: an open name is Soon, with Lock again and the time left', () => {
    const exp = Math.floor(NOW / 1000) + 250;
    const n = needsYou({ players: [player('Sam', { open: true, requested: true, expiresAt: exp })], now: NOW });
    expect(n.nowCount).toBe(0);
    expect(n.soonCount).toBe(1);
    expect(n.top).toMatchObject({ kind: 'name-open', text: "Waiting for Sam's new device · 4:10 left", actions: [NEEDS_ACTIONS.LOCK] });
    const unasked = needsYou({ players: [player('Ana', { open: true, expiresAt: exp })], now: NOW });
    expect(unasked.top.text).toBe("Ana's name is open for a new device · 4:10 left");
  });

  test('row 3: late arrivals are ONE Soon item, however many, with Review', () => {
    const n = needsYou({ late: { notReviewed: 3, answers: 2 }, now: NOW });
    expect(n.items).toHaveLength(1);
    expect(n.top).toMatchObject({ kind: 'late', level: 'soon', text: '3 arrived late: 2 answers, 1 comment', actions: [NEEDS_ACTIONS.REVIEW] });
    expect(needsYou({ late: { notReviewed: 1, answers: 1 } }).top.text).toBe('1 late answer to review');
    expect(needsYou({ late: { notReviewed: 2, answers: 0 } }).top.text).toBe('2 late comments to review');
    expect(needsYou({ late: { notReviewed: 0, answers: 0 } }).items).toEqual([]);
  });

  test("row 4: a read to check is Soon with Redo · It's fine, and It's fine clears it", () => {
    const n = needsYou({ readCheck: 'Workie used words the answers do not support.', readRound: 3 });
    expect(n.top).toMatchObject({ id: 'read-check:3', kind: 'read-check', level: 'soon', text: "Check Workie's read for round 3" });
    expect(n.top.actions).toEqual([NEEDS_ACTIONS.REDO, NEEDS_ACTIONS.FINE]);
    expect(needsYou({ readCheck: 'x', readRound: 3, dismissed: ['read-check:3'] }).items).toEqual([]);
  });

  test('row 5: a failed read is Now with Retry · Redo, and outranks its own check', () => {
    const n = needsYou({ readFailure: { headline: 'The model timed out.' }, readCheck: 'x', readRound: 3 });
    expect(n.items.map((i) => i.kind)).toEqual(['read-failed']);
    expect(n.top).toMatchObject({ level: 'now', text: "Workie's read didn't arrive", detail: 'The model timed out.', actions: [NEEDS_ACTIONS.RETRY, NEEDS_ACTIONS.REDO] });
  });

  test('row 7: a dropped socket heads the list; before it ever connected there is nothing', () => {
    const n = needsYou({ connected: false, players: [player('Sam', { requested: true })] });
    expect(n.items.map((i) => i.kind)).toEqual(['offline', 'name-request']);
    expect(needsYou({ connected: true }).items).toEqual([]);
  });

  test('nothing waiting: an empty list, no top', () => {
    expect(needsYou({ players: [player('Ana')] })).toEqual({ items: [], nowCount: 0, soonCount: 0, top: null });
  });
});

describe('order and lapse', () => {
  test('Now before Soon; name requests newest first (Ask again lifts it, PLAN §4.4)', () => {
    const n = needsYou({
      late: { notReviewed: 1, answers: 1 },
      players: [player('Old', { requested: true, requestedAt: iso(120000) }), player('New', { requested: true, requestedAt: iso(5000) })],
      now: NOW,
    });
    expect(n.items.map((i) => i.name || i.kind)).toEqual(['New', 'Old', 'late']);
    expect(n.nowCount).toBe(2);
    expect(n.soonCount).toBe(1);
  });

  test('a request lapses at ten minutes; one with no time stamp never silently drops', () => {
    expect(askingNow({ requested: true, requestedAt: iso(REQUEST_LAPSE_MS - 1000) }, NOW)).toBe(true);
    expect(askingNow({ requested: true, requestedAt: iso(REQUEST_LAPSE_MS + 1000) }, NOW)).toBe(false);
    expect(askingNow({ requested: true }, NOW)).toBe(true);
    // A granted request is waiting for the device, not asking.
    expect(askingNow({ requested: true, open: true }, NOW)).toBe(false);
    // The server's own lapse wins when it sends one.
    expect(askingNow({ requested: true, requestedAt: iso(1000), requestExpiresAt: iso(1) }, NOW)).toBe(false);
    expect(askingNow({ requested: true, requestedAt: iso(REQUEST_LAPSE_MS + 1000), requestExpiresAt: new Date(NOW + 5000).toISOString() }, NOW)).toBe(true);
    expect(askingNow({ requested: true, requestLapsed: true }, NOW)).toBe(false);
  });

  test('an open name past its expiry is not open', () => {
    expect(openNow({ open: true, expiresAt: Math.floor(NOW / 1000) - 1 }, NOW)).toBe(false);
    expect(openNow({ open: true }, NOW)).toBe(true);
  });

  test('the clocks', () => {
    expect(agoText(iso(20000), NOW)).toBe('0:20 ago');
    expect(agoText(iso(240000), NOW)).toBe('4 min ago');
    expect(leftText(Math.floor(NOW / 1000) + 290, NOW)).toBe('4:50 left');
  });
});

describe('the socket frame lands in the same render', () => {
  test('markHandoverRequested flags the named row at once; the list turns Now', () => {
    const before = [player('Sam'), player('Ana')];
    const after = markHandoverRequested(before, 'Sam', iso(0));
    expect(needsYou({ players: before, now: NOW }).nowCount).toBe(0);
    expect(needsYou({ players: after, now: NOW }).top).toMatchObject({ kind: 'name-request', name: 'Sam' });
    // The other rows are untouched, and an unknown name leaves the array as it was.
    expect(after[1]).toBe(before[1]);
    expect(markHandoverRequested(before, 'Nobody')).toBe(before);
  });
});

describe('what a screen the room sees may say (principle 3)', () => {
  test('kindSummary counts by kind and never names anyone', () => {
    const n = needsYou({
      players: [player('Sam', { requested: true }), player('Priya', { requested: true })],
      late: { notReviewed: 2, answers: 2 },
    });
    const line = kindSummary(n);
    expect(line).toBe('2 name requests · 2 late answers to review');
    expect(line).not.toMatch(/Sam|Priya/);
    n.items.forEach((i) => expect(i.kindText).not.toMatch(/Sam|Priya/));
  });

  test('"on your phone" only while the Remote is connected (PLAN §3.3)', () => {
    const n = needsYou({ players: [player('Sam', { requested: true })] });
    expect(kindSummary(n)).toBe('1 name request');
    expect(kindSummary(n, { remoteConnected: true })).toBe('1 name request · on your phone');
    expect(kindSummary(needsYou({}))).toBe('Nothing needs you now.');
  });
});
