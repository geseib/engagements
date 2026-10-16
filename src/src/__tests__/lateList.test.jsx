/**
 * THE HOST'S LATE LIST (session flow v3 §4.4; late items Task 4).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LateList from '../components/LateList';
import LW from '../config/lateWords';
import {
  fetchLate, reviewLateItem, closeComments, lateStatusOf, canShowOnWall,
} from '../utils/lateClient';

const ROUNDS = [
  {
    round: '001',
    roundNoun: 'Round',
    items: [
      { kind: 'answer', ref: 'aaaaaaaaaaaa', round: '001', text: 'A late thought', label: 'Not reviewed', who: 'Ada', arrivedAt: '2026-10-16T10:00:00Z', arrivedDuring: 'VOTE#001', reviewed: null },
      { kind: 'comment', ref: '202610161000000-abc', round: '001', text: 'More on this', label: 'Reviewed by the host', who: 'Omar', arrivedAt: '2026-10-16T10:01:00Z', arrivedDuring: 'ASK#002', reviewed: 'read' },
    ],
  },
  {
    round: '002',
    roundNoun: 'Round',
    items: [
      { kind: 'askAnswer', ref: 'ask123:bbbbbbbbbbbb', round: '002', text: 'An idea', label: 'Not reviewed', who: 'Late answer', arrivedAt: '2026-10-16T10:05:00Z', arrivedDuring: 'RESULTS#002', reviewed: null, askId: 'ask123', askKind: 'ideas', id: 'bbbbbbbbbbbb' },
      { kind: 'comment', ref: '202610161006000-def', round: '002', text: 'Shown already', label: 'Reviewed with the room', who: 'Comment', arrivedAt: '2026-10-16T10:06:00Z', arrivedDuring: 'ENDED', reviewed: 'shown' },
    ],
  },
];

const noop = () => Promise.resolve({ ok: true });

describe('the list', () => {
  test('grouped by round, each item with its kind, who, when and label', () => {
    render(<LateList rounds={ROUNDS} onShow={noop} onMarkReviewed={noop} />);
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => within(g).getByRole('heading').textContent)).toEqual(['Round 1', 'Round 2']);
    const first = within(groups[0]).getAllByRole('listitem')[0];
    expect(first.textContent).toContain(LW.kinds.answer);
    expect(first.textContent).toContain('A late thought');
    expect(first.textContent).toContain('Ada');
    expect(first.textContent).toContain('during Round 1 · Voting');
    expect(first.textContent).toContain('Not reviewed');
    expect(within(groups[1]).getAllByRole('listitem')[0].textContent).toContain(LW.kinds.askAnswer);
    expect(within(groups[1]).getAllByRole('listitem')[1].textContent).toContain('after the session ended');
    expect(screen.getAllByText(LW.kinds.comment)).toHaveLength(2);
  });

  test('the three labels, exactly the owner\'s', () => {
    render(<LateList rounds={ROUNDS} onShow={noop} onMarkReviewed={noop} />);
    expect(screen.getAllByText('Not reviewed')).toHaveLength(2);
    expect(screen.getByText('Reviewed by the host')).toBeInTheDocument();
    expect(screen.getByText('Reviewed with the room')).toBeInTheDocument();
  });

  test('no "Show on the wall" for a late round answer; none once shown', () => {
    render(<LateList rounds={ROUNDS} wall={{ round: '001', beat: 'feedback' }} onShow={noop} onMarkReviewed={noop} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).queryByRole('button', { name: LW.show })).toBeNull();
    expect(within(items[1]).getByRole('button', { name: LW.show })).toBeInTheDocument();
    expect(within(items[3]).queryByRole('button', { name: LW.show })).toBeNull();
  });

  test('"Show on the wall" only while the wall is on that item\'s round and beat (review fix)', () => {
    const shows = (wall) => {
      const { unmount } = render(<LateList rounds={ROUNDS} wall={wall} onShow={noop} onMarkReviewed={noop} />);
      const items = screen.getAllByRole('listitem');
      const out = items.map((li) => Boolean(within(li).queryByRole('button', { name: LW.show })));
      unmount();
      return out;
    };
    // No wall known, another round, the wrong beat: only Mark reviewed.
    expect(shows(null)).toEqual([false, false, false, false]);
    expect(shows({ round: '002', beat: 'feedback' })).toEqual([false, false, false, false]);
    expect(shows({ round: '001', beat: 'results' })).toEqual([false, false, false, false]);
    // Round 1's feedback beat: its comment can go up.
    expect(shows({ round: '001', beat: 'feedback' })).toEqual([false, true, false, false]);
    // Round 2's ask beat with that question up: the late Idea can go up.
    expect(shows({ round: '002', beat: 'ask', askId: 'ask123' })).toEqual([false, false, true, false]);
    expect(shows({ round: '002', beat: 'ask', askId: 'other1' })).toEqual([false, false, false, false]);
  });

  test('"Mark reviewed" is hidden once reviewed', () => {
    render(<LateList rounds={ROUNDS} onShow={noop} onMarkReviewed={noop} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByRole('button', { name: LW.markReviewed })).toBeInTheDocument();
    expect(within(items[1]).queryByRole('button', { name: LW.markReviewed })).toBeNull();
    expect(within(items[3]).queryByRole('button', { name: LW.markReviewed })).toBeNull();
  });

  test('the buttons hand the item to the page', async () => {
    const onShow = jest.fn(noop);
    const onMarkReviewed = jest.fn(noop);
    render(<LateList rounds={ROUNDS} wall={{ round: '002', beat: 'ask', askId: 'ask123' }} onShow={onShow} onMarkReviewed={onMarkReviewed} />);
    const items = screen.getAllByRole('listitem');
    fireEvent.click(within(items[0]).getByRole('button', { name: LW.markReviewed }));
    expect(onMarkReviewed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'answer', ref: 'aaaaaaaaaaaa', round: '001' }));
    await waitFor(() => expect(within(items[2]).getByRole('button', { name: LW.show })).not.toBeDisabled());
    fireEvent.click(within(items[2]).getByRole('button', { name: LW.show }));
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ kind: 'askAnswer', askId: 'ask123', id: 'bbbbbbbbbbbb' }));
  });

  test('a refusal is said under the list', async () => {
    const onMarkReviewed = jest.fn(() => Promise.resolve({ ok: false, error: 'That did not work.' }));
    render(<LateList rounds={ROUNDS} onShow={noop} onMarkReviewed={onMarkReviewed} />);
    fireEvent.click(screen.getAllByRole('button', { name: LW.markReviewed })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not work.');
  });

  test('empty', () => {
    render(<LateList rounds={[]} onShow={noop} onMarkReviewed={noop} />);
    expect(screen.getByText(LW.empty)).toBeInTheDocument();
  });
});

describe('Close comments', () => {
  test('only at ENDED', () => {
    const { rerender } = render(<LateList rounds={ROUNDS} ended={false} onShow={noop} onMarkReviewed={noop} onCloseComments={noop} />);
    expect(screen.queryByRole('button', { name: LW.closeComments })).toBeNull();
    rerender(<LateList rounds={ROUNDS} ended onShow={noop} onMarkReviewed={noop} onCloseComments={noop} />);
    expect(screen.getByRole('button', { name: LW.closeComments })).toBeInTheDocument();
    expect(screen.getByText(LW.closeExplain)).toBeInTheDocument();
  });

  test('pressing it calls the page; once closed it says so', async () => {
    const onCloseComments = jest.fn(noop);
    const { rerender } = render(<LateList rounds={ROUNDS} ended onShow={noop} onMarkReviewed={noop} onCloseComments={onCloseComments} />);
    fireEvent.click(screen.getByRole('button', { name: LW.closeComments }));
    await waitFor(() => expect(onCloseComments).toHaveBeenCalled());
    rerender(<LateList rounds={ROUNDS} ended commentsClosedAt="2026-10-16T12:00:00Z" onShow={noop} onMarkReviewed={noop} onCloseComments={onCloseComments} />);
    expect(screen.queryByRole('button', { name: LW.closeComments })).toBeNull();
    expect(screen.getByText(LW.commentsClosed)).toBeInTheDocument();
  });
});

describe('the client', () => {
  const okJson = (body) => jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }));

  test('GET /late', async () => {
    const fetchFn = okJson({ rounds: ROUNDS, counts: { notReviewed: 2 }, commentsClosedAt: null });
    const r = await fetchLate({ fetchFn, apiBase: 'https://api/', gameId: 'G1' });
    expect(fetchFn).toHaveBeenCalledWith('https://api/games/G1/late', undefined);
    expect(r).toEqual(expect.objectContaining({ ok: true, counts: { notReviewed: 2 }, commentsClosedAt: null }));
    expect(r.rounds).toHaveLength(2);
  });

  test('Mark reviewed POSTs kind, round, ref and how', async () => {
    const fetchFn = okJson({ reviewed: 'read' });
    await reviewLateItem({ fetchFn, apiBase: 'https://api/', gameId: 'G1', item: ROUNDS[0].items[0], how: 'read' });
    expect(fetchFn).toHaveBeenCalledWith('https://api/games/G1/late/review', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ kind: 'answer', round: '001', ref: 'aaaaaaaaaaaa', how: 'read' });
  });

  test('Close comments POSTs kind comments, how close', async () => {
    const fetchFn = okJson({ commentsClosedAt: 'x' });
    await closeComments({ fetchFn, apiBase: 'https://api/', gameId: 'G1' });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ kind: 'comments', how: 'close' });
  });

  test('a failure resolves, never throws', async () => {
    const r = await fetchLate({ fetchFn: () => Promise.reject(new Error('down')), apiBase: 'x/', gameId: 'G' });
    expect(r.ok).toBe(false);
  });

  test('the status counts what waits, and whether all of it is answers', () => {
    expect(lateStatusOf(ROUNDS)).toEqual({ notReviewed: 2, answers: 2 });
    expect(lateStatusOf([])).toEqual({ notReviewed: 0, answers: 0 });
  });

  test('only a comment or a late Idea, and only where the wall shows it', () => {
    const r1Feedback = { round: '001', beat: 'feedback' };
    const r2Ask = { round: '002', beat: 'ask', askId: 'ask123' };
    expect(canShowOnWall(ROUNDS[0].items[0], r1Feedback)).toBe(false);
    expect(canShowOnWall(ROUNDS[0].items[1], r1Feedback)).toBe(true);
    expect(canShowOnWall(ROUNDS[0].items[1])).toBe(false);
    expect(canShowOnWall(ROUNDS[0].items[1], { round: '003', beat: 'feedback' })).toBe(false);
    expect(canShowOnWall(ROUNDS[1].items[0], r2Ask)).toBe(true);
    expect(canShowOnWall(ROUNDS[1].items[0], { ...r2Ask, beat: 'results' })).toBe(false);
    expect(canShowOnWall({ ...ROUNDS[1].items[0], askKind: 'rate' }, r2Ask)).toBe(false);
    expect(canShowOnWall(ROUNDS[1].items[1], { round: '002', beat: 'feedback' })).toBe(false);
  });
});

describe('words', () => {
  test('sentence case, no exclamation, the owner\'s labels', () => {
    const strings = [];
    const walk = (o) => Object.values(o).forEach((v) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') walk(v);
    });
    walk(LW);
    for (const v of strings) {
      const rest = v.slice(1).replace(/\. [A-Z]/g, '. x');
      expect([v, /[A-Z]/.test(rest)]).toEqual([v, false]);
      expect([v, /!/.test(v)]).toEqual([v, false]);
      if (/phone/.test(v)) expect(v).toMatch(/phone, laptop or tablet/);
    }
    expect(LW.labels).toEqual({ none: 'Not reviewed', read: 'Reviewed by the host', shown: 'Reviewed with the room' });
    expect(LW.kinds).toEqual({ answer: 'Late answer', askAnswer: 'Late answer to a question', comment: 'Comment added later' });
  });

  test('the counts', () => {
    expect(LW.statusCount(1, true)).toBe('1 late answer kept');
    expect(LW.statusCount(3, true)).toBe('3 late answers kept');
    expect(LW.statusCount(1, false)).toBe('1 late item not reviewed');
    expect(LW.statusCount(4, false)).toBe('4 late items not reviewed');
    expect(LW.endedCount(2)).toBe('2 items not reviewed');
    expect(LW.endedCount(1)).toBe('1 item not reviewed');
  });

  test('when it arrived', () => {
    expect(LW.arrivedDuring('VOTE#003', 'Round')).toBe('during Round 3 · Voting');
    expect(LW.arrivedDuring('ASK#004', 'Question')).toBe('during Question 4 · Answering');
    expect(LW.arrivedDuring('RESULTS#002')).toBe('during Round 2 · Results');
    expect(LW.arrivedDuring('ENDED')).toBe('after the session ended');
    expect(LW.arrivedDuring(null)).toBe('');
  });

  test('the labels match the server\'s', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lambda-functions', 'game', 'late-labels.js'), 'utf8');
    for (const label of Object.values(LW.labels)) expect(server).toContain(`'${label}'`);
  });
});

/*
  Q14: PARTICIPANTS NEVER SEE A REVIEW LABEL. No phone, wall or Present file
  imports the late list or its words.
*/
describe('no room file reaches the late list (Q14)', () => {
  const SRC = path.join(__dirname, '..');
  const roomFiles = () => {
    const out = ['PlayerPage.jsx', 'components/stage/AskStage.jsx', 'components/stage/FeedbackWall.jsx'];
    for (const f of fs.readdirSync(path.join(SRC, 'present'))) out.push(`present/${f}`);
    for (const f of fs.readdirSync(path.join(SRC, 'components'))) {
      if (/^Player/.test(f) && /\.jsx?$/.test(f)) out.push(`components/${f}`);
    }
    const playerDir = path.join(SRC, 'components', 'player');
    if (fs.existsSync(playerDir)) {
      for (const f of fs.readdirSync(playerDir)) if (/\.jsx?$/.test(f)) out.push(`components/player/${f}`);
    }
    return out.filter((f) => /\.jsx?$/.test(f) && fs.existsSync(path.join(SRC, f)));
  };

  test('the scan covers the phone and the wall', () => {
    const files = roomFiles();
    expect(files).toContain('PlayerPage.jsx');
    expect(files.some((f) => f.startsWith('present/'))).toBe(true);
  });

  test.each(roomFiles())('%s', (file) => {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8');
    expect(code).not.toMatch(/LateList|lateWords|lateClient/);
  });
});
