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
import AskComposer, { askBody, editedFrom } from '../components/AskComposer';
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

describe('the composer (session flow v3 §4.1)', () => {
  const entry = (ask, index = 0) => ({ index, ask, section: 'Discussion topics', point: 1 });
  const open = (props) => render(<AskComposer onSend={jest.fn()} onClose={jest.fn()} {...props} />);

  test('from a Workie icon: that suggestion picked, its words ready, sent as written', async () => {
    const onSend = jest.fn().mockResolvedValue({ ok: true });
    const onClose = jest.fn();
    open({ suggestions: [entry(RATE)], startIndex: 0, onSend, onClose });
    expect(screen.getByRole('button', { name: /Rate.*from Discussion topics, point 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'A statement from the room' })).toHaveValue(RATE.statement);
    expect(screen.getByText(/Tests the riskiest assumption\. From answer 1\./)).toBeInTheDocument();
    expect(screen.getByText(/Answers are anonymous/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith({ kind: 'rate', statement: RATE.statement, fromAnswers: [1], suggestionIndex: 0 });
  });

  test('from the dock: blank, with Workie\'s suggestions to pick from; a blank question sends with no suggestion', async () => {
    const onSend = jest.fn().mockResolvedValue({ ok: true });
    open({ suggestions: [entry(IDEAS, 0), entry(RATE, 1)], startIndex: null, onSend });
    expect(screen.getByRole('button', { name: 'Start from blank' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('textbox', { name: 'The question the room sees' }), { target: { value: 'What would you stop doing?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ kind: 'ideas', question: 'What would you stop doing?', fromAnswers: [], suggestionIndex: undefined }));
  });

  test('changing Workie\'s words shows Edited, and Back to Workie\'s words restores them', () => {
    open({ suggestions: [entry(IDEAS)], startIndex: 0 });
    const box = screen.getByRole('textbox', { name: 'The question the room sees' });
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'Something else?' } });
    expect(screen.getByText('Edited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Back to Workie's words" }));
    expect(box).toHaveValue(IDEAS.question);
    expect(editedFrom(entry(IDEAS), 'rate', { question: IDEAS.question, statement: '', options: [] })).toBe(true);
  });

  test('switching kind keeps the words; a reworded option is marked', () => {
    open({ suggestions: [entry(CHOICE, 2)], startIndex: 2 });
    expect(screen.getByText('Reworded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Rate/ }));
    expect(screen.getByRole('textbox', { name: 'A statement from the room' })).toHaveValue('Which test would you start first?');
  });

  test('a live question blocks Send and says why', () => {
    open({ suggestions: [entry(IDEAS)], startIndex: 0, blocked: true });
    expect(screen.getByRole('button', { name: 'Send to the room' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Finish the open question first');
  });

  test('Comments opens the feedback round instead of sending an ask (Q7)', async () => {
    const onComments = jest.fn().mockResolvedValue({ ok: true });
    const onSend = jest.fn();
    open({ suggestions: [], onComments, onSend });
    fireEvent.click(screen.getByRole('radio', { name: /Comments/ }));
    expect(screen.getByText(/Names are shown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open comments' }));
    await waitFor(() => expect(onComments).toHaveBeenCalled());
    expect(onSend).not.toHaveBeenCalled();
  });

  test('without onComments there is no Comments kind (the tier keeps Request feedback)', () => {
    open({ suggestions: [] });
    expect(screen.queryByRole('radio', { name: /Comments/ })).not.toBeInTheDocument();
  });

  test('one screen folds Workie\'s reason away (Q2)', () => {
    open({ suggestions: [entry(RATE)], startIndex: 0, oneScreen: true });
    expect(screen.getByText("Why Workie suggests this")).toBeInTheDocument();
    expect(screen.queryByText('For you:')).not.toBeInTheDocument();
  });

  test('words from the read: a click fills the question, then adds options to a Choose (Q6)', () => {
    open({ suggestions: [], readLines: ['Retire the paper sign-off sheet first.', 'Name the measure that triggers the next stage.'] });
    fireEvent.click(screen.getByRole('button', { name: /Use these words: Retire the paper/ }));
    expect(screen.getByRole('textbox', { name: 'The question the room sees' })).toHaveValue('Retire the paper sign-off sheet first.');
    fireEvent.click(screen.getByRole('radio', { name: /Choose/ }));
    fireEvent.click(screen.getByRole('button', { name: /Use these words: Name the measure/ }));
    expect(screen.getByRole('textbox', { name: 'Option A' })).toHaveValue('Name the measure that triggers the next stage.');
  });

  test('the body is refused until it is a question the room can answer', () => {
    const e = entry(CHOICE);
    expect(askBody('choice', { question: 'Q?', statement: '', options: [{ text: 'a' }, { text: '' }] }, e).error).toMatch(/at least 2/);
    expect(askBody('ideas', { question: '  ', statement: '', options: [] }, e).error).toMatch(/Write the question/);
    expect(askBody('choice', { question: 'Q?', statement: '', options: [{ text: 'A', answer: 1 }, { text: 'b', answer: 2 }] }, e).body)
      .toMatchObject({ kind: 'choice', options: [{ text: 'A', answer: 1 }, { text: 'b', answer: 2 }], suggestionIndex: 0 });
    expect(askBody('ideas', { question: 'Q?', statement: '', options: [] }, null).body).toEqual({ kind: 'ideas', question: 'Q?', fromAnswers: [], suggestionIndex: undefined });
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
