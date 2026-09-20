/**
 * SEEING WHAT IS ACTUALLY THERE — components/SetShelfBrowse.jsx.
 *
 * The owner asked for two things and they are not the same control: "an easy
 * filter on that" (the Topic select on the bar, setTopicFilter.test.jsx) and
 * "ability to see/search all tags" — which a select cannot do, because a tag
 * vocabulary is open and nobody knows what is in it until they look.
 *
 * So this is the INDEX at the front of the library: every shelf that has sets
 * on it and every word those sets carry, each with its count, each one click
 * from narrowing the list to it.
 *
 * Pure props, ZERO `jest.mock` calls, and no geometric assertions — jsdom has
 * no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SetShelfBrowse from '../components/SetShelfBrowse';
import QuestionSetsPanel from '../components/QuestionSetsPanel';

const SETS = [
  { id: 'rome', name: 'Rome at its Height', topic: 'history', tags: ['ancient', 'empire'], engagementType: 'trivia', totalQuestions: 20, active: true, createdAt: '2026-08-01T10:00:00.000Z' },
  { id: 'cold', name: 'The Cold War Years', topic: 'history', tags: ['1980s', 'empire'], engagementType: 'trivia', totalQuestions: 30, active: true, createdAt: '2026-07-01T10:00:00.000Z' },
  { id: 'ship', name: 'Shipping Safely', topic: 'science-technology', tags: ['onboarding'], engagementType: 'poll', totalQuestions: 12, active: true, createdAt: '2026-06-01T10:00:00.000Z' },
  { id: 'old', name: 'Legacy Offsite Prompts', engagementType: 'poll', totalQuestions: 9, active: true, createdAt: '2026-05-01T10:00:00.000Z' },
];

const mount = (props = {}) => render(<SetShelfBrowse sets={SETS} {...props} />);
const toggle = () => screen.getByRole('button', { name: /browse topics and tags/i });
const open = (props) => { mount(props); fireEvent.click(toggle()); };
const pills = (heading) => {
  const group = screen.getByRole('group', { name: new RegExp(heading, 'i') });
  return within(group).getAllByRole('button').map((button) => button.textContent);
};

describe('it stays out of the way until somebody wants it', () => {
  test('it starts closed and says what is inside before it is opened', () => {
    // rejects: pushing the table down the screen for everyone to serve the
    // minority who are browsing rather than looking for one set they know.
    mount();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('3 topics · 4 tags')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /topics/i })).toBeNull();
  });

  test('opening it shows both halves', () => {
    open();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: /topics/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /tags/i })).toBeInTheDocument();
  });
});

describe('the shelves, and how many sets are on each', () => {
  test('every shelf in use is listed with its count, Unfiled included', () => {
    open();
    expect(pills('topics')).toEqual([
      'History2',
      'Science & Technology1',
      'Unfiled1',
    ]);
  });

  test('a shelf nothing sits on is not offered', () => {
    // rejects: printing all fifteen with zeroes, which offers fourteen dead
    // ends beside one live one and makes the live one harder to see.
    open();
    expect(pills('topics').some((label) => label.includes('Film & TV'))).toBe(false);
  });

  test('choosing a shelf hands the id up', () => {
    const onPickTopic = jest.fn();
    open({ onPickTopic });
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(onPickTopic).toHaveBeenCalledWith('history');
  });

  test('the shelf already being filtered on reads as pressed, and clicking it lets go', () => {
    // rejects: a pill that cannot be un-clicked, so the only way out of a
    // shelf is to find the select again.
    const onPickTopic = jest.fn();
    open({ topic: 'history', onPickTopic });
    const pill = screen.getByRole('button', { name: /History/ });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pill);
    expect(onPickTopic).toHaveBeenCalledWith('all');
  });
});

describe('the tags, which are the half a select cannot do', () => {
  test('every tag in use is listed, most-used first', () => {
    open();
    expect(pills('tags')).toEqual(['empire2', '1980s1', 'ancient1', 'onboarding1']);
  });

  test('choosing a tag hands the word up', () => {
    const onPickTag = jest.fn();
    open({ onPickTag });
    fireEvent.click(screen.getByRole('button', { name: /onboarding/ }));
    expect(onPickTag).toHaveBeenCalledWith('onboarding');
  });

  test('the tag already being searched for reads as pressed, and clicking it lets go', () => {
    const onPickTag = jest.fn();
    open({ search: 'empire', onPickTag });
    const pill = screen.getByRole('button', { name: /empire/ });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pill);
    expect(onPickTag).toHaveBeenCalledWith('');
  });

  test('the find box narrows the tags themselves', () => {
    // "see/search ALL tags" — a library with two hundred words in it is not
    // browsable by scrolling, and the main search box searches SETS, not tags.
    open();
    fireEvent.change(screen.getByRole('searchbox', { name: /find a tag/i }), {
      target: { value: 'emp' },
    });
    expect(pills('tags')).toEqual(['empire2']);
  });

  test('the find box speaks the vocabulary the tags are stored in', () => {
    open();
    fireEvent.change(screen.getByRole('searchbox', { name: /find a tag/i }), {
      target: { value: 'On Boarding' },
    });
    expect(pills('tags')).toEqual(['onboarding1']);
  });
});

describe('the two empty states, which are two different situations', () => {
  test('a library where nobody has tagged anything says so', () => {
    render(<SetShelfBrowse sets={[{ id: 'a', name: 'A', topic: 'history' }]} />);
    fireEvent.click(toggle());
    expect(screen.getByTestId('shelf-browse-no-tags')).toHaveTextContent(/nobody has tagged/i);
    expect(screen.queryByTestId('shelf-browse-no-match')).toBeNull();
  });

  test('tags that exist but do not match the box say something else, and offer the way back', () => {
    // rejects: one grey sentence for both — "no tags" when there are four of
    // them and the box is simply misspelt is the empty state that lies.
    open();
    fireEvent.change(screen.getByRole('searchbox', { name: /find a tag/i }), {
      target: { value: 'zzz' },
    });
    expect(screen.queryByTestId('shelf-browse-no-tags')).toBeNull();
    const nomatch = screen.getByTestId('shelf-browse-no-match');
    expect(nomatch).toHaveTextContent(/zzz/);
    expect(nomatch).toHaveTextContent(/4 tags/);

    fireEvent.click(within(nomatch).getByRole('button', { name: /show all 4/i }));
    expect(pills('tags')).toHaveLength(4);
  });

  test('a library with no sets in it renders no browse at all', () => {
    const { container } = render(<SetShelfBrowse sets={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('wired into the list it describes', () => {
  const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
  const names = () =>
    rows().map((row) => within(row).getAllByRole('cell')[0].firstElementChild.textContent);

  test('clicking a shelf narrows the table under it', () => {
    render(<QuestionSetsPanel questionSets={SETS} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^History — 2 sets$/ }));
    expect(names()).toEqual(['Rome at its Height', 'The Cold War Years']);
    expect(screen.getByRole('combobox', { name: /filter by topic/i })).toHaveValue('history');
  });

  test('clicking a tag narrows the table under it, and shows in the search box', () => {
    // The tag goes into the SEARCH, not into a filter of its own: it is then
    // visible, clearable, and carries the same drop-exit every other search
    // does when it matches nothing.
    render(<QuestionSetsPanel questionSets={SETS} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^onboarding — 1 set$/ }));
    expect(names()).toEqual(['Shipping Safely']);
    expect(screen.getByRole('searchbox', { name: /search name, description/i })).toHaveValue('onboarding');
  });

  test('it is still there when nothing matches, because it is an exit too', () => {
    // rejects: hiding the browse inside the table branch, which takes the one
    // control that shows what DOES exist off the screen that needs it most.
    render(<QuestionSetsPanel questionSets={SETS} />);
    fireEvent.change(screen.getByRole('searchbox', { name: /search name, description/i }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No sets match this filter/i)).toBeInTheDocument();
    expect(toggle()).toBeInTheDocument();
  });
});
