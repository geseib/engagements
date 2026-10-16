/**
 * A QUESTION FOR THE ROOM ON A PHONE, LAPTOP OR TABLET (docs/design/followup-icons,
 * phase C2): each kind with the survey's own input, change then send, and the
 * room's answer once the host shows it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FollowUpCard, { answered, surveyQuestionOf } from '../components/FollowUpCard';
import useHeldFollowUp from '../utils/useHeldFollowUp';

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

test('late (session flow v3 §4.4): the reply says it is kept, but not in the count', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true, body: { late: true } });
  render(<FollowUpCard ask={IDEAS} onSend={onSend} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'After the results' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/^The results are already up\. Your answer is kept, but not in the count\.$/);
  expect(screen.queryByText(/change it until the results are shown/)).toBeNull();
});

test('late, then the card turns to the room\'s answer: the line stays', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true, body: { late: true } });
  const { rerender } = render(<FollowUpCard ask={RATE} onSend={onSend} />);
  fireEvent.click(screen.getByRole('radio', { name: /4/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('status');
  rerender(<FollowUpCard ask={{ ...RATE, status: 'closed', tally: { n: 3, counts: [0, 0, 1, 2, 0], mean: 3.7 } }} yours={4} onSend={onSend} />);
  expect(screen.getByRole('status')).toHaveTextContent('The results are already up. Your answer is kept, but not in the count.');
});

test('a draft survives the ask closing: the form and Send stay, and Send is kept late', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true, body: { late: true } });
  const { rerender } = render(<FollowUpCard ask={IDEAS} onSend={onSend} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Still typing' } });
  rerender(<FollowUpCard ask={{ ...IDEAS, status: 'closed', tally: { n: 2 }, picked: [] }} onSend={onSend} />);
  expect(screen.getByRole('textbox')).toHaveValue('Still typing');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(onSend).toHaveBeenCalledWith('Still typing'));
  expect(await screen.findByRole('status')).toHaveTextContent('The results are already up. Your answer is kept, but not in the count.');
});

test('no draft: a closed ask turns to the room\'s answer as before', () => {
  const { rerender, container } = render(<FollowUpCard ask={IDEAS} onSend={jest.fn()} />);
  rerender(<FollowUpCard ask={{ ...IDEAS, status: 'closed', tally: { n: 2 }, picked: [] }} onSend={jest.fn()} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(container.textContent).toMatch(/2 ideas · 0 shown/);
});

/*
  THE PARENT'S HOLD (PlayerPage + utils/useHeldFollowUp.js), wired as
  PlayerPage wires it: the public read's ask when there is one, else the held
  one, with the held draft to start from.
*/
function Room({ ask, gameState, onServer }) {
  const { held, onDraft, keptLate, release, heldFor } = useHeldFollowUp(gameState);
  const shown = ask || (held && held.ask);
  if (!shown) return <p>Next round</p>;
  const h = heldFor(shown);
  const onSend = async (value) => {
    const r = await onServer(shown, value);
    if (r.ok && r.body && r.body.late) keptLate(shown); else if (r.ok) release();
    return r;
  };
  return (
    <FollowUpCard
      key={ask ? 'results' : 'held'}
      ask={shown}
      draft={h ? h.draft : null}
      keptLate={Boolean(h && h.late)}
      onDraft={onDraft(shown)}
      onSend={onSend}
    />
  );
}

test('the room moves on (the ask goes null) with a draft: the card stays, and Send is kept late', async () => {
  const onServer = jest.fn().mockResolvedValue({ ok: true, body: { late: true } });
  const { rerender } = render(<Room ask={IDEAS} gameState="RESULTS#003" onServer={onServer} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Before it moved' } });
  rerender(<Room ask={null} gameState="ASK#004" onServer={onServer} />);
  expect(screen.getByRole('textbox')).toHaveValue('Before it moved');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(onServer).toHaveBeenCalledWith(IDEAS, 'Before it moved'));
  expect(await screen.findByRole('status')).toHaveTextContent('The results are already up. Your answer is kept, but not in the count.');
  // Let go once the state next moves.
  rerender(<Room ask={null} gameState="VOTE#004" onServer={onServer} />);
  expect(screen.getByText('Next round')).toBeInTheDocument();
});

test('the room moves on with nothing typed: the card goes', () => {
  const { rerender } = render(<Room ask={IDEAS} gameState="RESULTS#003" onServer={jest.fn()} />);
  rerender(<Room ask={null} gameState="ASK#004" onServer={jest.fn()} />);
  expect(screen.getByText('Next round')).toBeInTheDocument();
});

test('a draft emptied after the room moved on lets the card go', () => {
  const { rerender } = render(<Room ask={IDEAS} gameState="RESULTS#003" onServer={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
  rerender(<Room ask={null} gameState="ASK#004" onServer={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  expect(screen.getByText('Next round')).toBeInTheDocument();
});
