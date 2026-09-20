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
import { tagIndex } from '../config/setShelfIndex';

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

  test('the tag already being filtered on reads as pressed, and clicking it lets go', () => {
    const onPickTag = jest.fn();
    open({ tag: 'empire', onPickTag });
    // By the pill's whole name: the summary beside the toggle names the tag in
    // force too, so a bare /empire/ now matches two controls — which is the
    // point of that summary, and no reason for this test to address the wrong
    // one of them.
    const pill = screen.getByRole('button', { name: /^empire — / });
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

  test('clicking a tag narrows the table under it, and says so where it can still be seen', () => {
    // The tag is a FILTER OF ITS OWN, not a phrase dropped into the search
    // box — see the count-and-click block at the foot of this file for why.
    // What the search box gave it for free was visibility, so the summary
    // beside the toggle carries that instead: it is outside the disclosure,
    // so the filter in force is readable and releasable with the browse shut.
    render(<QuestionSetsPanel questionSets={SETS} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^onboarding — 1 set$/ }));
    expect(names()).toEqual(['Shipping Safely']);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    const release = screen.getByRole('button', { name: /clear the tag onboarding/i });
    fireEvent.click(release);
    expect(names()).toHaveLength(SETS.length);
  });

  test('a tag that matches nothing beside another filter is offered as an exit', () => {
    // `onboarding` is on the one Science & Technology set, so asking for it on
    // the History shelf intersects to nothing. rejects: an axis wired into the
    // predicate and left out of `computeDrops`, which is a dead end whose only
    // way back is a filter the screen never names.
    render(<QuestionSetsPanel questionSets={SETS} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^onboarding — 1 set$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^History — 2 sets$/ }));
    expect(screen.getByText(/No sets match these 2 filters/i)).toBeInTheDocument();
    // The label names the filter being dropped; the count is what dropping it
    // leaves, which is the two History sets.
    fireEvent.click(screen.getByRole('button', { name: /Tag: onboarding — 2 sets/ }));
    expect(names()).toEqual(['Rome at its Height', 'The Cold War Years']);
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

describe('the number on a tag is the number of rows clicking it produces', () => {
  /*
    THE MODULE'S OWN PROMISE, KEPT. config/setShelfIndex.js says it in one
    line — "the number beside a tag has to be the number of rows clicking it
    produces" — and for a while it was not true, because the two halves were
    computed by two different rules. The pill counted SETS CARRYING THE TAG.
    The click wrote the word into the free-text search, which OR-matches a
    substring across a set's name, description, custom instruction AND tags.

    So the number was routinely LOWER than the rows it produced, in two ways
    that have nothing to do with each other and so are both fixtured below:

      - a set that merely SAYS the word ("The British Empire") came back with
        the rows and was never in the count;
      - a LONGER tag containing a shorter one (`ancient-egypt` under
        `ancient`) did the same.

    A count that disagrees with its own result is worse than no count: it
    teaches people the filter is approximate, and then they stop reading any
    of the numbers on the screen.
  */
  const MIXED = [
    {
      id: 'rome',
      name: 'Rome at its Height',
      description: 'The republic, the empire and the fall.',
      topic: 'history',
      tags: ['empire', 'ancient'],
      engagementType: 'trivia',
      totalQuestions: 20,
      active: true,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
    {
      id: 'brit',
      name: 'The British Empire',
      description: 'It says the word and carries none of it.',
      topic: 'history',
      tags: ['1980s'],
      engagementType: 'trivia',
      totalQuestions: 12,
      active: true,
      createdAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'egypt',
      name: 'Along the Nile',
      description: 'A longer tag that begins with a shorter one.',
      topic: 'history',
      tags: ['ancient-egypt'],
      engagementType: 'trivia',
      totalQuestions: 8,
      active: true,
      createdAt: '2026-06-01T10:00:00.000Z',
    },
    {
      id: 'ship',
      name: 'Shipping Safely',
      description: 'How a change reaches production.',
      topic: 'science-technology',
      tags: ['onboarding'],
      engagementType: 'poll',
      totalQuestions: 12,
      active: true,
      createdAt: '2026-05-01T10:00:00.000Z',
    },
  ];

  const mixedRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
  const mixedNames = () =>
    mixedRows().map((row) => within(row).getAllByRole('cell')[0].firstElementChild.textContent);

  test('every tag pill produces exactly the rows it counted', () => {
    // EVERY pill, not one: the two ways the promise broke are unrelated, and
    // a single case pins only whichever one it happens to be. This is the
    // assertion that fails if the count and the click are ever computed by
    // two rules again.
    for (const entry of tagIndex(MIXED)) {
      const view = render(<QuestionSetsPanel questionSets={MIXED} />);
      fireEvent.click(toggle());
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${entry.tag} — `) }));
      expect(mixedRows()).toHaveLength(entry.count);
      view.unmount();
    }
  });

  test('a set that only says the word in its name is neither counted nor produced', () => {
    render(<QuestionSetsPanel questionSets={MIXED} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^empire — 1 set$/ }));
    expect(mixedNames()).toEqual(['Rome at its Height']);
  });

  test('a longer tag is not dragged in by the shorter one it begins with', () => {
    render(<QuestionSetsPanel questionSets={MIXED} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^ancient — 1 set$/ }));
    expect(mixedNames()).toEqual(['Rome at its Height']);
  });

  test('the search box still finds every set that says the word, and still says so', () => {
    // The two controls answer two different questions and both stay honest:
    // the box is a find-anything, and its label names the tags it reads
    // (setTopicFilter.test.jsx); the pill is one exact tag with an exact
    // count. rejects: fixing the pill by taking tags out of the search, which
    // would undo the owner's ask rather than deliver it.
    render(<QuestionSetsPanel questionSets={MIXED} />);
    fireEvent.change(screen.getByRole('searchbox', { name: /search name, description/i }), {
      target: { value: 'empire' },
    });
    expect(mixedNames()).toEqual(['Rome at its Height', 'The British Empire']);
  });
});
