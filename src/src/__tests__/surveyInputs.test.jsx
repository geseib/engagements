/**
 * THE FIVE SURVEY INPUTS ON THE PHONE — what a screen reader and a keyboard get.
 *
 * Mockups p-01 … p-06 in docs/design/survey-redesign are the design. The
 * accessibility half of it is contract, not polish (IMPLEMENTATION-phase-2.md
 * §4 Track C): a rating is a radiogroup with arrow-key roving, stars included;
 * a choice is radios for one and checkboxes for several and says "up to N";
 * the write-in is labelled; a yes/no starts with NOTHING chosen (a default is an
 * answer the person never gave) and asks why only after the answer that
 * triggers it; a ranking works by tapping and by Move up / Move down buttons,
 * never by dragging (WCAG 2.5.7); an open answer counts its characters and
 * stops at its limit.
 *
 * Every value asserted here is the CONTRACT's value (§2 "Answer values"):
 * options travel as canonical indexes, whatever order the phone drew them in.
 *
 * No geometry: jsdom has no layout engine. Roles, names, states and the values
 * handed to onChange are what it models, so that is what is pinned.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RatingInput from '../components/survey/RatingInput';
import ChoiceInput from '../components/survey/ChoiceInput';
import YesNoInput from '../components/survey/YesNoInput';
import RankInput from '../components/survey/RankInput';
import TextInput from '../components/survey/TextInput';
import { isAnswered, summaryFor, seededOrder } from '../components/survey/surveyAnswers';

const rating = (over = {}) => ({
  qid: 'c001#001', n: 1, kind: 'rating', required: true,
  title: 'How useful was today’s session for your work?',
  scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', ...over,
});
const choice = (over = {}) => ({
  qid: 'c001#003', n: 3, kind: 'choice', required: true,
  title: 'Which part of the presentation was most valuable to you?',
  options: ['Live demo', 'Case studies', 'Pricing roadmap', 'Open Q&A'],
  allowMultiple: false, allowOther: false, shuffle: false, ...over,
});
const yesno = (over = {}) => ({
  qid: 'c001#005', n: 5, kind: 'yesno', required: true,
  title: 'Was the length about right?', yesLabel: '', noLabel: '', unsure: false,
  followUpWhen: '', followUpPrompt: '', ...over,
});
const rank = (over = {}) => ({
  qid: 'c001#006', n: 6, kind: 'rank', required: false,
  title: 'Rank these topics for the next all-hands',
  options: ['Customer stories', 'Product roadmap', 'Team wins', 'Culture & hiring', 'Financials'],
  rankTop: 3, ...over,
});
const text = (over = {}) => ({
  qid: 'c001#008', n: 8, kind: 'text', required: false,
  title: 'What would you like to see added or changed?',
  textLength: 'short', maxLength: 280, placeholder: '', ...over,
});

/* ======================================================================= */
describe('RatingInput', () => {
  test('a radiogroup of the scale, named from its ends, nothing chosen', () => {
    render(<RatingInput question={rating()} value={null} onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'From 1, Not useful, to 5, Very useful' });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-checked', 'false'));
    expect(group).toBeInTheDocument();
  });

  test('the end labels sit under the ends', () => {
    render(<RatingInput question={rating()} value={null} onChange={() => {}} />);
    expect(screen.getByText('1 · Not useful')).toBeInTheDocument();
    expect(screen.getByText('5 · Very useful')).toBeInTheDocument();
  });

  test('a tap is the value, and the chosen step says so', () => {
    const onChange = jest.fn();
    const { rerender } = render(<RatingInput question={rating()} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '4 of 5' }));
    expect(onChange).toHaveBeenCalledWith(4);
    rerender(<RatingInput question={rating()} value={4} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: '4 of 5' })).toHaveAttribute('aria-checked', 'true');
  });

  test('roving tabindex: one tab stop — the chosen step, else the first', () => {
    const { rerender } = render(<RatingInput question={rating()} value={null} onChange={() => {}} />);
    let stops = screen.getAllByRole('radio').map((r) => r.tabIndex);
    expect(stops).toEqual([0, -1, -1, -1, -1]);
    rerender(<RatingInput question={rating()} value={3} onChange={() => {}} />);
    stops = screen.getAllByRole('radio').map((r) => r.tabIndex);
    expect(stops).toEqual([-1, -1, 0, -1, -1]);
  });

  test('arrow keys move the choice and the focus, Home and End go to the ends, and it wraps', () => {
    const onChange = jest.fn();
    const q = rating();
    const { rerender } = render(<RatingInput question={q} value={3} onChange={onChange} />);
    const three = screen.getByRole('radio', { name: '3 of 5' });
    fireEvent.keyDown(three, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '4 of 5' }));
    fireEvent.keyDown(three, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(three, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(three, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(three, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(three, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(5);
    rerender(<RatingInput question={q} value={5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: '5 of 5' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  test('0–10 is eleven steps from 0, and 1–10 is ten', () => {
    const { unmount } = render(<RatingInput question={rating({ scale: '0-10', lowLabel: 'Not at all likely', highLabel: 'Extremely likely' })} value={null} onChange={() => {}} />);
    let radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(11);
    expect(radios[0]).toHaveAttribute('aria-label', '0 of 10');
    expect(screen.getByText('0 · Not at all likely')).toBeInTheDocument();
    unmount();
    render(<RatingInput question={rating({ scale: '1-10', lowLabel: '', highLabel: '' })} value={null} onChange={() => {}} />);
    radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(10);
    expect(screen.getByRole('radiogroup', { name: 'From 1 to 10' })).toBeInTheDocument();
  });

  test('stars are the same radiogroup, drawn as glyphs, with the digit kept in the name', () => {
    const onChange = jest.fn();
    render(<RatingInput question={rating({ scale: 'stars' })} value={2} onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios[1]).toHaveAttribute('aria-label', '2 of 5');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[0].textContent).toBe('★');
    fireEvent.keyDown(radios[1], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(3);
  });
});

/* ======================================================================= */
describe('ChoiceInput', () => {
  test('pick one is radios in a radiogroup, and says so', () => {
    const onChange = jest.fn();
    render(<ChoiceInput question={choice()} value={null} onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Pick one' })).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByText(/Pick one/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Case studies/ }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  test('a second pick replaces the first', () => {
    const onChange = jest.fn();
    render(<ChoiceInput question={choice()} value={[1]} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /Case studies/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Open Q&A/ }));
    expect(onChange).toHaveBeenLastCalledWith([3]);
  });

  test('pick several is checkboxes, and states "up to N" with how many are picked', () => {
    const onChange = jest.fn();
    const q = choice({ allowMultiple: true, maxPicks: 2 });
    const { rerender } = render(<ChoiceInput question={q} value={[0]} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Pick up to two' })).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByText(/1 of 2 picked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Pricing roadmap/ }));
    expect(onChange).toHaveBeenLastCalledWith([0, 2]);
    rerender(<ChoiceInput question={q} value={[0, 2]} onChange={onChange} />);
    expect(screen.getByText(/2 of 2 picked/)).toBeInTheDocument();
    // At the limit the rest are unavailable, and say so, rather than silently ignoring a tap.
    const fourth = screen.getByRole('checkbox', { name: /Open Q&A/ });
    expect(fourth).toHaveAttribute('aria-disabled', 'true');
    onChange.mockClear();
    fireEvent.click(fourth);
    expect(onChange).not.toHaveBeenCalled();
    // Unticking one frees a place.
    fireEvent.click(screen.getByRole('checkbox', { name: /Live demo/ }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });

  test('pick several with no limit says "pick any"', () => {
    render(<ChoiceInput question={choice({ allowMultiple: true, maxPicks: null })} value={null} onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Pick any' })).toBeInTheDocument();
  });

  test('the write-in is labelled, and its words travel as {other}', () => {
    const onChange = jest.fn();
    const q = choice({ allowMultiple: true, maxPicks: 2, allowOther: true });
    const { rerender } = render(<ChoiceInput question={q} value={[0]} onChange={onChange} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Something else/ }));
    // Ticked with nothing written is not yet an answer, so nothing new is sent.
    const box = screen.getByRole('textbox', { name: 'Something else — say what' });
    expect(box).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'A written summary' } });
    expect(onChange).toHaveBeenLastCalledWith([0, { other: 'A written summary' }], { typing: true });
    rerender(<ChoiceInput question={q} value={[0, { other: 'A written summary' }]} onChange={onChange} />);
    // The write-in counts as a pick.
    expect(screen.getByText(/2 of 2 picked/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Something else — say what' })).toHaveValue('A written summary');
    expect(screen.getByRole('checkbox', { name: /Something else/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('in pick one, the write-in is the one answer', () => {
    const onChange = jest.fn();
    render(<ChoiceInput question={choice({ allowOther: true })} value={[2]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Something else/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Something else — say what' }), { target: { value: 'Lunch' } });
    expect(onChange).toHaveBeenLastCalledWith([{ other: 'Lunch' }], { typing: true });
  });

  test('a shuffled order is display only: the value is still the canonical index', () => {
    const onChange = jest.fn();
    render(<ChoiceInput question={choice({ shuffle: true })} order={[3, 1, 0, 2]} value={null} onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName(/Open Q&A/);
    fireEvent.click(radios[0]);
    expect(onChange).toHaveBeenLastCalledWith([3]);
  });
});

/* ======================================================================= */
describe('YesNoInput', () => {
  test('nothing is preselected', () => {
    render(<YesNoInput question={yesno()} value={null} onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Yes', 'No']);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  test('its own labels, and Not sure only when offered', () => {
    render(<YesNoInput question={yesno({ yesLabel: 'Agree', noLabel: 'Disagree', unsure: true })} value={null} onChange={() => {}} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Agree', 'Disagree', 'Not sure']);
  });

  test('a tap is {v}', () => {
    const onChange = jest.fn();
    render(<YesNoInput question={yesno({ unsure: true })} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Not sure' }));
    expect(onChange).toHaveBeenLastCalledWith({ v: 'unsure' });
  });

  test('asks why only after the answer that triggers it', () => {
    const onChange = jest.fn();
    const q = yesno({ unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut or add?' });
    const { rerender } = render(<YesNoInput question={q} value={{ v: 'yes' }} onChange={onChange} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(<YesNoInput question={q} value={{ v: 'unsure' }} onChange={onChange} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(<YesNoInput question={q} value={{ v: 'no' }} onChange={onChange} />);
    const why = screen.getByRole('textbox', { name: /What would you cut or add\?/ });
    expect(why).toHaveAttribute('maxLength', '280');
    expect(screen.getByText('0 / 280')).toBeInTheDocument();
    fireEvent.change(why, { target: { value: 'Shorter roadmap' } });
    expect(onChange).toHaveBeenLastCalledWith({ v: 'no', why: 'Shorter roadmap' }, { typing: true });
    rerender(<YesNoInput question={q} value={{ v: 'no', why: 'Shorter roadmap' }} onChange={onChange} />);
    expect(screen.getByText('15 / 280')).toBeInTheDocument();
    // Emptying the note takes the why out of the value, rather than saving "".
    fireEvent.change(why, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ v: 'no' }, { typing: true });
  });

  test('moving off the triggering answer drops the why from the value', () => {
    const onChange = jest.fn();
    const q = yesno({ followUpWhen: 'no', followUpPrompt: 'Why not?' });
    render(<YesNoInput question={q} value={{ v: 'no', why: 'Too long' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(onChange).toHaveBeenLastCalledWith({ v: 'yes' });
  });

  test('"either way" asks after yes and after no', () => {
    const q = yesno({ followUpWhen: 'any', followUpPrompt: 'Why?' });
    const { rerender } = render(<YesNoInput question={q} value={{ v: 'yes' }} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: /Why\?/ })).toBeInTheDocument();
    rerender(<YesNoInput question={q} value={{ v: 'no' }} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: /Why\?/ })).toBeInTheDocument();
  });

  test('arrow keys rove here too', () => {
    const onChange = jest.fn();
    render(<YesNoInput question={yesno()} value={{ v: 'yes' }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Yes' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith({ v: 'no' });
  });
});

/* ======================================================================= */
describe('RankInput', () => {
  test('nothing placed: every item is a tap to add, and the rule says the top N is enough', () => {
    const onChange = jest.fn();
    render(<RankInput question={rank()} value={null} onChange={onChange} />);
    expect(screen.getByText(/Tap them in the order you’d put them/)).toBeInTheDocument();
    expect(screen.getByText(/Your top three is enough/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add Team wins/ }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });

  test('a tap places the item next in line', () => {
    const onChange = jest.fn();
    render(<RankInput question={rank()} value={[0, 1]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Financials/ }));
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 4]);
  });

  test('placed items show their place, in an ordered list', () => {
    render(<RankInput question={rank()} value={[0, 1, 2]} onChange={() => {}} />);
    const order = screen.getByRole('list', { name: 'Your order' });
    expect(order.tagName).toBe('OL');
    expect(order.textContent).toMatch(/1\s*Customer stories/);
    expect(order.textContent).toMatch(/3\s*Team wins/);
  });

  test('Move X up / Move X down reorder without any drag', () => {
    const onChange = jest.fn();
    render(<RankInput question={rank()} value={[0, 1, 2]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Product roadmap up' }));
    expect(onChange).toHaveBeenLastCalledWith([1, 0, 2]);
    fireEvent.click(screen.getByRole('button', { name: 'Move Customer stories down' }));
    expect(onChange).toHaveBeenLastCalledWith([1, 0, 2]);
    expect(screen.getByRole('button', { name: 'Move Customer stories up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Team wins down' })).toBeDisabled();
    expect(document.querySelector('[draggable="true"]')).toBeNull();
  });

  test('tapping a placed item takes it out and closes the gap', () => {
    const onChange = jest.fn();
    render(<RankInput question={rank()} value={[0, 1, 2]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Take out Product roadmap/ }));
    expect(onChange).toHaveBeenLastCalledWith([0, 2]);
  });

  test('without a top N it says to rank them all', () => {
    render(<RankInput question={rank({ rankTop: null })} value={null} onChange={() => {}} />);
    expect(screen.queryByText(/is enough/)).toBeNull();
  });
});

/* ======================================================================= */
describe('TextInput', () => {
  test('labelled, with the placeholder the set carries', () => {
    render(<TextInput question={text({ placeholder: 'One thing is plenty' })} value="" onChange={() => {}} />);
    const box = screen.getByRole('textbox', { name: 'Your answer' });
    expect(box).toHaveAttribute('placeholder', 'One thing is plenty');
  });

  test('a counter, and the limit is enforced', () => {
    const onChange = jest.fn();
    const { rerender } = render(<TextInput question={text({ maxLength: 20 })} value="Hello" onChange={onChange} />);
    const box = screen.getByRole('textbox', { name: 'Your answer' });
    expect(box).toHaveAttribute('maxLength', '20');
    expect(screen.getByText('5 / 20')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'x'.repeat(30) } });
    expect(onChange).toHaveBeenLastCalledWith('x'.repeat(20), { typing: true });
    rerender(<TextInput question={text({ maxLength: 20 })} value={'x'.repeat(20)} onChange={onChange} />);
    expect(screen.getByText('20 / 20')).toBeInTheDocument();
  });

  test('the default limits: 500 long, 280 short, never above 2000', () => {
    const { unmount } = render(<TextInput question={text({ textLength: 'long', maxLength: null })} value="" onChange={() => {}} />);
    expect(screen.getByText('0 / 500')).toBeInTheDocument();
    unmount();
    const { unmount: u2 } = render(<TextInput question={text({ textLength: 'short', maxLength: undefined })} value="" onChange={() => {}} />);
    expect(screen.getByText('0 / 280')).toBeInTheDocument();
    u2();
    render(<TextInput question={text({ maxLength: 9000 })} value="" onChange={() => {}} />);
    expect(screen.getByText('0 / 2000')).toBeInTheDocument();
  });

  test('leaving the box is a save point', () => {
    const onBlur = jest.fn();
    render(<TextInput question={text()} value="Hi" onChange={() => {}} onBlur={onBlur} />);
    fireEvent.blur(screen.getByRole('textbox', { name: 'Your answer' }));
    expect(onBlur).toHaveBeenCalled();
  });
});

/* ======================================================================= */
describe('surveyAnswers', () => {
  test('isAnswered, per kind', () => {
    expect(isAnswered(rating(), null)).toBe(false);
    expect(isAnswered(rating(), 0)).toBe(true);
    expect(isAnswered(rating(), 4)).toBe(true);
    expect(isAnswered(choice(), [])).toBe(false);
    expect(isAnswered(choice(), [1])).toBe(true);
    expect(isAnswered(choice(), [{ other: 'x' }])).toBe(true);
    expect(isAnswered(yesno(), null)).toBe(false);
    expect(isAnswered(yesno(), { v: 'no' })).toBe(true);
    expect(isAnswered(rank(), [])).toBe(false);
    expect(isAnswered(rank(), [2])).toBe(true);
    expect(isAnswered(text(), '   ')).toBe(false);
    expect(isAnswered(text(), 'words')).toBe(true);
  });

  test('summaryFor reads back what was given, in words', () => {
    expect(summaryFor(rating(), 4)).toBe('4 out of 5');
    expect(summaryFor(rating(), 5)).toBe('5 · Very useful');
    expect(summaryFor(rating({ scale: 'stars' }), 3)).toBe('3 of 5 stars');
    expect(summaryFor(choice(), [0])).toBe('Live demo');
    expect(summaryFor(choice({ allowMultiple: true, allowOther: true }), [1, { other: 'Lunch' }]))
      .toBe('Case studies; something else: “Lunch”');
    expect(summaryFor(yesno(), { v: 'no', why: 'Too long' })).toBe('No — with a note');
    expect(summaryFor(yesno({ unsure: true }), { v: 'unsure' })).toBe('Not sure');
    expect(summaryFor(rank(), [0, 1, 2])).toBe('Customer stories, Product roadmap, Team wins');
    expect(summaryFor(text(), 'Short.')).toBe('“Short.”');
    const long = 'Seeing the console actually run. Every slide about it before that was abstract.';
    expect(summaryFor(text(), long)).toMatch(/^“Seeing the console actually run\. Every slide about it…”$/);
  });

  test('seededOrder is a permutation, the same for the same seed, and different across seeds', () => {
    const a = seededOrder('r_AAAAAAAAAAAAAAAAAAAAAA:c001#003', 6);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(seededOrder('r_AAAAAAAAAAAAAAAAAAAAAA:c001#003', 6)).toEqual(a);
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) seen.add(seededOrder(`r_${i}:c001#003`, 6).join(','));
    expect(seen.size).toBeGreaterThan(1);
  });
});
