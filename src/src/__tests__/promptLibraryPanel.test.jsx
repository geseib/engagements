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

import PromptLibraryPanel, { matchesPromptFilters, nextStatusFor } from '../components/PromptLibraryPanel';

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
  const onToggleStatus = jest.fn();
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
      onToggleStatus={onToggleStatus}
      {...props}
    />
  );
  return { ...utils, onFilterChange, onToggleStatus };
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

/*
  THE STATUS CHIP IS A CONTROL.

  The owner's ask, verbatim: "to be able to click active or deactivate the
  prompts in the admin screen, just like we can do with the questions sets."
  The chip was a `<span>` — the status was visible, filterable, and changeable
  only by opening the editor, changing a select and saving the whole form.

  THE DECISION THESE TESTS PIN. A prompt has THREE states and a toggle has two,
  so "deactivate" had to be defined rather than assumed. It is
  `active ⇄ draft`. `archived` belongs to the Archive action already in the same
  row — a different endpoint, a different intention, and giving one outcome two
  controls is the thing the container rules forbid. The archive dialog on this
  screen has said so in shipped copy since it was written: "If the aim is only
  to stop hosts choosing it, Draft does that."
*/
describe('the status chip activates and deactivates', () => {
  const rowFor = (container, name) => [...container.querySelectorAll('tbody tr')]
    .find((r) => r.textContent.includes(name));

  test('an active prompt offers a pressed toggle that sends draft', () => {
    /*
      rejects: the shipped `<span className={...}>{label}</span>` — the whole
      defect. A span has no role, so `getByRole('button')` cannot find it and
      no click can reach a handler.

      rejects: sending `archived` instead of `draft`. That is the same click
      as the Archive action three cells over, and it stamps `archivedAt` and
      reads as retirement. The value on the wire is asserted, not just the fact
      that something was sent.
    */
    const { container, onToggleStatus } = mount();
    const row = rowFor(container, 'Lessons Learned');

    const chip = within(row).getByRole('button', { name: 'Active' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chip);
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
    expect(onToggleStatus).toHaveBeenCalledWith(PROMPTS[0], 'draft');
  });

  test('a draft prompt offers an unpressed toggle that sends active', () => {
    // rejects: a one-way control. Deactivating with no way back from the same
    // place is a reduction with no recovery, which the rules call a deletion.
    const { container, onToggleStatus } = mount();
    const row = rowFor(container, 'VJ Trivia');

    const chip = within(row).getByRole('button', { name: 'Draft' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chip);
    expect(onToggleStatus).toHaveBeenCalledWith(PROMPTS[1], 'active');
  });

  test('the three states stay three colours, so Draft is not Archived', () => {
    /*
      rejects: collapsing the chip to the question sets' `--on`/`--off` pair
      because the toggle is boolean. It is not: `archived` is a third state
      sitting in the same column, and painting Draft and Archived identically
      makes the one that can be un-clicked indistinguishable from the one that
      cannot.
    */
    const { container } = mount();
    // The status chip is the first in the State cell — the type chip in the
    // column before it is a different `.plib-chip`.
    const chipIn = (name) => rowFor(container, name).querySelector('.plib-states > *');
    expect(chipIn('Lessons Learned')).toHaveClass('plib-chip--on');
    expect(chipIn('VJ Trivia')).toHaveClass('plib-chip--warn');
    expect(chipIn('Legacy Generator')).toHaveClass('plib-chip--off');
  });

  test('an archived prompt is not a toggle, and says where its way back is', () => {
    /*
      rejects: `status !== 'active' ? 'active' : 'draft'`, which would make the
      Archived chip a live control that silently un-retires a prompt — and
      leave the reader guessing whether the click went to Active or Draft.

      rejects, in the other direction: a chip that is dead but still LOOKS
      clickable. It renders as a span, and it carries the exit the archive
      dialog already promises ("it can be set back to Active from the editor")
      rather than being a dead end.
    */
    const { container } = mount();
    const row = rowFor(container, 'Legacy Generator');

    expect(within(row).queryByRole('button', { name: 'Archived' })).toBeNull();
    const chip = within(row).getByText('Archived');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.title).toMatch(/set its status back to Active/i);
  });

  test('with no handler the chip is inert everywhere, not dead-looking', () => {
    /*
      rejects: rendering the affordance unconditionally. Design rule 2 — a dead
      control is the one people reach for first — and this is not hypothetical:
      AIGenerationPromptEditor mounts this same panel over the generation
      prompts and passes no status round trip, so an ungated chip is a button
      that does nothing on every row of that screen.
    */
    const { container } = mount({ onToggleStatus: undefined });
    expect(container.querySelectorAll('.plib-states button')).toHaveLength(0);
    // …and it is still the status chip that is missing its role, not the whole
    // cell: `getByText` here would also match the status FILTER's <option>.
    const chip = rowFor(container, 'Lessons Learned').querySelector('.plib-states > *');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.textContent).toBe('Active');
  });

  test('a broken record gets no toggle, in the shape the API really returns', () => {
    /*
      rejects: offering the control on the rows `scripts/cull-ai-prompts.js`
      exists to sweep — the ones with no `promptId` ATTRIBUTE, which is what
      makes attaching one write a dangling reference into a question set. This
      panel already draws a "Broken record" chip next to the status saying so,
      and a screen that has just called a row broken should not also offer to
      configure it.

      THE FIXTURE CARRIES A promptId ON PURPOSE, AND THAT IS THE WHOLE POINT.
      It used to be `{ name, status, malformed: true }` with no id at all — a
      shape the API never produces. `get-ai-prompts.js:118` SYNTHESIZES an id
      from the SK for exactly these rows and sets `malformed: true` beside it,
      so the panel's old `prompt.promptId` gate never fired against real data
      and this test passed on a fixture instead of on the contract. Nothing
      noticed until the generation library, whose rows come straight from
      `decorate()`, passed a status handler.
    */
    const { container } = mount({
      prompts: [{
        // Exactly what decorate() emits for a row with no promptId attribute.
        SK: 'AIPROMPT#gen-poll-feedback-polls',
        promptId: 'gen-poll-feedback-polls',
        malformed: true,
        name: 'Orphan',
        status: 'active',
      }],
    });
    const states = container.querySelector('.plib-states');
    expect(states.querySelectorAll('button')).toHaveLength(0);
    expect(within(container).getByText('Broken record')).toBeInTheDocument();
    // And the status is still SHOWN, as a label — a row you cannot act on is
    // not a row whose state you are not allowed to know. Scoped to the cell
    // because the status FILTER also offers the word "Active".
    expect(within(states).getByText('Active')).toBeInTheDocument();
  });

  test('the chip in flight is disabled, and only that one', () => {
    /*
      rejects: dropping `busyPromptId`. Two clicks on one chip are two PUTs of
      two different values racing to the same row, and the loser wins — the
      list would then show whichever came back last, which is not necessarily
      what is stored.
    */
    const { container, onToggleStatus } = mount({ busyPromptId: 'p1' });

    const busy = within(rowFor(container, 'Lessons Learned')).getByRole('button', { name: 'Active' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onToggleStatus).not.toHaveBeenCalled();

    // and the rest of the table is still live
    fireEvent.click(within(rowFor(container, 'VJ Trivia')).getByRole('button', { name: 'Draft' }));
    expect(onToggleStatus).toHaveBeenCalledWith(PROMPTS[1], 'active');
  });

  test('nextStatusFor names the pair, and refuses the states with no pair', () => {
    // rejects: `status === 'active' ? 'draft' : 'active'`. A row written by a
    // script with a status this screen does not know has no defined opposite,
    // and guessing one writes a state nobody asked for.
    expect(nextStatusFor('active')).toBe('draft');
    expect(nextStatusFor('draft')).toBe('active');
    expect(nextStatusFor('archived')).toBeNull();
    expect(nextStatusFor('retired')).toBeNull();
    // No status at all already READS as Draft in this table, so it has to
    // behave as one — a chip labelled Draft that sends `draft` is a no-op.
    expect(nextStatusFor(undefined)).toBe('active');
  });

  /*
    `inactive` IS THE ONE UNKNOWN STATUS THAT GETS A PAIR, AND IT EARNED IT.

    `import-from-archive.js` wrote `status: 'inactive'` on every prompt it ever
    imported, commented "Start inactive for review" — ten such rows are in prod
    now. It is not in the vocabulary, so the chip refused to guess an opposite
    and rendered a dead span. That is the owner's report: "the prompt state tag
    is not clickable to make active".

    Folded onto `draft` because the shipped comment beside the write says that
    is what it meant. Nothing else is folded.
  */
  test("'inactive' is treated as Draft, so those rows are clickable again", () => {
    // rejects: leaving `inactive` to fall through to null, which is what made
    // the prod rows unfixable from the screen.
    expect(nextStatusFor('inactive')).toBe('active');
  });

  test('...and the fold is narrow — no other unknown status gets a pair', () => {
    /*
      rejects: "unknown means draft", which would hand every future typo and
      every state some later feature introduces a button that silently rewrites
      it to active.
    */
    for (const unknown of ['retired', 'pending', 'disabled', 'ACTIVE', 'Draft', 'live']) {
      expect(nextStatusFor(unknown)).toBeNull();
    }
  });

  test("an 'inactive' row reads as Draft and is a real button", () => {
    // rejects: folding it in nextStatusFor but leaving STATUS_LABEL alone, which
    // shows the raw word "inactive" beside a filter that offers three others.
    const onToggleStatus = jest.fn();
    const imported = {
      promptId: 'imp1', name: 'Imported Prompt', gameType: 'trivia',
      category: 'general', status: 'inactive',
    };
    const { container } = mount({ prompts: [imported], onToggleStatus });
    const chip = within(rowFor(container, 'Imported Prompt')).getByRole('button', { name: 'Draft' });
    fireEvent.click(chip);
    expect(onToggleStatus).toHaveBeenCalledWith(imported, 'active');
  });

  test("an 'inactive' row is findable under the Draft filter", () => {
    /*
      rejects: folding the chip but not the filter. The dropdown offers
      Active/Draft/Archived and the row holds a fourth value, so before this it
      was invisible under every option except "All" — a filter that is a place
      rows go to disappear.
    */
    const imported = { promptId: 'imp1', name: 'Imported', status: 'inactive', gameType: 'trivia' };
    expect(matchesPromptFilters(imported, { ...ALL, status: 'draft' })).toBe(true);
    expect(matchesPromptFilters(imported, { ...ALL, status: 'active' })).toBe(false);
    expect(matchesPromptFilters(imported, { ...ALL, status: 'archived' })).toBe(false);
    // and a genuinely-draft row is unaffected
    expect(matchesPromptFilters(PROMPTS[1], { ...ALL, status: 'draft' })).toBe(true);
  });
});

describe('the row actions reach the callbacks', () => {
  test('edit, advisor, copy and retire each hand back the right thing', () => {
    /*
      rejects: wiring Retire to the prompt object when handleDeletePrompt takes
      an id, which would send `[object Object]` into the DELETE URL and 404
      quietly — and the mirror mistake on the new button, which takes the whole
      RECORD because it needs the name for its own banner.

      The two are deliberately different shapes and this is the test that keeps
      them from being swapped.
    */
    const onEdit = jest.fn();
    const onAdvise = jest.fn();
    const onDelete = jest.fn();
    const onCopyToArchive = jest.fn();
    const { container } = mount({ onEdit, onAdvise, onDelete, onCopyToArchive });
    const row = container.querySelector('tbody tr');

    fireEvent.click(within(row).getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(PROMPTS[0]);

    fireEvent.click(within(row).getByText('Advisor'));
    expect(onAdvise).toHaveBeenCalledWith(PROMPTS[0]);

    fireEvent.click(within(row).getByText('Copy to archive'));
    expect(onCopyToArchive).toHaveBeenCalledWith(PROMPTS[0]);

    fireEvent.click(within(row).getByText('Retire'));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  test('the copy button is absent without a handler, and never a dead control', () => {
    /*
      rejects: drawing "Copy to archive" unconditionally. The generation library
      (AIGenerationPromptEditor) mounts this same panel and passes no export
      round trip; a button there would look identical and do nothing. Design
      rule 2 — a dead control is the one people reach for first.
    */
    const { container } = mount({ onDelete: jest.fn() });
    const row = container.querySelector('tbody tr');
    expect(within(row).queryByText('Copy to archive')).toBeNull();
    expect(within(row).getByText('Retire')).toBeInTheDocument();
  });

  test('the destructive button does not say "archive"', () => {
    /*
      rejects: renaming Retire back. It sat next to nothing for months and read
      fine; the moment a real copy-to-archive appeared beside it, the word on
      the destructive control was the one promising to preserve. The owner
      pressed it expecting a copy.
    */
    const { container } = mount({ onDelete: jest.fn(), onCopyToArchive: jest.fn() });
    const row = container.querySelector('tbody tr');
    const retire = within(row).getByTestId('plib-retire-p1');
    expect(retire.textContent.toLowerCase()).not.toContain('archive');
    expect(retire.getAttribute('title')).toMatch(/not copied to the archive/i);
  });

  test('a copy in flight cannot be clicked into a second copy', () => {
    // rejects: dropping `copyingPromptId`, which turns a slow export into two.
    const onCopyToArchive = jest.fn();
    const { container } = mount({ onCopyToArchive, copyingPromptId: 'p1' });
    const row = container.querySelector('tbody tr');
    const copy = within(row).getByTestId('plib-copy-archive-p1');
    expect(copy).toBeDisabled();
    fireEvent.click(copy);
    expect(onCopyToArchive).not.toHaveBeenCalled();
  });

  test('...and only THAT row is locked', () => {
    // rejects: a single boolean `copying` flag, which freezes the whole table.
    const { container } = mount({ onCopyToArchive: jest.fn(), copyingPromptId: 'p1' });
    const rows = container.querySelectorAll('tbody tr');
    expect(within(rows[0]).getByTestId('plib-copy-archive-p1')).toBeDisabled();
    expect(within(rows[1]).getByTestId('plib-copy-archive-p2')).not.toBeDisabled();
  });
});
