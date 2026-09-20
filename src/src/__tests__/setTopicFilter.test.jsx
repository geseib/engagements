/**
 * FILTERING A LIBRARY BY THE SHELF A SET SITS ON — the owner's "easy filter on
 * that", on the two lists that have one: an organisation's own sets
 * (AdminPage → QuestionSetsPanel) and the public library (PublicLibraryPanel,
 * which renders the same table).
 *
 * IN ITS OWN FILE rather than appended to questionSetsPanel.test.jsx, which is
 * already 465 lines about a different subject and is being edited elsewhere.
 * Same shape as that file: pure props, ZERO `jest.mock` calls, and no
 * geometric assertions — jsdom has no layout engine, so every width passes
 * unconditionally.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionSetsPanel from '../components/QuestionSetsPanel';
import PublicLibraryPanel from '../components/PublicLibraryPanel';
import { SET_TOPIC_IDS, SET_TOPICS, UNFILED_LABEL } from '../config/setTopics';

/**
 * The shape get-question-sets projects, `topic` RAW. Two of these five are the
 * rows this feature must not break: `old` predates the field entirely and
 * `junk` carries a shelf nothing recognises. Both are Unfiled, and both must
 * go on listing.
 */
const SETS = [
  {
    id: 'rome',
    name: 'Rome at its Height',
    description: 'The republic, the empire and the fall.',
    topic: 'history',
    tags: ['ancient', 'empire'],
    engagementType: 'trivia',
    totalQuestions: 20,
    active: true,
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'cold',
    name: 'The Cold War Years',
    description: 'Two blocs, forty years.',
    topic: 'history',
    tags: ['1980s'],
    engagementType: 'trivia',
    totalQuestions: 30,
    active: true,
    createdAt: '2026-07-01T10:00:00.000Z',
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
    createdAt: '2026-06-01T10:00:00.000Z',
  },
  {
    id: 'old',
    name: 'Legacy Offsite Prompts',
    description: 'Written before the shelf existed.',
    engagementType: 'poll',
    totalQuestions: 9,
    active: true,
    createdAt: '2026-05-01T10:00:00.000Z',
  },
  {
    id: 'junk',
    name: 'Drifted Row',
    description: 'Stored shelf is not one of the fifteen.',
    topic: 'not-a-shelf',
    engagementType: 'poll',
    totalQuestions: 4,
    active: true,
    createdAt: '2026-04-01T10:00:00.000Z',
  },
];

const mount = (props = {}) => render(<QuestionSetsPanel questionSets={SETS} {...props} />);
const topicFilter = () => screen.getByRole('combobox', { name: /filter by topic/i });
const searchBox = () => screen.getByRole('searchbox', { name: /search name, description/i });
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
/** The set NAME on each row. The first cell also carries the publisher-and-blurb
 *  sub-line, so this reads the name span rather than the whole cell. */
const names = () =>
  rows().map((row) => within(row).getAllByRole('cell')[0].firstElementChild.textContent);

/**
 * Choose a shelf BY THE LABEL A PERSON READS, and drive the control with that
 * option's own value.
 *
 * Not decoration. `fireEvent.change(select, { target: { value: x } })` does not
 * consult the options at all: when nothing matches, jsdom parks the select on
 * value '' with selectedIndex -1, so React's handler receives '' either way.
 * Unfiled's value IS '' — so driving it by its literal value passed with the
 * option deleted from the control, and the backlog of sets that predate the
 * field became unreachable with this suite green. `getByRole` throws when the
 * option is gone, which is the whole point.
 */
const chooseTopic = (label) => {
  const select = topicFilter();
  const option = within(select).getByRole('option', { name: label });
  fireEvent.change(select, { target: { value: option.value } });
};

describe('the shelf is a filter, on the same bar as the others', () => {
  test('it offers all fifteen shelves, not only the ones in use', () => {
    // The select is the VOCABULARY — a person filtering has to be able to see
    // what the fifteen are. What is actually on the shelves, with counts, is
    // the browse's job (SetShelfBrowse).
    //
    // The WHOLE list is pinned, not just the fifteen, because the two ends
    // carry the sentinels: All topics is the way back out and Unfiled is the
    // only route to the sets that predate the field. Neither comes from
    // SET_TOPIC_IDS, so a loop over the fifteen alone lets either be deleted
    // with this suite green. Adding a sixteenth shelf to the module updates
    // this expectation on its own.
    mount();
    const labels = within(topicFilter()).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([
      'All topics',
      ...SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label),
      UNFILED_LABEL,
    ]);
  });

  test('choosing a shelf narrows the list to the sets on it', () => {
    mount();
    fireEvent.change(topicFilter(), { target: { value: 'history' } });
    expect(names()).toEqual(['Rome at its Height', 'The Cold War Years']);
  });

  test('Unfiled is reachable, and finds the sets that predate the field', () => {
    // E2: around forty live sets are on no shelf. They must be findable AS
    // that — a filter that can only name the fifteen makes the backlog
    // invisible. rejects: leaving Unfiled out of the options — which it now
    // genuinely does, because `chooseTopic` reaches the option by its label
    // instead of assuming the value it would carry.
    mount();
    chooseTopic(UNFILED_LABEL);
    expect(names()).toEqual(['Legacy Offsite Prompts', 'Drifted Row']);
  });

  test('a set whose stored shelf is not one of the fifteen reads as Unfiled', () => {
    // rejects: filtering on the raw stored string, which would hide `junk`
    // from every option including Unfiled — a row nothing can reach.
    mount();
    chooseTopic(UNFILED_LABEL);
    expect(names()).toContain('Drifted Row');
  });

  test('the count line says how much of the library is showing', () => {
    mount();
    fireEvent.change(topicFilter(), { target: { value: 'history' } });
    expect(screen.getByText('5 sets · 2 shown')).toBeInTheDocument();
  });
});

describe('a tag is something you can search for', () => {
  test('the box says it reads tags, because it does', () => {
    // rejects: a control that promises less than it delivers. The owner's ask
    // was "ability to see/search all tags", and a box that reads them while
    // naming only the name and description hides the feature from the one
    // person it was built for — there is nothing on the screen to suggest
    // typing a word somebody tagged would find anything.
    //
    // Both halves, because they are read by different people: the placeholder
    // is what a sighted person sees in the empty box, the aria-label is the
    // whole of what a screen reader announces.
    mount();
    expect(searchBox()).toHaveAttribute('placeholder', 'Search name, description, tags');
    expect(searchBox()).toHaveAttribute('aria-label', 'Search name, description, tags');
  });

  test('searching a tag finds the sets carrying it', () => {
    // The set's own tags join name/description/customInstruction in the search
    // haystack. rejects: tags that can be written and never found again.
    mount();
    fireEvent.change(searchBox(), { target: { value: '1980s' } });
    expect(names()).toEqual(['The Cold War Years']);
  });

  test('searching one tag does not drag in every set that has tags', () => {
    // rejects: folding the whole list into the haystack in a way that matches
    // any tagged row — the search has to be about the word, not about having
    // words.
    mount();
    fireEvent.change(searchBox(), { target: { value: 'empire' } });
    expect(names()).toEqual(['Rome at its Height']);
  });
});

describe('the two empty states stay two different states', () => {
  test('nothing matches names the shelf as one of the exits, with its count', () => {
    // Search `rome` (1 set, on History) + shelf Science & Technology (1 set)
    // intersect to nothing. Dropping the shelf leaves Rome; dropping the search
    // leaves Shipping Safely. Both are real exits, so both are offered.
    mount();
    fireEvent.change(searchBox(), { target: { value: 'rome' } });
    fireEvent.change(topicFilter(), { target: { value: 'science-technology' } });
    expect(screen.getByText(/No sets match these 2 filters/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Topic: Science & Technology — 1 set/ })
    ).toBeInTheDocument();
  });

  test('taking the shelf exit clears the shelf and keeps the search', () => {
    mount();
    fireEvent.change(searchBox(), { target: { value: 'rome' } });
    fireEvent.change(topicFilter(), { target: { value: 'science-technology' } });
    fireEvent.click(screen.getByRole('button', { name: /Topic: Science & Technology — 1 set/ }));
    expect(topicFilter()).toHaveValue('all');
    expect(searchBox()).toHaveValue('rome');
    expect(names()).toEqual(['Rome at its Height']);
  });

  test('an empty library says nothing exists, and offers no shelf filter at all', () => {
    // rejects: a bar of filters over a library with nothing in it — "no sets
    // match these filters" when in truth there are no sets.
    render(<QuestionSetsPanel questionSets={[]} />);
    expect(screen.getByText(/No question sets yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /filter by topic/i })).toBeNull();
  });
});

describe('the filter is the screen’s, not the fetch’s', () => {
  test('it survives the list reloading underneath it', () => {
    // A poll, a save, a copy — every one of them hands this panel a NEW array.
    // rejects: keying the filter state off the items, or lifting it into a
    // parent that rebuilds it on each fetch, which silently resets the shelf
    // the moment anything refreshes.
    const { rerender } = mount();
    fireEvent.change(topicFilter(), { target: { value: 'history' } });
    expect(names()).toHaveLength(2);

    const reloaded = [
      ...SETS.map((set) => ({ ...set })),
      {
        id: 'new',
        name: 'Byzantium',
        topic: 'history',
        engagementType: 'trivia',
        totalQuestions: 7,
        active: true,
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ];
    rerender(<QuestionSetsPanel questionSets={reloaded} />);

    expect(topicFilter()).toHaveValue('history');
    expect(names()).toEqual(['Byzantium', 'Rome at its Height', 'The Cold War Years']);
  });
});

describe('the public library filters by shelf too', () => {
  /*
    PublicLibraryPanel renders QuestionSetsPanel, so this is the same control
    on the other list — asserted here rather than assumed, because the panel
    filters its rows to the public scope first and a projection that dropped
    `topic` on the way through would leave the filter matching nothing.
  */
  const PUBLIC = SETS.map((set) => ({ ...set, scope: 'public' }));

  test('choosing a shelf narrows what the public library shows', () => {
    render(<PublicLibraryPanel questionSets={PUBLIC} />);
    fireEvent.change(topicFilter(), { target: { value: 'history' } });
    expect(names()).toEqual(['Rome at its Height', 'The Cold War Years']);
  });

  test('searching a tag narrows it too', () => {
    render(<PublicLibraryPanel questionSets={PUBLIC} />);
    fireEvent.change(searchBox(), { target: { value: 'onboarding' } });
    expect(names()).toEqual(['Shipping Safely']);
  });
});
