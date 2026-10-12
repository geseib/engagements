/**
 * THE HOST PAGE PUBLISHES AND FOLLOWS WORKIE'S PAGE (two-surface PLAN 1.14,
 * remote-parity B).
 *
 * The page of the read used to be the host page's own state, so the Remote
 * could not turn it and a reload lost it. hooks/useStageNotesSync.js is the
 * host page's half of the server fact (/stage-beat, stage-notes.js):
 *
 *   - a turn on the host page (key, dock or Auto) posts the absolute page and
 *     the page's own count;
 *   - a `stageBeatChanged` frame with a newer rev turns the page — and is
 *     never published back (the publishFocus no-loop rule);
 *   - a reload hydrates from get-game-state's `stageNotes`.
 */
import { renderHook, act } from '@testing-library/react';
import useStageNotesSync from '../hooks/useStageNotesSync';

function setup(initial = {}) {
  const post = jest.fn(async () => ({ rev: 1 }));
  const turnTo = jest.fn();
  const props = {
    gameId: '4821', round: 3, onRead: true, ready: true, page: 0, pages: 3, post, turnTo, ...initial,
  };
  const hook = renderHook((p) => useStageNotesSync(p), { initialProps: props });
  return { ...hook, post, turnTo, props };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useStageNotesSync', () => {
  test('arriving on the read publishes the page and the count once', async () => {
    const { post, rerender, props } = setup();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ notesPage: 0, notesPages: 3, questionNumber: 3 });
    rerender({ ...props });
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('a turn on the host page publishes the new absolute page', async () => {
    const { post, rerender, props } = setup();
    await flush();
    rerender({ ...props, page: 1 });
    await flush();
    expect(post).toHaveBeenLastCalledWith({ notesPage: 1, notesPages: 3, questionNumber: 3 });
  });

  test('nothing is published off the read, or before the read has arrived', async () => {
    const off = setup({ onRead: false });
    await flush();
    expect(off.post).not.toHaveBeenCalled();
    const early = setup({ ready: false });
    await flush();
    expect(early.post).not.toHaveBeenCalled();
  });

  test('a newer frame turns the page and is never echoed back', async () => {
    const { result, post, turnTo, rerender, props } = setup();
    await flush();
    post.mockClear();
    let applied;
    act(() => {
      applied = result.current.applyFrame({ beat: 'field-notes', questionNumber: '003', notesPage: 2, notesPages: 3, rev: 5 });
    });
    expect(applied).toBe(true);
    expect(turnTo).toHaveBeenCalledWith(2, 3);
    // The page now reads 2 locally, as the frame said: no publish.
    rerender({ ...props, page: 2 });
    await flush();
    expect(post).not.toHaveBeenCalled();
  });

  test('a stale frame (rev not newer) is dropped', async () => {
    const { result, turnTo } = setup();
    await flush();
    act(() => { result.current.applyFrame({ beat: 'field-notes', questionNumber: 3, notesPage: 2, notesPages: 3, rev: 5 }); });
    turnTo.mockClear();
    let applied;
    act(() => { applied = result.current.applyFrame({ beat: 'field-notes', questionNumber: 3, notesPage: 1, notesPages: 3, rev: 5 }); });
    expect(applied).toBe(false);
    expect(turnTo).not.toHaveBeenCalled();
  });

  test('a frame for another round, or with no page, is ignored', async () => {
    const { result, turnTo } = setup();
    await flush();
    act(() => {
      expect(result.current.applyFrame({ beat: 'field-notes', questionNumber: 2, notesPage: 1, rev: 9 })).toBe(false);
      expect(result.current.applyFrame({ beat: 'field-notes', questionNumber: 3, rev: 9 })).toBe(false);
      expect(result.current.applyFrame({ beat: 'results', questionNumber: 3, notesPage: 1, rev: 9 })).toBe(false);
    });
    expect(turnTo).not.toHaveBeenCalled();
  });

  test('a reload hydrates from stageNotes and does not publish what it just read', async () => {
    const post = jest.fn(async () => ({ rev: 3 }));
    const turnTo = jest.fn();
    const props = { gameId: '4821', round: 3, onRead: true, ready: false, page: 0, pages: 1, post, turnTo };
    const { result, rerender } = renderHook((p) => useStageNotesSync(p), { initialProps: props });
    act(() => { result.current.hydrate({ page: 1, pages: 3, rev: 2 }); });
    expect(turnTo).toHaveBeenCalledWith(1, 3);
    // The read arrives; the page is back on 1 of 3, as the server said.
    rerender({ ...props, ready: true, page: 1, pages: 3 });
    await flush();
    expect(post).not.toHaveBeenCalled();
  });

  test('a reload that hydrates before the page knows its round keeps what it read', async () => {
    const post = jest.fn(async () => ({ rev: 3 }));
    const turnTo = jest.fn();
    const props = { gameId: '4821', round: null, onRead: true, ready: false, page: 0, pages: 1, post, turnTo };
    const { result, rerender } = renderHook((p) => useStageNotesSync(p), { initialProps: props });
    act(() => { result.current.hydrate({ page: 2, pages: 3, rev: 2 }, 3); });
    rerender({ ...props, round: 3 });
    rerender({ ...props, round: 3, ready: true, page: 2, pages: 3 });
    await flush();
    expect(post).not.toHaveBeenCalled();
  });

  test('a new round starts clean', async () => {
    const { post, rerender, props } = setup();
    await flush();
    rerender({ ...props, round: 4, page: 0, pages: 2 });
    await flush();
    expect(post).toHaveBeenLastCalledWith({ notesPage: 0, notesPages: 2, questionNumber: 4 });
  });
});

/*
  THE WIRING, read as comment-stripped source (the pattern
  remoteFocusPanel.test.jsx uses): a mount of the 8,000-line host page cannot
  show which socket frame reaches the hook, or that a reload hydrates it.
*/
describe('the host page wires it', () => {
  // eslint-disable-next-line global-require
  const fs = require('fs');
  // eslint-disable-next-line global-require
  const path = require('path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('the hook is fed the read\'s page and count, and posts to /stage-beat', () => {
    expect(code).toMatch(/useStageNotesSync\(\{[\s\S]*?page: notesSyncPage,[\s\S]*?pages: notesSyncPages,[\s\S]*?post: publishNotesPage,/);
    expect(code).toMatch(/games\/\$\{gameId\}\/stage-beat`/);
  });

  test('a stageBeatChanged frame on the read is handed to applyFrame', () => {
    expect(code).toMatch(/onMessage\('stageBeatChanged'[\s\S]*?notesSyncRef\.current\.applyFrame\(data\)/);
  });

  test('a reload on the read hydrates from stageNotes', () => {
    expect(code).toMatch(/notesSyncRef\.current\.hydrate\(gameStateData\.stageNotes, gameStateData\.currentQuestion\)/);
  });
});
