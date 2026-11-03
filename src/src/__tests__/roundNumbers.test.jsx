/**
 * ONE NUMBERING FOR BOTH LISTS OF ROUNDS — config/roundNumbers.js.
 *
 * The owner, on dev (3 Nov 2026): "i tested adding another question and its
 * list in rounds does not line up". Round 1 playing, one question of the
 * host's own queued: the rail read 1 · 2 (Yours) · 3 … 7 and the Session
 * menu's Running order read 1 (Yours) · 3 … 7 — the queued row numbered by its
 * place in the QUEUE, the automatic rows by the server's ROUND. Both lists now
 * number through one function from one base, and these tests hold that.
 */
import React from 'react';
import { render, screen, within, cleanup } from '@testing-library/react';
import QueueList from '../components/stage/QueueList';
import ConsoleRail from '../components/console/ConsoleRail';
import {
  numberRounds, sessionRoundBase, baseFromPlan, plannedRounds,
} from '../config/roundNumbers';
import { queueMove } from '../config/questionQueue';

describe('numberRounds', () => {
  test('numbers from the round after the base, one each, with no gaps', () => {
    expect(numberRounds(1, ['a', 'b', 'c'])).toEqual([2, 3, 4]);
    expect(numberRounds(0, ['a', 'b'])).toEqual([1, 2]);
  });

  test('a passed-over row takes no number, and the next row does not skip one', () => {
    // rejects: numbering by index (1, 3) — "never skip a number".
    const ns = numberRounds(1, ['own', 'parked', 'auto1', 'auto2'], (r) => r === 'parked');
    expect(ns).toEqual([2, null, 3, 4]);
  });

  test('a junk base reads as before the first round', () => {
    expect(numberRounds(undefined, ['a'])).toEqual([1]);
    expect(numberRounds(-3, ['a'])).toEqual([1]);
    expect(numberRounds('2', ['a'])).toEqual([3]);
  });
});

describe('sessionRoundBase and baseFromPlan', () => {
  test('the round on screen, or with none the last played, or 0', () => {
    expect(sessionRoundBase(1, [])).toBe(1);
    expect(sessionRoundBase(0, [1, 2, 3])).toBe(3);
    expect(sessionRoundBase(4, [1, 2, 3])).toBe(4);
    expect(sessionRoundBase(0, [])).toBe(0);
  });

  test('the plan\'s first round is the next round, so the base is one less', () => {
    expect(baseFromPlan([{ round: 2 }, { round: 3 }])).toBe(1);
    expect(baseFromPlan([])).toBe(0);
  });
});

describe('plannedRounds (the rail)', () => {
  test('numbers the plan from the base, drops the round on screen, marks Yours', () => {
    const rows = plannedRounds(1, [
      { questionId: 'QUESTION#c000#001', title: 'Now', source: 'auto' },
      { questionId: 'own:a1', title: 'Who is our customer', source: 'own' },
      { questionId: 'QUESTION#c001#001', title: 'Shelved', source: 'auto' },
    ], { currentQuestionId: 'QUESTION#c000#001' });
    expect(rows.map((r) => [r.n, r.state, r.own])).toEqual([[2, 'next', true], [3, 'later', false]]);
  });
});

/* THE OWNER'S STATE: round 1 on screen, one own question queued, five auto. */
const nowTitle = 'The Sync Deal That Changed the Catalogue';
const own = { key: 'own:a1', title: 'Who is our customer', status: 'queued' };
const autos = ['Shelved for Three Years', 'Second auto', 'Third auto', 'Fourth auto', 'The Manager Who Stayed in the Room'];
const stateWith = (extra = []) => {
  const queue = ['own:a1', ...extra];
  const upNext = [
    { source: 'own', questionId: 'own:a1', title: own.title, round: 2 },
    ...extra.map((k, i) => ({ source: 'queued', questionId: `QUESTION#${k}`, title: `Set ${k}`, round: 3 + i })),
    ...autos.map((t, i) => ({ source: 'auto', questionId: `QUESTION#c00${i + 1}#001`, title: t, round: 3 + extra.length + i })),
  ];
  const questions = extra.map((k) => ({ id: k, title: `Set ${k}`, category: 'Catalogue' }));
  return { queue, upNext, questions };
};

const queueNumbers = () => screen.getAllByTestId('queue-pos').map((el) => el.textContent);
const railNumbers = (container) => [...container.querySelectorAll('.hc-list')][0]
  .querySelectorAll('.hc-n');

const renderQueue = (s, props = {}) => render(
  <QueueList
    queue={s.queue}
    questions={s.questions}
    upNext={s.upNext}
    ownQuestions={[own]}
    onMove={() => {}}
    onAutoMove={() => {}}
    onDisable={() => {}}
    onAskNext={() => {}}
    onAskNow={() => {}}
    onEditOwn={() => {}}
    onRemoveOwn={() => {}}
    base={1}
    nowRound={{ title: nowTitle, key: 'c000#001' }}
    {...props}
  />,
);

const renderRail = (s) => render(
  <ConsoleRail
    moment="LOBBY"
    total={21}
    rounds={[{ n: 1, title: nowTitle, state: 'now' }, ...plannedRounds(1, s.upNext)]}
  />,
);

describe('the Running order numbers rounds by their place in the session', () => {
  test('the owner\'s report: now 1, Yours 2, then 3 … 7 — never 1 then 3', () => {
    renderQueue(stateWith());
    expect(queueNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    // The playing round is the first, quiet row, with no actions.
    const nowRow = screen.getByTestId('queue-now-row');
    expect(nowRow).toHaveTextContent(nowTitle);
    expect(nowRow).toHaveTextContent(/now/i);
    expect(within(nowRow).queryAllByRole('button')).toHaveLength(0);
  });

  test('without a now row the queue still numbers from the next round', () => {
    renderQueue(stateWith(), { nowRound: null });
    expect(queueNumbers()).toEqual(['2', '3', '4', '5', '6', '7']);
  });

  test('with no base given, the server plan\'s round says where the next round is', () => {
    renderQueue(stateWith(), { nowRound: null, base: null });
    expect(queueNumbers()).toEqual(['2', '3', '4', '5', '6', '7']);
  });

  test('own and set questions queued together, then the automatic order', () => {
    renderQueue(stateWith(['c009#001', 'c009#002']));
    expect(queueNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  test('after reordering, numbers follow the new order and stay gapless', () => {
    const s = stateWith(['c009#001']);
    const moved = queueMove(s.queue, 'c009#001', 'earlier').queue;
    expect(moved[0]).toBe('c009#001');
    renderQueue({ ...s, queue: moved });
    const rows = screen.getAllByTestId('queue-row');
    expect(rows[0]).toHaveTextContent('Set c009#001');
    expect(within(rows[0]).getByTestId('queue-pos')).toHaveTextContent('2');
    expect(within(rows[1]).getByTestId('queue-pos')).toHaveTextContent('3');
    expect(queueNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  test('a parked queue entry takes no round, and nothing after it skips', () => {
    const s = stateWith(['c009#001']);
    renderQueue(s, { blocked: [{ key: 'c009#001', reason: 'no-category' }] });
    // 1 now, 2 Yours, · parked, then the autos carry on from 3.
    expect(queueNumbers()).toEqual(['1', '2', '·', '3', '4', '5', '6', '7']);
  });
});

describe('both lists render the same numbers for the same state', () => {
  test.each([
    ['one own question', []],
    ['own and two set questions', ['c009#001', 'c009#002']],
  ])('%s', (_, extra) => {
    const s = stateWith(extra);
    const { container } = renderRail(s);
    const rail = [...railNumbers(container)].map((el) => el.textContent);
    cleanup();
    renderQueue(s);
    expect(queueNumbers()).toEqual(rail);
  });
});
