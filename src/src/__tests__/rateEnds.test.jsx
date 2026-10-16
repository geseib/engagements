/**
 * RATE: THE SCALE'S TWO ENDS (owner, 16 Oct 2026; docs/design/settings-consolidation,
 * tab 2). "host should be able to change what the high low says … a drop down
 * of common choices on either end which auto changes the other with the last
 * being custom (so if i select high the other auto changes to low. if you
 * select custom, you type in both.)"
 *
 * Pinned here: the composer's two pair menus set each other, Custom takes two
 * short words (both required), the send body carries the ends, and the phone,
 * the wall, the host's stage and the report all show the ask's own ends, with
 * Disagree to Agree for an ask that has none.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AskComposer, { askBody } from '../components/AskComposer';
import AskStage from '../components/stage/AskStage';
import FollowUpCard, { surveyQuestionOf } from '../components/FollowUpCard';
import ReportFollowUps from '../components/ReportFollowUps';
import { presentModel } from '../present/presentModel';
import { PresentMoment } from '../present/PresentMoments';
import PresentStage from '../present/PresentStage';
import { endsOf, RATE_PAIRS } from '../config/followUpWords';

const COLD_HOT = { low: 'Cold', high: 'Hot' };

const openRate = (onSend = jest.fn().mockResolvedValue({ ok: true })) => {
  render(<AskComposer onSend={onSend} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /Rate/ }));
  fireEvent.change(screen.getByLabelText('A statement from the room'), { target: { value: 'Name the temperature out loud' } });
  return onSend;
};

describe('the composer\'s two ends', () => {
  test('both boxes start on Disagree to Agree, and the room\'s preview says so', () => {
    openRate();
    expect(screen.getByLabelText('1 means')).toHaveDisplayValue('Disagree');
    expect(screen.getByLabelText('5 means')).toHaveDisplayValue('Agree');
    const preview = document.querySelector('.askp-scale-ends');
    expect(preview.textContent).toBe('1 · Disagree5 · Agree');
  });

  test('the pairs in order, then Custom, in either box', () => {
    openRate();
    const low = [...screen.getByLabelText('1 means').options].map((o) => o.textContent);
    const high = [...screen.getByLabelText('5 means').options].map((o) => o.textContent);
    expect(low).toEqual(['Disagree', 'No', 'Low', 'Unlikely', 'Hard', 'Custom…']);
    expect(high).toEqual(['Agree', 'Yes', 'High', 'Likely', 'Easy', 'Custom…']);
  });

  test('picking High in the 5 box sets the 1 box to Low; picking Unlikely in the 1 box sets 5 to Likely', () => {
    openRate();
    fireEvent.change(screen.getByLabelText('5 means'), { target: { value: '2' } });
    expect(screen.getByLabelText('1 means')).toHaveDisplayValue('Low');
    expect(screen.getByLabelText('5 means')).toHaveDisplayValue('High');
    fireEvent.change(screen.getByLabelText('1 means'), { target: { value: '3' } });
    expect(screen.getByLabelText('5 means')).toHaveDisplayValue('Likely');
  });

  test('a pair other than the default is sent as the ask\'s ends', async () => {
    const onSend = openRate();
    fireEvent.change(screen.getByLabelText('1 means'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rate', ends: { low: 'No', high: 'Yes' } }));
  });

  test('Custom opens two short boxes; both are required, 24 characters each', () => {
    const onSend = openRate();
    fireEvent.change(screen.getByLabelText('5 means'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('1 means')).toHaveDisplayValue('Custom…');
    const low = screen.getByLabelText('1 means, your words');
    const high = screen.getByLabelText('5 means, your words');
    expect(low).toHaveAttribute('maxLength', '24');
    expect(high).toHaveAttribute('maxLength', '24');
    fireEvent.change(low, { target: { value: 'Cold' } });
    expect(screen.getByRole('button', { name: 'Send to the room' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/both ends/);
    fireEvent.change(high, { target: { value: 'Hot' } });
    expect(document.querySelector('.askp-scale-ends').textContent).toBe('1 · Cold5 · Hot');
    fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ ends: COLD_HOT }));
  });

  test('askBody: the default pair adds nothing; custom words are trimmed; blank custom is refused', () => {
    const words = { question: '', statement: 'x', options: [] };
    expect(askBody('rate', words, null, { pair: 0 }).body).not.toHaveProperty('ends');
    expect(askBody('rate', words, null, { pair: 'custom', low: ' Cold ', high: 'Hot' }).body.ends).toEqual(COLD_HOT);
    expect(askBody('rate', words, null, { pair: 'custom', low: 'Cold', high: ' ' }).error).toMatch(/both ends/);
    expect(askBody('ideas', { ...words, question: 'q' }, null, { pair: 1 }).body).not.toHaveProperty('ends');
  });

  test('the five pairs are the owner\'s four and the mockup\'s two additions', () => {
    expect(RATE_PAIRS.map((p) => `${p.low}/${p.high}`)).toEqual(['Disagree/Agree', 'No/Yes', 'Low/High', 'Unlikely/Likely', 'Hard/Easy']);
  });
});

describe('every reader shows the ask\'s own ends', () => {
  const live = { askId: 'r1', kind: 'rate', status: 'live', statement: 'Name the temperature out loud', ends: COLD_HOT };
  const closed = { ...live, status: 'closed', tally: { n: 4, counts: [1, 0, 1, 1, 1], mean: 3.25 } };

  test('the phone\'s rating scale', () => {
    expect(surveyQuestionOf(live)).toMatchObject({ lowLabel: 'Cold', highLabel: 'Hot' });
    expect(surveyQuestionOf({ ...live, ends: undefined })).toMatchObject({ lowLabel: 'Disagree', highLabel: 'Agree' });
    const { container } = render(<FollowUpCard ask={live} onSend={jest.fn()} />);
    expect(container.textContent).toMatch(/Cold/);
    expect(container.textContent).toMatch(/Hot/);
  });

  test('the host\'s stage, live and with results', () => {
    const a = render(<AskStage ask={live} total={5} />);
    expect(a.container.querySelector('.askstage-ends').textContent).toBe('1 · Cold5 · Hot');
    a.unmount();
    const b = render(<AskStage ask={closed} total={5} />);
    const labels = [...b.container.querySelectorAll('.askstage-spread .askstage-bar-label')].map((l) => l.textContent);
    expect(labels[0]).toBe('5 · Hot');
    expect(labels[4]).toBe('1 · Cold');
  });

  test('the wall, live and with results', () => {
    const snap = {
      gameId: '2543', state: 'RESULTS#001', stageBeat: 'ask', currentQuestion: 1,
      gameMetadata: { title: 'Q4' }, roomCounts: { joined: 5, answered: 5, voted: 5 },
      currentQuestionData: { title: 'The line' },
    };
    const draw = (ask) => {
      const model = presentModel(snap, { origin: 'https://engage.example', ask });
      return render(<PresentStage profile={model.profile} fitKey="k"><PresentMoment model={model} /></PresentStage>);
    };
    const a = draw(live);
    expect(a.container.querySelector('.present-ask-scale p').textContent).toBe('1 · Cold5 · Hot');
    a.unmount();
    const b = draw(closed);
    const rows = [...b.container.querySelectorAll('.present-trow')].map((r) => r.textContent);
    expect(rows[0]).toMatch(/5 · Hot/);
    expect(rows[4]).toMatch(/1 · Cold/);
  });

  test('the report', () => {
    const f = { kind: 'rate', status: 'closed', statement: live.statement, ends: COLD_HOT, tally: closed.tally, origin: 'host' };
    const { container } = render(<ReportFollowUps followUps={[f]} />);
    const items = [...container.querySelectorAll('.report-followup-list li')].map((l) => l.textContent);
    expect(items[0]).toMatch(/^5 · Hot/);
    expect(items[4]).toMatch(/^1 · Cold/);
  });

  test('an old ask with no ends reads as Disagree to Agree', () => {
    expect(endsOf({ kind: 'rate' })).toEqual({ low: 'Disagree', high: 'Agree' });
    expect(endsOf({ kind: 'rate', scale: { lowLabel: 'No', highLabel: 'Yes' } })).toEqual({ low: 'No', high: 'Yes' });
    const { container } = render(<AskStage ask={{ ...live, ends: undefined }} total={5} />);
    expect(container.querySelector('.askstage-ends').textContent).toBe('1 · Disagree5 · Agree');
  });
});
