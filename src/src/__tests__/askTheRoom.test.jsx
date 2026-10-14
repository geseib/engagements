/**
 * ASK THE ROOM ON THE HOST'S SCREENS (docs/design/followup-icons, phase B):
 * where each ask's icon goes beside Workie's read, the preview, and the
 * question on the stage. The wall and the phones never draw an icon.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { placeAsks, pointKey } from '../config/askAnchors';
import MarkdownRenderer from '../components/MarkdownRenderer';
import AskIcons from '../components/AskIcons';
import AskPreview, { askBody } from '../components/AskPreview';
import AskStage from '../components/stage/AskStage';

const READ = [
  '## Discussion topics',
  '1. Would on-call trust a bot to restart things at 3am?',
  '2. Which pilot customers would push back first?',
  '',
  '## What the room voted',
  '- Maya leads with the runbook answer.',
  '- The vote tracked the writing.',
].join('\n');

const RATE = { type: 'rate', statement: 'People will trust a bot to restart things at 3am', answers: [1], why: 'Tests the riskiest assumption.', anchor: { section: 'Discussion topics', point: 1 }, marks: [] };
const IDEAS = { type: 'ideas', question: 'Which pilot customers would push back first?', answers: [2], why: 'Finds who to call.', anchor: { section: 'Discussion topics', point: 2 }, marks: [] };
const CHOICE = {
  type: 'choice', question: 'Which test would you start first?', answers: [1, 2, 3], why: 'Finds the cheap test.', anchor: { section: 'What the room voted', point: 2 }, marks: ['reworded'],
  options: [{ text: 'On-call logs every fix', answer: 1, marks: [] }, { text: 'Shadow invoices', answer: 2, marks: ['reworded'] }],
};
const LOST = { ...IDEAS, anchor: { section: 'Risks', point: 1 } };

describe('where the icons go', () => {
  test('each ask beside its point; a missed anchor after the read', () => {
    const { byPoint, after } = placeAsks(READ, [RATE, IDEAS, CHOICE, LOST]);
    expect(byPoint.get(pointKey('Would on-call trust a bot to restart things at 3am?'))[0]).toMatchObject({ index: 0, section: 'Discussion topics', point: 1 });
    expect(byPoint.get(pointKey('The vote tracked the writing.'))[0].index).toBe(2);
    expect(after.map((a) => a.index)).toEqual([3]);
  });

  test('the renderer draws the icon at the end of the anchored point, and nowhere without an addon', () => {
    const { byPoint } = placeAsks(READ, [RATE]);
    const addon = (text) => {
      const e = byPoint.get(text);
      return e ? <AskIcons entries={e} onOpen={() => {}} /> : null;
    };
    const host = render(<MarkdownRenderer content={READ} listItemAddon={addon} />);
    const items = host.container.querySelectorAll('li');
    expect(items[0].querySelector('.askicon')).not.toBeNull();
    expect(items[0].querySelector('.askicon').textContent).toBe('Rate');
    expect(host.container.querySelectorAll('.askicon')).toHaveLength(1);
    const wall = render(<MarkdownRenderer content={READ} />);
    expect(wall.container.querySelector('.askicon')).toBeNull();
  });
});

describe('the preview', () => {
  const entry = (ask, index = 0) => ({ index, ask, section: 'Discussion topics', point: 1 });

  test('shows what the phones will show and what it settles, then sends the suggestion as written', async () => {
    const onSend = jest.fn().mockResolvedValue({ ok: true });
    const onClose = jest.fn();
    render(<AskPreview entry={entry(RATE)} onSend={onSend} onClose={onClose} />);
    expect(screen.getByText('Rate · from Discussion topics, point 1')).toBeInTheDocument();
    expect(screen.getByText(/1 · Disagree/)).toBeInTheDocument();
    expect(screen.getByText(/Tests the riskiest assumption\. From answer 1\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith({ kind: 'rate', statement: RATE.statement, fromAnswers: [1], suggestionIndex: 0 });
  });

  test('switching kind keeps the words; a reworded option is marked', () => {
    render(<AskPreview entry={entry(CHOICE, 2)} onSend={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Reworded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Rate/ }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Which test would you start first?');
  });

  test('a live question blocks Send and says why', () => {
    render(<AskPreview entry={entry(IDEAS)} onSend={jest.fn()} onClose={jest.fn()} blocked />);
    expect(screen.getByRole('button', { name: 'Send to the room' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Finish the open question first');
  });

  test('the body is refused until it is a question the room can answer', () => {
    const e = entry(CHOICE);
    expect(askBody('choice', { question: 'Q?', statement: '', options: [{ text: 'a' }, { text: '' }] }, e).error).toMatch(/at least 2/);
    expect(askBody('ideas', { question: '  ', statement: '', options: [] }, e).error).toMatch(/Write the question/);
    expect(askBody('choice', { question: 'Q?', statement: '', options: [{ text: 'A', answer: 1 }, { text: 'b', answer: 2 }] }, e).body)
      .toMatchObject({ kind: 'choice', options: [{ text: 'A', answer: 1 }, { text: 'b', answer: 2 }], suggestionIndex: 0 });
  });
});

describe('the question on the stage', () => {
  test('live: the question and how many have answered', () => {
    const { container } = render(<AskStage ask={{ askId: 'a', kind: 'choice', status: 'live', question: 'Which first?', options: [{ text: 'X' }, { text: 'Y' }], tally: { n: 3 } }} total={5} />);
    expect(container.textContent).toMatch(/Question for the room · Choose/);
    expect(container.textContent).toMatch(/3 of 5 answered on their phone, laptop or tablet/);
  });

  test('results: Choose shows counts, Rate the average and spread; never a percentage or a name', () => {
    const choice = render(<AskStage ask={{ askId: 'a', kind: 'choice', status: 'closed', question: 'Which first?', options: [{ text: 'X' }, { text: 'Y' }], tally: { n: 4, counts: [3, 1] } }} total={5} />);
    expect(choice.container.querySelector('.is-top').textContent).toMatch(/X3/);
    expect(choice.container.textContent).not.toMatch(/%/);
    const rate = render(<AskStage ask={{ askId: 'b', kind: 'rate', status: 'closed', statement: 'Bots at 3am', tally: { n: 5, counts: [1, 2, 1, 0, 1], mean: 2.6 } }} total={5} />);
    expect(rate.container.querySelector('.askstage-mean').textContent).toBe('2.6average of 5');
  });

  test('Ideas: every answer listed for the host; pressing one puts it on the wall', () => {
    const onPick = jest.fn();
    render(<AskStage ask={{ askId: 'c', kind: 'ideas', status: 'closed', question: 'Who first?', tally: { n: 2 }, ideas: [{ id: 'i1', text: 'The agencies' }, { id: 'i2', text: 'Discount signups' }], picked: [{ id: 'i2', text: 'Discount signups' }] }} total={5} onPick={onPick} />);
    expect(screen.getByText('2 ideas · 1 shown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /The agencies/ }));
    expect(onPick).toHaveBeenCalledWith('c', 'i1', true);
    expect(screen.getByRole('button', { name: /Discount signups/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
