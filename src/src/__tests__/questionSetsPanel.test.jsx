/**
 * THE QUESTION SETS LIST — components/QuestionSetsPanel.jsx
 *
 * PURE PROPS, so this file contains ZERO `jest.mock` calls — the same shape as
 * podium.test.jsx, welcomeScreen.test.jsx and adminShell.test.jsx. That is the
 * whole point of the extraction: `AdminPage.jsx` cannot be mounted in jsdom
 * (`useAuth` hard-throws and the only provider is the real Cognito one), so
 * nothing that stays in that file can be asserted at all.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every one of them
 * passes unconditionally.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionSetsPanel, { matchesFilters } from '../components/QuestionSetsPanel';

/** The shape get-question-sets returns, including the rows that have drifted. */
const SETS = [
  {
    id: 'lessons',
    name: 'Q3 Leadership Offsite',
    description: 'Retrospective prompts covering the eighteen months since the merger.',
    engagementType: 'call-and-answer',
    totalQuestions: 42,
    categoryCount: 24,
    active: true,
    quickstart: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  },
  {
    id: 'nakamura',
    name: 'Nakamura Integration — Trivia',
    description: 'Fact recall on the integration timeline.',
    engagementType: 'trivia',
    totalQuestions: 100,
    categoryCount: 24,
    active: true,
    quickstart: true,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-08-06T10:00:00.000Z',
  },
  {
    id: 'values',
    name: 'Engineering Values Check',
    description: 'Where do we actually stand?',
    engagementType: 'survey',
    totalQuestions: 33,
    categoryCount: 4,
    active: true,
    quickstart: false,
    createdAt: '2026-07-21T10:00:00.000Z',
  },
  {
    id: 'security',
    name: 'Security Awareness 2026',
    description: '',
    engagementType: 'trivia',
    totalQuestions: 0,
    categoryCount: 0,
    active: false,
    quickstart: false,
    createdAt: '2026-07-26T10:00:00.000Z',
  },
  {
    // No engagementType stored at all — the legacy rows this table must survive.
    id: 'legacy',
    name: 'Legacy: Lessons Learned (2024)',
    description: 'No engagement type stored.',
    totalQuestions: 47,
    categoryCount: 9,
    active: false,
    quickstart: false,
    createdAt: '2024-11-02T10:00:00.000Z',
  },
];

const mount = (props = {}) => render(<QuestionSetsPanel questionSets={SETS} {...props} />);
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const rowFor = (text) => within(screen.getByRole('table')).getByText(text).closest('tr');
const typeFilter = () => screen.getByRole('combobox', { name: /engagement type/i });
const statusFilter = () => screen.getByRole('combobox', { name: /status/i });
const searchBox = () => screen.getByRole('searchbox', { name: /search/i });

/* --------------------------------------------------------------------- list */

describe('the list', () => {
  test('every set gets a row and the count states both numbers', () => {
    mount();
    expect(rows()).toHaveLength(5);
    expect(screen.getByText('5 sets')).toBeInTheDocument();
  });

  test('a set with no engagementType is still listed', () => {
    // normalizeGameType's documented job is to always return something, and for
    // a SET (unlike a session) that is right: the host's picker filters on the
    // same fallback, so the row must say what the product will do with it.
    // rejects: dropping legacy rows out of the list by filtering on a field
    // that was never written.
    mount();
    expect(within(rowFor('Legacy: Lessons Learned (2024)')).getByText('Call & Answer')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ Q4 + O1 */

describe('the type filter is derived, and Survey is labelled rather than hidden', () => {
  beforeEach(() => mount());

  test('the filter offers every type in the table, Survey included', () => {
    // THE BUG. The shipped filter was four hand-written <option> elements that
    // omitted Survey, while the upload select and the new-set select both
    // offered it — so a survey set existed, could be created, and could not be
    // filtered for. rejects: re-hand-writing the list, and rejects deriving it
    // from PICKER_GAME_TYPES (the host's create dialog), which would hide the
    // survey sets from the one console that can delete them.
    const labels = within(typeFilter())
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels).toEqual([
      'All types',
      'Call & Answer',
      'Trivia',
      'Poll',
      'Wavelength',
      expect.stringContaining('Survey'),
    ]);
  });

  test('the Survey option says it is not playable', () => {
    // The owner's decision on OPEN-QUESTIONS #3 is (c) label it, not (b) hide
    // it. rejects: an unannotated Survey option, which is the state that let
    // someone author a set that can never be played and hear nothing about it.
    expect(
      within(typeFilter()).getByRole('option', { name: /survey/i }).textContent
    ).toMatch(/not playable/i);
  });

  test('a survey row carries a Not playable chip', () => {
    // Mockup 01 row 13 draws exactly this. rejects: a survey set reading as an
    // ordinary row — "real defects, visible".
    expect(within(rowFor('Engineering Values Check')).getByText('Not playable')).toBeInTheDocument();
    expect(within(rowFor('Nakamura Integration — Trivia')).queryByText('Not playable')).toBeNull();
  });

  test('a set that imported zero questions is marked Empty', () => {
    // rejects: a 0 in the Qs column and nothing else. An import that produced
    // no rows is a failure that currently looks like a set.
    expect(within(rowFor('Security Awareness 2026')).getByText('Empty')).toBeInTheDocument();
  });

  test('filtering by Survey finds the survey set', () => {
    // rejects: an option that exists in the select and matches nothing, which
    // is what a raw-string compare against a normalised list would produce.
    fireEvent.change(typeFilter(), { target: { value: 'survey' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Engineering Values Check')).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- Q2, empties */

describe('nothing exists', () => {
  test('the copy does not say "above", because the form is below', () => {
    // THE BUG, verbatim: "No question sets found. Upload your first question
    // set above to get started" — while the upload accordion was rendered BELOW
    // the list and collapsed by default. rejects: restoring that sentence, or
    // any other direction that points at something not on screen.
    render(<QuestionSetsPanel questionSets={[]} loading={false} />);
    expect(screen.getByText(/No question sets yet/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/above/i);
  });

  test('it offers the three ranked creation paths as buttons', () => {
    // Mockup 02: three verbs in the work area, not a grey sentence. rejects: an
    // empty state that describes a way in without providing one.
    const onCreate = jest.fn();
    render(<QuestionSetsPanel questionSets={[]} loading={false} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /generate with ai/i }));
    expect(onCreate).toHaveBeenCalledWith('ai');
    fireEvent.click(screen.getByRole('button', { name: /upload a csv/i }));
    expect(onCreate).toHaveBeenLastCalledWith('csv');
  });

  test('while the list is still loading it says so instead of "none exist"', () => {
    // rejects: an empty state that lies (host §7.9) one level down — the first
    // paint of a console with 41 sets would otherwise offer to create the first.
    render(<QuestionSetsPanel questionSets={[]} loading />);
    expect(screen.getByText(/Loading question sets/i)).toBeInTheDocument();
    expect(screen.queryByText(/No question sets yet/i)).toBeNull();
  });
});

describe('nothing matches, which is a different state with different exits', () => {
  /*
    search "nakamura" (1 set, active, trivia) + type Trivia (2 sets) + status
    Inactive (2 sets) intersect to nothing. Dropping the search leaves the one
    INACTIVE TRIVIA set; dropping the status leaves the one nakamura trivia set;
    dropping the type leaves nothing, because the only nakamura set is active.
    All three cases in one fixture, on purpose.
  */
  const filterToNothing = () => {
    mount();
    fireEvent.change(searchBox(), { target: { value: 'nakamura' } });
    fireEvent.change(typeFilter(), { target: { value: 'trivia' } });
    fireEvent.change(statusFilter(), { target: { value: 'inactive' } });
  };

  test('it counts the result of dropping each filter individually', () => {
    // Mockup 03. rejects: "No question sets found matching your filters" with
    // no exit — the shipped else-branch. Each number is a real pass over the
    // array already in memory, with the OTHER filters still applied, which is
    // what makes it an exit rather than a guess.
    filterToNothing();
    expect(screen.getByText(/No sets match these 3 filters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search “nakamura” — 1 set/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Status: Inactive — 1 set/ })).toBeInTheDocument();
  });

  test('a filter whose removal still yields nothing is not offered as an exit', () => {
    // rejects: offering all three unconditionally, which sends the operator to
    // a second empty screen and teaches them the exits do not work.
    filterToNothing();
    expect(screen.queryByRole('button', { name: /Type: Trivia/ })).toBeNull();
  });

  test('clicking one exit clears exactly that filter and leaves the others', () => {
    // rejects: an exit wired to clearAll, which throws away the two filters the
    // operator meant to keep and is indistinguishable at a glance.
    filterToNothing();
    fireEvent.click(screen.getByRole('button', { name: /Status: Inactive — 1 set/ }));
    expect(statusFilter()).toHaveValue('all');
    expect(searchBox()).toHaveValue('nakamura');
    expect(typeFilter()).toHaveValue('trivia');
    expect(rows()).toHaveLength(1);
  });

  test('clear all filters brings the whole list back', () => {
    filterToNothing();
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(rows()).toHaveLength(5);
  });

  test('"nothing matches" never uses the "nothing exists" copy', () => {
    // rejects: the two empty states collapsing back into one message, which is
    // the defect RATIONALE §10 names on prompts, generation prompts and archive.
    filterToNothing();
    expect(screen.queryByText(/No question sets yet/i)).toBeNull();
  });
});

/* ------------------------------------------------------------- row actions */

describe('the row is where you act on a set', () => {
  test('Edit and Delete hand back the whole set, not an id', () => {
    // rejects: passing `set.id` alone, which is what forced the delete dialog to
    // look the name back up out of the list — the lookup that printed a raw id
    // whenever the list had been refreshed underneath it.
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    mount({ onEdit, onDelete });
    const row = rowFor('Nakamura Integration — Trivia');
    fireEvent.click(within(row).getByRole('button', { name: /^edit$/i }));
    fireEvent.click(within(row).getByRole('button', { name: /^delete$/i }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'nakamura' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'nakamura' }));
  });

  test('the Active chip is a button that reports the set, not the next value', () => {
    const onToggleActive = jest.fn();
    mount({ onToggleActive });
    fireEvent.click(within(rowFor('Security Awareness 2026')).getByRole('button', { name: 'Inactive' }));
    expect(onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'security', active: false }));
  });

  test('Quickstart toggles with the value it is going to', () => {
    // rejects: passing the CURRENT value, which makes the toggle a no-op — the
    // checkbox this replaces read `e.target.checked`, and a chip has no such
    // thing to read.
    const onToggleQuickstart = jest.fn();
    mount({ onToggleQuickstart });
    fireEvent.click(within(rowFor('Nakamura Integration — Trivia')).getByRole('button', { name: /quickstart/i }));
    expect(onToggleQuickstart).toHaveBeenCalledWith(expect.objectContaining({ id: 'nakamura' }), false);
  });
});

/* ------------------------------------------------------------------ banner */

describe('the one banner', () => {
  test('an error notice is an alert and a success notice is not', () => {
    // rejects: a failed toggle rendered in the same tone as a successful save —
    // the complaint that started this whole slice one screen over.
    const { rerender } = render(
      <QuestionSetsPanel questionSets={SETS} notice={{ text: 'Failed to toggle', tone: 'error' }} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to toggle');
    rerender(<QuestionSetsPanel questionSets={SETS} notice={{ text: 'Saved', tone: 'success' }} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});

/* ------------------------------------------------------------ the predicate */

describe('matchesFilters, which the list and the drop-counts share', () => {
  test('the type compare is normalised, so a stored alias still matches', () => {
    // The table holds `callandanswer` and `polls` from the original seeds. The
    // shipped filter compared raw strings — `set.engagementType || 'call-and-
    // answer'` — so those rows fell out of every type filter. rejects: a return
    // to the raw compare.
    expect(matchesFilters({ engagementType: 'callandanswer' }, { type: 'call-and-answer' })).toBe(true);
    expect(matchesFilters({ engagementType: 'polls' }, { type: 'poll' })).toBe(true);
  });

  test('search reaches the custom instruction, as the shipped filter did', () => {
    // Silence in a mockup is not an instruction to delete: mockup 01 draws two
    // search targets and the shipped code searched three. rejects: narrowing
    // the search while porting it.
    expect(
      matchesFilters({ customInstruction: 'answer in one sentence' }, { search: 'one sentence' })
    ).toBe(true);
  });
});
