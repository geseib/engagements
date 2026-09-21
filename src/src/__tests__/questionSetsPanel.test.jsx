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

  /*
    THE SAME RULE, ONE STATE FURTHER IN. The header button was gated on its
    handler; these three were left rendering behind `onCreate && onCreate('ai')`
    — the identical short-circuit, on the identical filled primary, in the state
    where a person is pressing hardest because there is nothing else on screen.

    This is the component's contract, not a screen's: a caller with no creation
    path mounts this table today (PublicLibraryPanel, with `rowActions` and no
    `onCreate`), and that caller happens to intercept its own empty case with
    its own copy before this state is reached. "Unreachable through one caller
    today" is not the same as "cannot render dead controls", and it is the
    second half of the owner's report either way.
  */
  test('the three creation paths are not drawn when no caller can honour them', () => {
    render(<QuestionSetsPanel questionSets={[]} loading={false} />);
    expect(screen.queryByRole('button', { name: /generate with ai/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /upload a csv/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /start from a template/i })).toBeNull();
  });

  test('and what is left still says what the thing is, without naming a way in that is not there', () => {
    // rejects: deleting the empty state along with its buttons (design rule 6 —
    // the reader still has to be told there is nothing here), and rejects
    // keeping the sentence that promises three ways to make the first one when
    // none of the three is on screen (rule 2, one sentence further down).
    render(<QuestionSetsPanel questionSets={[]} loading={false} />);
    expect(screen.getByText(/No question sets yet/i)).toBeInTheDocument();
    expect(screen.getByText(/A question set is what a session plays/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/three ways/i);
  });

  /*
    THE HEADER'S "New set" IS AN AFFORDANCE FOR `onCreate`, AND NOTHING ELSE.

    Reported by the owner against the Public library, which mounts this table
    with `rowActions` and no `onCreate`: the button rendered as a filled primary
    on every visit and did precisely nothing when pressed, because its handler
    is `onCreate && onCreate('new')`. Design rule 2 — "a dead X is the control
    people reach for first, so gate the affordance on the handler existing,
    never render one that does nothing".
  */
  test('the header button is not drawn at all when there is no creation path to take', () => {
    render(<QuestionSetsPanel questionSets={SETS} loading={false} />);
    expect(screen.queryByRole('button', { name: /new set/i })).toBeNull();
  });

  test('and it is drawn, and works, the moment a caller can honour it', () => {
    const onCreate = jest.fn();
    render(<QuestionSetsPanel questionSets={SETS} loading={false} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /new set/i }));
    expect(onCreate).toHaveBeenCalledWith('new');
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

/* ------------------------------------------------------------------- owner */

describe('the Owner filter and sort — yours and your team\'s vs Engage and shared', () => {
  const OWNED = [
    { id: 'pub', name: 'Zebra Public', scope: 'public', active: true, engagementType: 'poll', createdAt: '2026-08-04T00:00:00Z' },
    { id: 'eng', name: 'Alpha Engage', scope: 'platform', active: true, engagementType: 'poll', createdAt: '2026-08-03T00:00:00Z' },
    { id: 'tm', name: 'Mid Team', scope: 'org', mine: false, active: true, engagementType: 'poll', createdAt: '2026-08-02T00:00:00Z' },
    { id: 'me', name: 'Yours Truly', scope: 'org', mine: true, active: true, engagementType: 'poll', createdAt: '2026-08-01T00:00:00Z' },
  ];
  const ownerFilter = () => screen.getByRole('combobox', { name: /owner/i });
  const sortSelect = () => screen.getByRole('combobox', { name: /sort/i });
  const names = () => rows().map((r) => within(r).getAllByRole('cell')[0].textContent);

  // rejects: THE REQUEST — no way to narrow the list to whose sets they are.
  test('there is an Owner filter offering all four owners', () => {
    render(<QuestionSetsPanel questionSets={OWNED} />);
    const labels = within(ownerFilter()).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['All owners', 'Yours', 'Team', 'Engage', 'Public']);
  });

  test('choosing Engage shows only Engage\'s library', () => {
    render(<QuestionSetsPanel questionSets={OWNED} />);
    fireEvent.change(ownerFilter(), { target: { value: 'engage' } });
    expect(rows()).toHaveLength(1);
    expect(names()[0]).toMatch(/Alpha Engage/);
  });

  test('choosing Team shows the team\'s sets but not your own', () => {
    render(<QuestionSetsPanel questionSets={OWNED} />);
    fireEvent.change(ownerFilter(), { target: { value: 'team' } });
    expect(rows()).toHaveLength(1);
    expect(names()[0]).toMatch(/Mid Team/);
  });

  // rejects: THE REQUEST, second half — a sort that ignores ownership.
  test('the Owner sort puts yours and your team\'s first, the shared library last', () => {
    render(<QuestionSetsPanel questionSets={OWNED} />);
    fireEvent.change(sortSelect(), { target: { value: 'owner' } });
    // Map each rendered row back to the fixture whose name it carries, rather
    // than parsing cell text: the cell also renders a placeholder dash and the
    // owner chip, and a test that strips those by regex is testing the markup,
    // not the order. (The first draft did exactly that and failed on the dash
    // while the sort itself was already right.)
    const order = rows().map((r) => OWNED.find((set) => r.textContent.includes(set.name)).name);
    expect(order).toEqual(['Yours Truly', 'Mid Team', 'Alpha Engage', 'Zebra Public']);
  });

  // rejects: the filter living only in the UI, so the drop-exit counts and the
  // list could disagree. matchesFilters is the predicate both share.
  test('matchesFilters honours owner, the predicate the counts share', () => {
    expect(matchesFilters(OWNED[1], { owner: 'engage' })).toBe(true);
    expect(matchesFilters(OWNED[3], { owner: 'engage' })).toBe(false);
    expect(matchesFilters(OWNED[3], { owner: 'yours' })).toBe(true);
  });
});

describe('who can see it', () => {
  const NOW = Date.parse('2026-09-17T10:20:00.000Z');
  const VIS = [
    { ...SETS[0], id: 'priv', name: 'Private one', canManage: true },
    { ...SETS[0], id: 'pub', name: 'Public one', canManage: true, activeVersion: 2, share: { status: 'published', version: 2, publicVersion: 1, at: '2026-09-17T09:00:00.000Z' } },
    { ...SETS[0], id: 'flag', name: 'Flagged one', canManage: true, share: { status: 'flagged', version: 2, at: '2026-09-17T09:00:00.000Z' } },
    { ...SETS[0], id: 'engage', name: 'Engage one', canManage: false, scope: 'platform' },
  ];
  beforeAll(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterAll(() => { Date.now.mockRestore(); });
  test('the column is absent unless the console asks for it', () => {
    mount({ questionSets: VIS });
    expect(screen.queryByRole('columnheader', { name: /who can see it/i })).toBeNull();
    expect(screen.queryByText('Needs changes')).toBeNull();
    expect(screen.getByRole('table')).not.toHaveClass('qsets-tbl--vis');
  });
  /*
    THE THREE THINGS THE OWNER COULD NOT TELL APART, ON ONE SCREEN.

    An org console's list carries this organisation's rows, Engage's and the
    public library's (get-question-sets.js readableScopes), so a set that has
    been shared and the public COPY of it are two rows in the same table — and
    both used to read "Public". The three rows below are exactly that: the set
    you shared, the copy that is out there, and the set that has moved on since.
  */
  const THREE = [
    { ...SETS[0], id: 'ours', name: 'Ours shared', canManage: true, scope: 'org', activeVersion: 2, share: { status: 'published', version: 2, publicSetId: 'orgacme-ours', publicVersion: 1, at: '2026-09-17T09:00:00.000Z' } },
    { ...SETS[0], id: 'theirs', name: 'Theirs public', canManage: false, scope: 'public', activeVersion: 1 },
    { ...SETS[0], id: 'stale', name: 'Ours moved on', canManage: true, scope: 'org', activeVersion: 3, share: { status: 'published', version: 2, publicSetId: 'orgacme-stale', publicVersion: 1, at: '2026-09-17T09:00:00.000Z' } },
  ];
  /* The "Who can see it" cell of a row, and only that cell. The State cell
     carries the OWNER chip, which answers a different question with some of the
     same words — a public row is owned by somebody else AND visible to
     everybody, so both of its chips read "Public" and a row-wide query cannot
     say which one it found. */
  const visOf = (name) => rowFor(name).querySelector('.qsets-vis');

  test('what you did, what it is, and what has drifted are three different words', () => {
    mount({ questionSets: THREE, showVisibility: true });
    expect(visOf('Ours shared')).toHaveTextContent(/^Shared v2$/);
    expect(visOf('Theirs public')).toHaveTextContent(/^Public$/);
    expect(visOf('Ours moved on')).toHaveTextContent(/^Shared v2, yours is v3$/);
    // …and not each other's. rejects: one state's words leaking onto a row in
    // another state, which is the whole defect.
    expect(visOf('Ours shared')).not.toHaveTextContent(/yours is v/);
    expect(visOf('Theirs public')).not.toHaveTextContent(/Shared/);
  });
  test('the drifted one carries its own colour and the sentence that says what to press', () => {
    mount({ questionSets: THREE, showVisibility: true, onShare: jest.fn() });
    const stale = within(visOf('Ours moved on')).getByText(/yours is v3/);
    expect(stale).toHaveClass('qsets-chip--vis-behind');
    expect(stale).toHaveAttribute('title', 'An older version is shared. Click Share to share the latest version.');
    // The two settled states share neither the class nor the sentence.
    expect(within(visOf('Ours shared')).getByText(/^Shared v2$/)).toHaveClass('qsets-chip--vis-shared');
    expect(within(visOf('Theirs public')).getByText(/^Public$/)).toHaveClass('qsets-chip--vis-public');
  });
  test('and the exit the hover names is on the same row', () => {
    // rejects: telling somebody to "click Share" from a row that has no Share.
    mount({ questionSets: THREE, showVisibility: true, onShare: jest.fn() });
    expect(within(rowFor('Ours moved on')).getByRole('button', { name: /^share$/i })).toBeInTheDocument();
  });
  /*
    …AND WHEN IT IS NOT, THE SENTENCE IS NOT EITHER.

    "Click Share to share the latest version" was written unconditionally, and
    this table draws the Share action only when the caller passed `onShare` AND
    the server said `canManage` for that row. Both cases are ordinary on the org
    console: a host sees a colleague's set with `canManage: false`
    (admin/shared/question-set-access.js — "a host may edit or delete ONLY the
    ones they created"), and the same drift chip renders there beside an Open
    button. Naming an exit that is not on the surface is the defect the header
    button's ruling exists to prevent, one attribute down.
  */
  test('a row whose Share this caller never passed is told the fact without the instruction', () => {
    mount({ questionSets: THREE, showVisibility: true });
    expect(within(rowFor('Ours moved on')).queryByRole('button', { name: /^share$/i })).toBeNull();
    const stale = within(visOf('Ours moved on')).getByText(/yours is v3/);
    expect(stale).toHaveAttribute('title', expect.stringMatching(/an older version is shared/i));
    expect(stale).toHaveAttribute('title', expect.not.stringMatching(/click share/i));
  });
  test("and neither is a colleague's set this reader may not manage, on a console that does have Share", () => {
    const theirs = { ...THREE[2], id: 'colleague', name: 'A colleague’s set', canManage: false };
    mount({ questionSets: [...THREE, theirs], showVisibility: true, onShare: jest.fn() });
    expect(within(rowFor('A colleague’s set')).queryByRole('button', { name: /^share$/i })).toBeNull();
    expect(within(visOf('A colleague’s set')).getByText(/yours is v3/))
      .toHaveAttribute('title', expect.not.stringMatching(/click share/i));
    // …while the row on the same screen that DOES have the button keeps the words.
    expect(within(visOf('Ours moved on')).getByText(/yours is v3/))
      .toHaveAttribute('title', expect.stringMatching(/click share/i));
  });
  test('each row says who can see it, from the share stamp', () => {
    mount({ questionSets: VIS, showVisibility: true });
    expect(screen.getByRole('columnheader', { name: /who can see it/i })).toBeInTheDocument();
    expect(within(rowFor('Private one')).getByText('Private')).toBeInTheDocument();
    expect(within(rowFor('Public one')).getByText('Shared v2')).toBeInTheDocument();
    expect(within(rowFor('Flagged one')).getByText('Needs changes')).toHaveAttribute('title', expect.stringMatching(/what was flagged/));
    // An Engage-library (platform-scope) row carries no share stamp of its
    // own — it is not Private just because nobody has shared FROM it.
    expect(within(rowFor('Engage one')).getByText('Everyone')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveClass('qsets-tbl--vis');
  });
  test('Share is offered on rows you manage, and calls back with the set', () => {
    const onShare = jest.fn();
    mount({ questionSets: VIS, showVisibility: true, onShare });
    fireEvent.click(within(rowFor('Private one')).getByRole('button', { name: /^share$/i }));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ id: 'priv' }));
    expect(within(rowFor('Engage one')).queryByRole('button', { name: /^share$/i })).toBeNull();
  });
  test('without onShare there is no Share button, even with the column', () => {
    mount({ questionSets: VIS, showVisibility: true });
    expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
  });
});

describe('rowActions', () => {
  /*
    RULING R20 amends this test's second half.

    It used to read the publisher off the owner chip's `title`, which is a
    HOVER — unreachable on the tablets this console is read on, and invisible
    to anyone scanning the list. And the chip lives in the State cell, which a
    rowActions caller no longer gets at all: the Active and Quickstart chips
    beside it are BUTTONS wired to `onToggleActive` / `onToggleQuickstart`, and
    a caller that replaces the row's actions passes neither, so both rendered
    as live controls that did nothing when clicked.

    `docs/design/tenancy-redesign/07-public-library.html` is the authority and
    prints the publisher as a visible sub-line. So that is what is asserted
    now. The chip and its title are untouched everywhere the column still
    renders — the two tests in `the owner chip` below still read them.
  */
  test('a caller can replace the row actions, and the publisher is visible text', () => {
    const rows = [{ ...SETS[0], id: 'pub', name: 'Public one', canManage: false, scope: 'public', sourceOrgName: 'Meridian Delivery' }];
    mount({ questionSets: rows, rowActions: (set) => <button type="button">Do {set.id}</button> });
    expect(screen.getByRole('button', { name: 'Do pub' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^open$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^copy$/i })).toBeNull();
    expect(within(rowFor('Public one')).getByText(/by Meridian Delivery/)).toBeInTheDocument();
  });

  // rejects: the State column surviving into a screen that cannot honour it.
  //          A control that is always inert reads as a broken product rather
  //          than as a boundary — the same argument the actions column's own
  //          comment makes about Edit on a set you cannot manage.
  test('and the State column goes with them — header and cell', () => {
    const rows = [{ ...SETS[0], id: 'pub', name: 'Public one', canManage: false, scope: 'public' }];
    mount({ questionSets: rows, rowActions: () => <button type="button">Do it</button> });
    expect(screen.queryByRole('columnheader', { name: /^state$/i })).toBeNull();
    expect(within(rowFor('Public one')).queryByRole('button', { name: /^active$|^inactive$/i })).toBeNull();
    expect(within(rowFor('Public one')).queryByRole('button', { name: /quickstart/i })).toBeNull();
  });

  // rejects: removing the column for everyone. The org console's own list is
  //          where those toggles work, and it passes no rowActions.
  test('but the ordinary list keeps it', () => {
    mount({});
    expect(screen.getByRole('columnheader', { name: /^state$/i })).toBeInTheDocument();
  });
});

/* ------------------------------------------------- a row that cannot be read */

describe('a set whose content could not be decrypted', () => {
  /*
    THIS ROW IS NEW, AND SO IS THE STATE IT DESCRIBES. Until admin/get-question-
    sets.js learned to degrade per row, one unreadable ciphertext threw out of
    the handler's Promise.all and the whole response was a 500 — so this shape
    reached the client exactly never, and the panel had no rendering for it.

    What arrives now: every encrypted field nulled (never the raw envelope, never
    a fabricated title) and `decryptFailed` saying why. The panel's job is to
    keep those two facts distinguishable — "nobody named this" and "nobody can
    read this" are different situations with different owners.
  */
  const UNREADABLE = {
    id: 'q3retro',
    name: null,
    description: null,
    engagementType: 'call-and-answer',
    totalQuestions: 42,
    categoryCount: 6,
    active: true,
    quickstart: false,
    decryptFailed: true,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  };
  const mountWithUnreadable = () =>
    render(<QuestionSetsPanel questionSets={[...SETS, UNREADABLE]} />);

  // rejects: rendering `set.name` straight through. A nulled name is an empty
  // cell, which cannot be told from a row that failed to render and gives
  // nobody anything to quote when they report it. The set id was never
  // encrypted — it is half the key — so it is the one handle left.
  test('the row is still identifiable, by the one field that was never encrypted', () => {
    mountWithUnreadable();
    expect(screen.getByText('q3retro')).toBeInTheDocument();
  });

  // rejects: letting it pass as an ordinary row. Every other column still
  // renders — 42 questions, Active, Call & Answer — so without a marker the row
  // reads as a healthy set that someone forgot to name.
  test('it is marked unreadable, not left looking like an ordinary set', () => {
    mountWithUnreadable();
    const row = screen.getByText('q3retro').closest('tr');
    expect(within(row).getByText(/unreadable/i)).toBeInTheDocument();
  });

  // rejects: a bare chip. "A reduction with no recovery is a deletion" — the
  // word alone tells a host nothing about whether they broke it, whether it is
  // coming back, or whether they should stop trying to use it.
  test('the marker carries its explanation, because the word alone is not an action', () => {
    mountWithUnreadable();
    const row = screen.getByText('q3retro').closest('tr');
    const chip = within(row).getByText(/unreadable/i);
    expect(chip).toHaveAttribute('title', expect.stringMatching(/decrypt/i));
  });

  // rejects: reusing the em-dash placeholder the description column shows for a
  // set that genuinely has none. Same glyph, opposite meaning.
  test('the description slot says why it is blank instead of showing the "none" glyph', () => {
    mountWithUnreadable();
    const row = screen.getByText('q3retro').closest('tr');
    expect(within(row).queryByText('—')).toBeNull();
  });

  // rejects: a change that reads `decryptFailed` as "hide it". A row nobody can
  // see is a row nobody restores; the handler deliberately keeps it listed.
  test('it is still listed and still counted, not quietly dropped', () => {
    mountWithUnreadable();
    expect(screen.getByText('6 sets')).toBeInTheDocument();
  });

  /*
    EXTENDED BEYOND THE ROW THIS FEATURE SHIPPED WITH. Edit, Open, Copy and
    Share all need the row's content — to render into the editor, to submit
    for the content check, or to duplicate — and none of them can do anything
    useful with `name: null, description: null`. Delete needs none of that, so
    it is the one control left: the row that will never recover is the row a
    staff member most needs to be able to clear.
  */
  test('Edit and Share are withheld on a manageable row that cannot be read', () => {
    const { container } = render(<QuestionSetsPanel
      questionSets={[...SETS, { ...UNREADABLE, canManage: true }]}
      showVisibility onShare={jest.fn()}
    />);
    const row = within(container).getByText('q3retro').closest('tr');
    expect(within(row).queryByRole('button', { name: /^edit$|^review$/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /^share$/i })).toBeNull();
    expect(within(row).getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  test('Open and Copy are withheld on a read-only row that cannot be read', () => {
    const onCopy = jest.fn();
    const { container } = render(<QuestionSetsPanel
      questionSets={[...SETS, { ...UNREADABLE, canManage: false }]}
      onCopy={onCopy}
    />);
    const row = within(container).getByText('q3retro').closest('tr');
    expect(within(row).queryByRole('button', { name: /^open$/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /^copy$/i })).toBeNull();
  });
});
