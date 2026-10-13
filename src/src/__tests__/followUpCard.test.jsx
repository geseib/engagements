/**
 * A QUESTION FOR THE ROOM ON A PHONE, LAPTOP OR TABLET (docs/design/followup-icons,
 * phase C2): each kind with the survey's own input, change then send, and the
 * room's answer once the host shows it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FollowUpCard, { answered, surveyQuestionOf } from '../components/FollowUpCard';

const CHOICE = { askId: 'a1', round: '003', kind: 'choice', status: 'live', question: 'Which test first?', options: ['On-call logs', 'Shadow invoices'] };
const RATE = { askId: 'a2', round: '003', kind: 'rate', status: 'live', statement: 'People will trust a bot at 3am' };
const IDEAS = { askId: 'a3', round: '003', kind: 'ideas', status: 'live', question: 'Who pushes back first?' };

test('each kind maps onto the survey shape the phone already draws', () => {
  expect(surveyQuestionOf(RATE)).toMatchObject({ kind: 'rating', scale: '1-5', lowLabel: 'Disagree', highLabel: 'Agree' });
  expect(surveyQuestionOf(IDEAS)).toMatchObject({ kind: 'text', maxLength: 280 });
  expect(surveyQuestionOf(CHOICE)).toMatchObject({ kind: 'choice', options: ['On-call logs', 'Shadow invoices'], allowMultiple: false });
  expect(answered(CHOICE, [1])).toBe(true);
  expect(answered(CHOICE, [])).toBe(false);
  expect(answered(RATE, 6)).toBe(false);
  expect(answered(IDEAS, '   ')).toBe(false);
});

test('Choose: pick one, send, and it says the answer can change until results', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true });
  render(<FollowUpCard ask={CHOICE} onSend={onSend} />);
  expect(screen.getByText('Question for the room · Choose')).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Send' });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByText('Shadow invoices'));
  fireEvent.click(send);
  await waitFor(() => expect(onSend).toHaveBeenCalledWith([1]));
  expect(await screen.findByRole('status')).toHaveTextContent(/change it until the results are shown/);
});

test('Ideas: the words are trimmed before they are sent', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true });
  render(<FollowUpCard ask={IDEAS} onSend={onSend} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  The agencies  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(onSend).toHaveBeenCalledWith('The agencies'));
});

test('a refusal keeps the answer and says why', async () => {
  render(<FollowUpCard ask={IDEAS} onSend={jest.fn().mockResolvedValue({ ok: false, error: 'this question is no longer open' })} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Late idea' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer open');
  expect(screen.getByRole('textbox')).toHaveValue('Late idea');
});

test('closed: the room\'s answer in counts, and only the picked ideas', () => {
  const { container, rerender } = render(<FollowUpCard ask={{ ...CHOICE, status: 'closed', tally: { n: 4, counts: [3, 1] } }} onSend={jest.fn()} />);
  expect(container.textContent).toMatch(/A · On-call logs3/);
  expect(container.textContent).toMatch(/4 answered/);
  rerender(<FollowUpCard ask={{ ...IDEAS, status: 'closed', tally: { n: 5 }, picked: ['The agencies'] }} onSend={jest.fn()} />);
  expect(container.querySelectorAll('.fu-ideas li')).toHaveLength(1);
  expect(container.textContent).toMatch(/5 ideas · 1 shown/);
});
