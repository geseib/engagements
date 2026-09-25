/**
 * WHICH COPY OF THE BOARD WINS — useScoreboardSync, the host page's one
 * holder of the server's board.
 *
 * The host page hears about the board from four places: its own POST's reply,
 * the `scoreboardChanged` frame, and every `/state` refresh (window focus,
 * visibility, reconnect, most phase frames). A refresh issued a moment BEFORE
 * the host pressed S can land a moment AFTER — and applied blindly, it shuts
 * the board the host just opened, or reopens one Space just closed.
 *
 * The rule (spec §3, the revision in scoreboard-state.js): every server write
 * counts `rev` up; the page applies a server copy only when its rev is at
 * least the one it holds, and ignores server copies entirely while its own
 * write is in flight — that write's reply is the answer. Two quick V presses
 * resolve in revision order however their replies come back.
 */
import { renderHook, act } from '@testing-library/react';
import useScoreboardSync from '../components/stage/scoreboard/useScoreboardSync';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A fetch whose replies the test hands back, one per call, in any order. */
function manualFetch() {
  const calls = [];
  const fetchFn = jest.fn((url, init) => {
    const d = deferred();
    calls.push({ url, body: JSON.parse(init.body), d });
    return d.promise;
  });
  const reply = (i, scoreboard) => act(async () => {
    calls[i].d.resolve({ ok: true, json: async () => ({ scoreboard }) });
  });
  const refuse = (i) => act(async () => {
    calls[i].d.resolve({ ok: false, status: 500, json: async () => ({}) });
  });
  return { fetchFn, calls, reply, refuse };
}

const board = (over = {}) => ({ open: false, style: 'departure', page: 0, openedAt: null, rev: 0, ...over });

function setup() {
  const net = manualFetch();
  const hook = renderHook(() => useScoreboardSync({ gameId: '6060', apiBase: 'https://api.test/', fetchFn: net.fetchFn }));
  return { ...net, hook, now: () => hook.result.current.scoreboard };
}

describe('server copies, by revision', () => {
  test('a newer copy applies; an older one does not', () => {
    const { hook, now } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, rev: 5 })));
    expect(now()).toMatchObject({ open: true, rev: 5 });
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 4 })));
    expect(now()).toMatchObject({ open: true, rev: 5 });
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 6 })));
    expect(now()).toMatchObject({ open: false, rev: 6 });
  });

  test('a copy with no revision reads as 0 and cannot undo a counted change', () => {
    const { hook, now } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, rev: 2 })));
    act(() => hook.result.current.applyServerBoard({ open: false }));
    expect(now().open).toBe(true);
  });
});

describe('the race the host can actually hit', () => {
  test('S just after a window-focus refresh: the stale read landing late does not shut the board', async () => {
    const { hook, now, reply } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 3 })));

    // The host presses S. The page opens at once.
    act(() => { hook.result.current.publishScoreboard({ open: true }); });
    expect(now().open).toBe(true);

    // The refresh that was already on its way lands while the POST is out.
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 3 })));
    expect(now().open).toBe(true);

    // The POST answers with the counted revision...
    await reply(0, board({ open: true, rev: 4, openedAt: 't' }));
    expect(now()).toMatchObject({ open: true, rev: 4 });

    // ...and a second stale copy after it changes nothing either.
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 3 })));
    expect(now().open).toBe(true);
  });

  test('Space closes; a read from before the close cannot reopen it', async () => {
    const { hook, now, reply } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, rev: 7 })));
    act(() => { hook.result.current.publishScoreboard({ open: false }); });
    await reply(0, board({ open: false, rev: 8 }));
    act(() => hook.result.current.applyServerBoard(board({ open: true, rev: 7 })));
    expect(now().open).toBe(false);
  });

  test('V then V: the replies can come back in either order, the second press wins', async () => {
    const { hook, now, reply, calls } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, style: 'departure', rev: 10 })));
    act(() => { hook.result.current.publishScoreboard({ style: 'olympic' }); });
    act(() => { hook.result.current.publishScoreboard({ style: 'tote' }); });
    expect(calls.map((c) => c.body.style)).toEqual(['olympic', 'tote']);
    expect(now().style).toBe('tote');
    await reply(1, board({ open: true, style: 'tote', rev: 12 }));
    await reply(0, board({ open: true, style: 'olympic', rev: 11 }));
    expect(now()).toMatchObject({ style: 'tote', rev: 12 });
  });

  test('V then V, replies in order: the room never flickers back to the first look', async () => {
    const { hook, now, reply } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, style: 'departure', rev: 10 })));
    act(() => { hook.result.current.publishScoreboard({ style: 'olympic' }); });
    act(() => { hook.result.current.publishScoreboard({ style: 'tote' }); });
    await reply(0, board({ open: true, style: 'olympic', rev: 11 }));
    expect(now().style).toBe('tote');
    await reply(1, board({ open: true, style: 'tote', rev: 12 }));
    expect(now()).toMatchObject({ style: 'tote', rev: 12 });
  });

  test('the server putting the board away (a question started) applies — it is newer', () => {
    const { hook, now } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, rev: 4 })));
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 5 })));
    expect(now().open).toBe(false);
  });

  test('a refused write puts the board back as the server last had it', async () => {
    const { hook, now, refuse } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: false, rev: 2 })));
    act(() => { hook.result.current.publishScoreboard({ open: true }); });
    expect(now().open).toBe(true);
    await refuse(0);
    expect(now()).toMatchObject({ open: false, rev: 2 });
  });

  test('a new session starts from nothing, so its first read applies whatever its revision', () => {
    const { hook, now } = setup();
    act(() => hook.result.current.applyServerBoard(board({ open: true, rev: 9 })));
    act(() => hook.result.current.resetScoreboard(board()));
    act(() => hook.result.current.applyServerBoard(board({ open: false, style: 'tote', rev: 1 })));
    expect(now()).toMatchObject({ style: 'tote', rev: 1 });
  });

  test('it posts to the closed route, the body config/scoreboard.js builds', () => {
    const { hook, calls } = setup();
    act(() => { hook.result.current.publishScoreboard({ step: 'next' }); });
    expect(calls[0].url).toBe('https://api.test/games/6060/scoreboard');
    expect(calls[0].body).toEqual({ step: 'next' });
  });
});
