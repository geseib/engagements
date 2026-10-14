/**
 * A QUESTION FOR THE ROOM ON THE WALL (docs/design/followup-icons, phase C1):
 * the `ask` beat reads the public follow-up read. Live: the words and how many
 * have answered. Results: counts for Choose, the average and spread for Rate,
 * only the picked words for Ideas. Never a name, never a percentage.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { presentModel } from '../present/presentModel';
import { PresentMoment } from '../present/PresentMoments';
import PresentStage from '../present/PresentStage';

const snap = (over = {}) => ({
  gameId: '2543', state: 'RESULTS#001', stageBeat: 'ask', currentQuestion: 1,
  gameMetadata: { title: 'Q4 Wrap up' }, roomCounts: { joined: 5, answered: 5, voted: 5 },
  currentQuestionData: { title: 'The line', detail: 'Rewrite it.' }, ...over,
});
const drawn = (s, reads) => {
  const model = presentModel(s, { origin: 'https://engage.dev.seibtribe.us', ...reads });
  return { model, ...render(<PresentStage profile={model.profile} fitKey="k"><PresentMoment model={model} /></PresentStage>) };
};

test('live Choose: the question, its options, and "3 of 5 answered"', () => {
  const { model, container } = drawn(snap(), { ask: { askId: 'a', kind: 'choice', status: 'live', question: 'Which test first?', options: ['On-call logs', 'Shadow invoices'], answered: 3 } });
  expect(model.moment).toBe('ROOM_QUESTION');
  expect(container.textContent).toMatch(/Question for the room/);
  expect(container.textContent).toMatch(/Choose one/);
  expect(container.textContent).toMatch(/Shadow invoices/);
  expect(container.querySelector('.present-foot').textContent).toMatch(/3 of 5 answered on their phone, laptop or tablet/);
});

test('Choose results: a bar and a count per option, no percentage', () => {
  const { model, container } = drawn(snap(), { ask: { askId: 'a', kind: 'choice', status: 'closed', question: 'Which test first?', options: ['On-call logs', 'Shadow invoices'], tally: { n: 4, counts: [3, 1] } } });
  expect(model.moment).toBe('ROOM_RESULTS');
  expect(container.querySelectorAll('.present-trow')).toHaveLength(2);
  expect(container.textContent).not.toMatch(/%/);
  expect(container.querySelector('.present-foot').textContent).toBe('4 answered');
});

test('Rate results: the average of 5 and the spread from Agree to Disagree', () => {
  const { container } = drawn(snap(), { ask: { askId: 'b', kind: 'rate', status: 'closed', statement: 'People will trust a bot at 3am', tally: { n: 5, counts: [1, 2, 1, 0, 1], mean: 2.4 } } });
  expect(container.querySelector('.present-ask-mean').textContent).toBe('2.4average of 5');
  const labels = [...container.querySelectorAll('.present-trow')].map((r) => r.textContent);
  expect(labels[0]).toMatch(/5 · Agree/);
  expect(labels[4]).toMatch(/1 · Disagree/);
});

test('Ideas results: only what the host picked, and how many were written', () => {
  const { container } = drawn(snap(), { ask: { askId: 'c', kind: 'ideas', status: 'closed', question: 'Who pushes back first?', tally: { n: 5 }, picked: ['The two agencies'] } });
  expect([...container.querySelectorAll('.present-ask-ideas blockquote')].map((b) => b.textContent)).toEqual(['The two agencies']);
  expect(container.querySelector('.present-foot').textContent).toBe('5 ideas · 1 shown');
});

test('before the read arrives the wall waits rather than guessing', () => {
  expect(presentModel(snap(), {}).moment).toBe('READ_WAIT');
});
