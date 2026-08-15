/**
 * THE PROMPT LIBRARY LIST — components/PromptLibraryPanel.jsx
 *
 * The owner asked twice for this section to be "designed thoughtfully like the
 * question set management" (backlog #18), and twice the answer was that it had
 * not been done. What the sets screen does that this one did not:
 *
 *   - a 36px table row instead of a card per prompt;
 *   - TWO empty states, because "nothing exists" and "four filters exclude
 *     everything" are different situations with different exits;
 *   - a one-click way out of each filter that is currently costing rows;
 *   - the states that mean a row does not work rendered as chips that say so,
 *     rather than badges mixed in with the decorative ones.
 *
 * PURE PROPS, ZERO MOCKS. Same arrangement as questionSetsPanel.test.jsx: the
 * fetch stays in AIPromptManager, every decision is here, and this file mounts
 * the component directly. `jest.mock` count: zero.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import PromptLibraryPanel, { matchesPromptFilters } from '../components/PromptLibraryPanel';

const ALL = { search: '', gameType: 'all', category: 'all', status: 'all' };

const PROMPTS = [
  {
    promptId: 'p1', name: 'Lessons Learned', description: 'The stock call-and-answer review.',
    gameType: 'call-and-answer', category: 'lessons-learned', status: 'active', isDefault: true,
  },
  {
    promptId: 'p2', name: 'VJ Trivia', description: 'MTV voice.',
    gameType: 'trivia', category: 'general', status: 'draft', tags: ['80s'],
  },
  {
    promptId: 'p3', name: 'Legacy Generator', description: 'Written before promptType existed.',
    gameType: 'poll', category: 'opinion', status: 'archived',
    summaryPromptStatus: 'unusable', summaryPromptDefect: 'generation format',
  },
];

/**
 * Render with a controlled filter object, the way AIPromptManager does — and
 * with the full set of callbacks, because AIPromptManager passes all five. The
 * panel draws a control only where its handler exists (design rule 2), so the
 * defaults here are what makes this the SUMMARY library's arrangement; the
 * generation library's narrower one is asserted in
 * aiGenerationPromptEditor.test.jsx by omitting them.
 */
function mount(props = {}) {
  const onFilterChange = jest.fn();
  const utils = render(
    <PromptLibraryPanel
      prompts={PROMPTS}
      filters={ALL}
      onFilterChange={onFilterChange}
      gameTypeOptions={[
        { value: 'call-and-answer', label: 'Call & Answer' },
        { value: 'trivia', label: 'Trivia' },
        { value: 'poll', label: 'Poll' },
      ]}
      categoryOptions={['lessons-learned', 'general', 'opinion']}
      onEdit={jest.fn()}
      onAdvise={jest.fn()}
      onDelete={jest.fn()}
      onCreate={jest.fn()}
      onPopulateDefaults={jest.fn()}
      {...props}
    />
  );
  return { ...utils, onFilterChange };
}

describe('the list is a table, not a wall of cards', () => {
  test('one row per prompt, with its name and description', () => {
    // rejects: reverting to `.prompts-grid` / `.prompt-card`. Forty-one cards
    // is the wall admin RATIONALE §4 rejected on the sets screen, and a prompt
    // library is an index — you scan it for one row and open it.
    const { container } = mount();
    const rows = container.querySelectorAll('.plib-tbl tbody tr');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Lessons Learned')).toBeInTheDocument();
    expect(within(rows[0]).getByText('The stock call-and-answer review.')).toBeInTheDocument();
  });

  test('a broken row carries a chip that says it does not work', () => {
    // rejects: rendering `summaryPromptStatus: 'unusable'` as one more badge
    // alongside the type and category. A generation-format prompt attached to a
    // set does nothing at runtime — the engine rejects it and silently uses the
    // game-type default — so it is a defect state, not a label.
    const { container } = mount();
    const row = [...container.querySelectorAll('tbody tr')]
      .find((r) => r.textContent.includes('Legacy Generator'));
    const chip = within(row).getByText(/Not a summary prompt/);
    expect(chip).toHaveClass('plib-chip--bad');
  });

  test('the one default is marked, and the mark says what it costs', () => {
    // rejects: dropping the Default chip. There is exactly one default per
    // engagement type and it runs for every set of that type with no prompt of
    // its own; a library that does not show which row that is makes the
    // question unanswerable without opening every prompt.
    const { container } = mount();
    const row = [...container.querySelectorAll('tbody tr')]
      .find((r) => r.textContent.includes('Lessons Learned'));
    expect(within(row).getByText('Default').title).toMatch(/every Call & Answer set/);
  });
});

describe('two empty states, because they are two situations', () => {
  test('nothing exists says what a prompt is and offers both ways in', () => {
    // rejects: the shipped single state, "No prompts found. Create your first
    // AI prompt to get started!", which was printed over a populated library
    // whenever the filters excluded everything.
    mount({ prompts: [] });
    const empty = screen.getByTestId('plib-empty');
    expect(empty.textContent).toMatch(/No prompts yet/);
    expect(within(empty).getByText(/Write one/)).toBeInTheDocument();
    expect(within(empty).getByText(/Install the shipped defaults/)).toBeInTheDocument();
    expect(screen.queryByTestId('plib-nomatch')).toBeNull();
  });

  test('nothing matches is a different screen, and says how many exist', () => {
    // rejects: collapsing the two back into one. This state's job is to say the
    // library is not empty — you are looking through a filter.
    mount({ filters: { ...ALL, gameType: 'wavelength' } });
    const nomatch = screen.getByTestId('plib-nomatch');
    expect(nomatch.textContent).toMatch(/No prompts match this filter/);
    expect(nomatch.textContent).toMatch(/3 prompts exist/);
    expect(screen.queryByTestId('plib-empty')).toBeNull();
  });

  test('each filter that is costing rows becomes a one-click exit', () => {
    // rejects: printing the dead end with no way out. Dropping the search here
    // yields the one trivia prompt, so it is offered with its count.
    const { onFilterChange } = mount({
      filters: { ...ALL, gameType: 'trivia', search: 'nothing matches this' },
    });
    const exit = screen.getByText(/Search “nothing matches this”/).closest('button');
    expect(exit.textContent).toMatch(/1 prompt/);
    fireEvent.click(exit);
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: '', gameType: 'trivia' })
    );
  });

  test('a filter whose removal leads to another empty screen is not offered', () => {
    /*
      rejects: `.filter(() => true)` in place of `.filter((c) => c.count > 0)` —
      listing every active filter regardless of whether dropping it produces
      anything. An exit that leads somewhere just as empty is not an exit, and
      offering it teaches the author that the exits do not work.

      THIS TEST'S FIRST VERSION SURVIVED THAT EXACT MUTATION, and the reason is
      worth recording. It used a filter pair where BOTH exits happened to lead
      to rows, then asserted only that each button carried a count — which is
      true of every button in both versions of the code. It was a `forEach` over
      a list that could not disagree: coverage-shaped, and empty. Found by
      mutation, not by reading it back.

      The fixture now contains a real dead end. `wavelength` matches none of the
      three prompts, so:
        - dropping the SEARCH leaves gameType=wavelength → still zero → not an
          exit, and must not be drawn;
        - dropping the TYPE leaves search="Lessons" → one row → a real exit.
      Both halves are asserted, so the check cannot pass by drawing nothing.
    */
    mount({ filters: { ...ALL, gameType: 'wavelength', search: 'Lessons' } });

    const offered = [...document.querySelectorAll('.plib-drop')].map((b) => b.textContent);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatch(/Type: Wavelength/);
    expect(offered[0]).toMatch(/1 prompt/);
    expect(offered.join(' ')).not.toMatch(/Search/);
  });
});

describe('filtering is a pure function, and it is the one the counts use', () => {
  test('the legacy game-type spellings still match', () => {
    // rejects: an exact-match filter on the dashed id. Rows written before the
    // vocabulary was unified carry `callandanswer` and `polls`, and an
    // exact-match filter shows none of them — the R3 defect.
    expect(matchesPromptFilters({ gameType: 'callandanswer', name: 'x' }, { ...ALL, gameType: 'call-and-answer' }))
      .toBe(true);
    expect(matchesPromptFilters({ gameType: 'polls', name: 'x' }, { ...ALL, gameType: 'poll' }))
      .toBe(true);
  });

  test('search covers tags, not just the name', () => {
    // rejects: narrowing search to the name. Tags are the only free-text handle
    // on a prompt whose name is generic, and the shipped filter already read
    // them — losing that in a rewrite would be a silent regression.
    expect(matchesPromptFilters(PROMPTS[1], { ...ALL, search: '80s' })).toBe(true);
    expect(matchesPromptFilters(PROMPTS[0], { ...ALL, search: '80s' })).toBe(false);
  });

  test('the second axis can live under another attribute name', () => {
    /*
      rejects: hard-coding `prompt.category`. AUDIT §6.2 item 9 points
      AIGenerationPromptEditor at this panel, and generation rows written by
      `populate-generation-prompts.js:502` carry `scenarioType` and no
      `category` at all — a hard-coded read compares `undefined` to the slug,
      matches nothing, and empties the table on every scenario choice.

      Both halves are asserted: the named key matches, AND the default still
      does not see it. A test that only checked the first would pass against
      `prompt[categoryKey] || prompt.category`, which would silently make the
      summary library filter on generation slugs too.
    */
    const genRow = { name: 'Lessons Learned Scenarios', scenarioType: 'lessons-learned' };
    expect(
      matchesPromptFilters(genRow, { ...ALL, category: 'lessons-learned' }, { categoryKey: 'scenarioType' })
    ).toBe(true);
    expect(matchesPromptFilters(genRow, { ...ALL, category: 'lessons-learned' })).toBe(false);
  });

  test('a prompt with no description or tags does not throw the filter', () => {
    // rejects: `p.description.toLowerCase()` without the guard. Every field
    // except the name is optional on these records.
    expect(() => matchesPromptFilters({ name: 'bare' }, { ...ALL, search: 'x' })).not.toThrow();
    expect(matchesPromptFilters({ name: 'bare' }, { ...ALL, search: 'bare' })).toBe(true);
  });
});

describe('the category column is configurable, and its labels are used', () => {
  test('a labelled option list names the column, the select and the exit', () => {
    /*
      rejects: printing the slug wherever the second axis appears. The
      generation library's scenario slugs (`workplace-trivia`) have written
      labels ("Workplace & Business") that its own create form uses, and the
      card grid this panel replaced showed the slug in all three places. The
      drop-exit is the one that matters most: an exit the reader cannot match
      to the control they set is not an exit.
    */
    const rows = [{ promptId: 'g1', name: 'Workplace Trivia', scenarioType: 'workplace-trivia' }];
    const panel = (filters) => (
      <PromptLibraryPanel
        prompts={rows}
        filters={filters}
        onFilterChange={jest.fn()}
        categoryKey="scenarioType"
        categoryHeading="Scenario"
        categoryFilterAllLabel="All Scenario Types"
        categoryOptions={[
          { value: 'workplace-trivia', label: 'Workplace & Business' },
          { value: 'no-such-scenario', label: 'Fun Facts' },
        ]}
      />
    );
    const { rerender } = render(panel(ALL));

    expect(screen.getByRole('columnheader', { name: 'Scenario' })).toBeInTheDocument();
    expect(document.querySelector('.plib-cat').textContent).toBe('Workplace & Business');

    const select = screen.getByLabelText('Filter by scenario');
    expect([...select.options].map((o) => o.textContent))
      .toEqual(['All Scenario Types', 'Workplace & Business', 'Fun Facts']);

    // Nothing matches `no-such-scenario`, so the exit is drawn — by its label.
    rerender(panel({ ...ALL, category: 'no-such-scenario' }));
    const exit = screen.getByText(/Scenario: Fun Facts/);
    expect(exit.closest('button').textContent).toMatch(/1 prompt/);
  });

  test('plain strings still work, and a value off the list still renders', () => {
    /*
      rejects: requiring `{ value, label }`. AIPromptManager passes
      `ALL_PROMPT_CATEGORIES`, a flat string array, and its rows must keep
      rendering.

      THE FIRST VERSION OF THIS TEST SURVIVED `asOption = (o) => o`. It read
      only the CELLS, and a cell falls back to the raw value when the option
      list has no match — which is exactly what a list of unconverted strings
      produces, so the mutant rendered identically there. The select is where
      the damage actually lands: `{c.label}` on a bare string is `undefined`,
      i.e. a filter of blank options that all carry `value=""`. Both the select
      and the cells are asserted now.
    */
    render(
      <PromptLibraryPanel
        prompts={[{ promptId: 'a', name: 'A', category: 'general' },
          { promptId: 'b', name: 'B', category: 'not-offered' }]}
        filters={ALL}
        onFilterChange={jest.fn()}
        categoryOptions={['general']}
      />
    );

    const select = screen.getByLabelText('Filter by category');
    expect([...select.options].map((o) => [o.value, o.textContent]))
      .toEqual([['all', 'All Categories'], ['general', 'general']]);

    // And the row whose category the narrowed list does not offer keeps it.
    const cells = [...document.querySelectorAll('.plib-cat')].map((td) => td.textContent);
    expect(cells).toEqual(['general', 'not-offered']);
  });
});

describe('the row actions reach the callbacks', () => {
  test('edit, advisor and archive each hand back the right thing', () => {
    // rejects: wiring Archive to the prompt object when handleDeletePrompt
    // takes an id, which would send `[object Object]` into the DELETE URL and
    // 404 quietly.
    const onEdit = jest.fn();
    const onAdvise = jest.fn();
    const onDelete = jest.fn();
    const { container } = mount({ onEdit, onAdvise, onDelete });
    const row = container.querySelector('tbody tr');

    fireEvent.click(within(row).getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(PROMPTS[0]);

    fireEvent.click(within(row).getByText('Advisor'));
    expect(onAdvise).toHaveBeenCalledWith(PROMPTS[0]);

    fireEvent.click(within(row).getByText('Archive'));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });
});
