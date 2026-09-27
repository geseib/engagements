import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SurveyQuestionFields from '../components/SurveyQuestionFields';
import { POLL_KINDS, YESNO_PRESETS, yesNoPresetOf, defaultsFor } from '../config/surveyKinds';

/*
 * TWO THINGS THE SURVEY QUESTION FORM GAINED FOR POLLS, AND GIVES BACK TO SURVEYS
 * (the owner, 27 Sep 2026: "any changes to the poll can be applied to survey").
 *
 *   - `kinds` limits the kind bar: a poll question is one of four kinds, so the
 *     poll form offers those, in the order given; `textFields={false}` leaves
 *     the question and its detail to the form that mounts it.
 *   - A binary question's two answers come in named pairs — "default yes/no but
 *     could be approve/decline, true/false" — and a preset fills both labels,
 *     which stay editable. Yes / No is the default, stored as blank labels.
 *
 * Rendered with a real state holder, so what is asserted is what the form
 * shows after its own onChange, not what a spy was called with.
 */

function Harness({ initial, onRow, ...props }) {
  const [draft, setDraft] = useState({ uid: 'u1', title: 'Ship it?', detail: '', ...initial });
  return (
    <SurveyQuestionFields
      draft={draft}
      onChange={(next) => { setDraft(next); if (onRow) onRow(next); }}
      idOf={(field) => `q-${field}-u1`}
      {...props}
    />
  );
}

const kindButtons = () => within(screen.getByRole('group', { name: 'Kind' })).getAllByRole('button');
const answers = () => screen.getByRole('group', { name: 'The two answers' });
const pressed = (group) => within(group).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

describe('the kinds offered', () => {
  test('a survey is offered all five, as before', () => {
    render(<Harness initial={defaultsFor('rating')} />);
    expect(kindButtons().map((b) => b.textContent))
      .toEqual(['Rating', 'Multiple choice', 'Yes / No', 'Ranking', 'Open answer']);
    expect(screen.getByLabelText('Question')).toHaveValue('Ship it?');
  });

  test('kinds={POLL_KINDS} offers the four poll kinds, in that order', () => {
    render(<Harness initial={defaultsFor('choice')} kinds={POLL_KINDS} />);
    expect(kindButtons().map((b) => b.textContent))
      .toEqual(['Multiple choice', 'Rating', 'Yes / No', 'Open answer']);
    expect(pressed(screen.getByRole('group', { name: 'Kind' }))).toEqual(['Multiple choice']);
  });

  test('an id that names no kind is dropped, not drawn as a dead button', () => {
    render(<Harness initial={defaultsFor('text')} kinds={['text', 'slider', 'yesno']} />);
    expect(kindButtons().map((b) => b.textContent)).toEqual(['Open answer', 'Yes / No']);
  });

  test('switching kind within the limited bar still converts the question', () => {
    const rows = [];
    render(<Harness initial={defaultsFor('choice')} kinds={POLL_KINDS} onRow={(r) => rows.push(r)} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'Yes / No' }));
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'yesno', yesLabel: '', noLabel: '', title: 'Ship it?' });
  });

  test('textFields={false} leaves the question and its detail to the form around it', () => {
    render(<Harness initial={defaultsFor('rating')} kinds={POLL_KINDS} textFields={false} />);
    expect(screen.queryByLabelText('Question')).toBeNull();
    expect(screen.queryByLabelText(/^Detail/)).toBeNull();
    // Everything else the kind needs is still there.
    expect(screen.getByRole('group', { name: 'Scale' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Needs an answer/ })).toBeTruthy();
  });
});

describe('a yes / no question\'s named answer pairs', () => {
  test('the four pairs, and Yes / No lit for a question nobody relabelled', () => {
    render(<Harness initial={defaultsFor('yesno')} />);
    expect(within(answers()).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Yes / No', 'Approve / Decline', 'True / False', 'Agree / Disagree']);
    expect(pressed(answers())).toEqual(['Yes / No']);
  });

  test.each([
    ['Approve / Decline', 'Approve', 'Decline'],
    ['True / False', 'True', 'False'],
    ['Agree / Disagree', 'Agree', 'Disagree'],
  ])('%s fills both labels, which stay editable', (name, yes, no) => {
    const rows = [];
    render(<Harness initial={defaultsFor('yesno')} onRow={(r) => rows.push(r)} />);
    fireEvent.click(within(answers()).getByRole('button', { name }));
    expect(rows[rows.length - 1]).toMatchObject({ yesLabel: yes, noLabel: no });
    expect(screen.getByLabelText('Yes reads')).toHaveValue(yes);
    expect(screen.getByLabelText('No reads')).toHaveValue(no);
    expect(pressed(answers())).toEqual([name]);
  });

  test('Yes / No goes back to the default: two blank labels, not the words pinned', () => {
    const rows = [];
    render(<Harness initial={{ ...defaultsFor('yesno'), yesLabel: 'Approve', noLabel: 'Decline' }} onRow={(r) => rows.push(r)} />);
    expect(pressed(answers())).toEqual(['Approve / Decline']);
    fireEvent.click(within(answers()).getByRole('button', { name: 'Yes / No' }));
    expect(rows[rows.length - 1]).toMatchObject({ yesLabel: '', noLabel: '' });
    expect(screen.getByLabelText('Yes reads')).toHaveValue('');
  });

  test('words of your own light no preset, and a preset leaves the rest of the question alone', () => {
    const rows = [];
    render(<Harness initial={{ ...defaultsFor('yesno'), unsure: true }} onRow={(r) => rows.push(r)} />);
    fireEvent.change(screen.getByLabelText('Yes reads'), { target: { value: 'Ship it' } });
    expect(pressed(answers())).toEqual([]);
    fireEvent.click(within(answers()).getByRole('button', { name: 'True / False' }));
    expect(rows[rows.length - 1]).toMatchObject({ unsure: true, title: 'Ship it?' });
  });
});

describe('yesNoPresetOf', () => {
  test('names the preset a pair of labels is, or nothing', () => {
    expect(yesNoPresetOf({ yesLabel: '', noLabel: '' })).toBe('yes-no');
    expect(yesNoPresetOf({ yesLabel: 'Yes', noLabel: 'No' })).toBe('yes-no');
    expect(yesNoPresetOf({ yesLabel: ' Approve ', noLabel: 'Decline' })).toBe('approve-decline');
    expect(yesNoPresetOf({ yesLabel: 'True', noLabel: '' })).toBe('');
    expect(yesNoPresetOf({ yesLabel: 'Keep it', noLabel: 'Change it' })).toBe('');
  });

  test('the default preset is stored as blank labels', () => {
    expect(YESNO_PRESETS[0]).toMatchObject({ label: 'Yes / No', yesLabel: '', noLabel: '' });
  });
});
