/**
 * THE THIRD PROMPT UI — components/AIGenerationPromptEditor.jsx
 *
 * AUDIT §6.2 item 9. This screen drew its own `.prompts-grid` of
 * `.prompt-card`s over the same `AIPROMPTS` table PromptLibraryPanel already
 * lists: the third list UI for one record type (admin RATIONALE §9), and the
 * wall of cards design rule 7 rejects.
 *
 * EVERY TEST BELOW FAILS AGAINST THE CARD GRID. That is the bar the brief set,
 * and it is checkable: each one names the card-grid line it rejects.
 *
 * NO GEOMETRY. "It is a table, not a grid" is asserted through the a11y tree —
 * `getByRole('table')`, `getAllByRole('row')`, `getByRole('columnheader')` —
 * never through a computed `display`, which jsdom does not have.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

import AIGenerationPromptEditor from '../components/AIGenerationPromptEditor';

/**
 * What `get-ai-prompts.js` actually returns for these rows, not a tidied
 * version of it:
 *
 *  - `gameType` is normalized to the dashed id by `decorate()` (:118-120);
 *  - `promptId` is SYNTHESIZED from the SK when the row has none, and
 *    `malformed: true` marks it — `populate-generation-prompts.js` wrote a
 *    whole generation of rows that way, and picking one writes a dangling
 *    reference into a question set;
 *  - `summaryPromptStatus: 'unusable'` is set on every generation-format
 *    record (:129-133). On THIS list that is true of all of them.
 */
const PROMPTS = [
  {
    SK: 'AIPROMPT#gen-call-and-answer-lessons-learned',
    promptId: 'gen-call-and-answer-lessons-learned',
    malformed: false,
    promptType: 'generation',
    gameType: 'call-and-answer',
    scenarioType: 'lessons-learned',
    name: 'Lessons Learned Scenarios',
    description: 'Retrospective prompts for a project review.',
    status: 'active',
    isDefault: true,
    tags: ['retro'],
    summaryPromptStatus: 'unusable',
    summaryPromptDefect: 'generation format',
  },
  {
    SK: 'AIPROMPT#gen-trivia-workplace-trivia',
    promptId: 'gen-trivia-workplace-trivia',
    malformed: false,
    promptType: 'generation',
    gameType: 'trivia',
    scenarioType: 'workplace-trivia',
    name: 'Workplace Trivia',
    description: 'Business and office questions.',
    status: 'draft',
    tags: [],
    summaryPromptStatus: 'unusable',
  },
  {
    // No `promptId` attribute on the record: the id below was synthesized from
    // the SK and `malformed` says so.
    SK: 'AIPROMPT#gen-poll-feedback-polls',
    promptId: 'gen-poll-feedback-polls',
    malformed: true,
    promptType: 'generation',
    gameType: 'poll',
    scenarioType: 'feedback-polls',
    name: 'Feedback Polls',
    description: 'Assessment polls.',
    status: 'active',
    summaryPromptStatus: 'unusable',
  },
];

function respondWith(prompts) {
  global.fetch.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ prompts }),
    })
  );
}

/** Mount and wait out the one fetch the component fires on mount. */
async function mount(prompts = PROMPTS) {
  respondWith(prompts);
  const onClose = jest.fn();
  const utils = render(<AIGenerationPromptEditor onClose={onClose} />);
  await waitFor(() => expect(screen.queryByText('Loading prompts...')).toBeNull());
  return { ...utils, onClose };
}

/** The row whose first cell carries this name. */
function rowFor(name) {
  return screen.getAllByRole('row').find((r) => within(r).queryByText(name));
}

beforeEach(() => {
  global.fetch.mockReset();
});

describe('the generation library is a table, not a wall of cards', () => {
  test('the list is a table, with one row per prompt under a header row', async () => {
    /*
      rejects: `<div className="prompts-grid">` of `<div className="prompt-card">`
      (the shipped AIGenerationPromptEditor.jsx:318-333). A div grid exposes no
      table, no rows and no column headers, so every assertion here is false
      against it — and none of them reads a CSS display value.
    */
    await mount();

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Three prompts plus the one header row.
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(
      within(table).getAllByRole('columnheader').map((th) => th.textContent)
    ).toEqual(['Prompt', 'Type', 'Scenario', 'State', '']);

    const row = rowFor('Lessons Learned Scenarios');
    expect(within(row).getByText('Retrospective prompts for a project review.')).toBeInTheDocument();
    expect(within(row).getByText('retro')).toBeInTheDocument();
  });

  test('the scenario column shows the written label, not the stored slug', async () => {
    /*
      rejects: `<span className="scenario-type">{prompt.scenarioType}</span>` —
      the card printed the raw key. The labels existed the whole time, three
      lines above, in `scenarioTypeOptions`; the grid just never used them, so
      the screen read `workplace-trivia` where the create form said
      "Workplace & Business".
    */
    await mount();

    const row = rowFor('Workplace Trivia');
    expect(within(row).getByText('Workplace & Business')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/workplace-trivia/);
  });

  test('the game type is the written label too, not the stored id', async () => {
    // rejects: `<span className="game-type">{prompt.gameType}</span>`, which
    // printed `call-and-answer` beside a create form offering "Call & Answer".
    await mount();

    const row = rowFor('Lessons Learned Scenarios');
    expect(within(row).getByText('Call & Answer')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/call-and-answer/);
  });

  test('a row with no promptId of its own is marked as a broken record', async () => {
    /*
      rejects: the card grid, which had no such state at all. These rows are
      the reason `decorate()` synthesizes an id: selecting one used to write
      the option's LABEL TEXT into a question set's promptId. A library that
      cannot show you which rows those are cannot get them fixed.
    */
    await mount();

    const row = rowFor('Feedback Polls');
    const chip = within(row).getByText(/Broken record/);
    expect(chip).toHaveClass('plib-chip--bad');

    // And it is not drawn on the rows that do have one.
    expect(rowFor('Workplace Trivia').textContent).not.toMatch(/Broken record/);
  });

  test('"Not a summary prompt" is suppressed on a list that is all generation prompts', async () => {
    /*
      rejects: passing `flagSummaryUsability` through as true, or omitting it.
      The API sets `summaryPromptStatus: 'unusable'` on every one of these rows
      — correctly, they ARE generation prompts — and a chip on all N rows is a
      watermark, not a warning. The summary library still draws it, which is
      where it can be false; promptLibraryPanel.test.jsx holds that half.
    */
    await mount();

    expect(screen.queryByText(/Not a summary prompt/)).toBeNull();
  });
});

describe('two empty states, because they are two situations', () => {
  test('an empty library says what a generation prompt is', async () => {
    /*
      rejects: "No prompts found matching the current filters." printed over an
      EMPTY table (AIGenerationPromptEditor.jsx:316). With nothing in the
      library that sentence blames filters that are not set, and offers no way
      to make the first one.
    */
    await mount([]);

    const empty = screen.getByTestId('plib-empty');
    expect(empty.textContent).toMatch(/No generation prompts yet/);
    expect(empty.textContent).toMatch(/instruction the AI is given/);
    expect(within(empty).getByText(/Write one/)).toBeInTheDocument();
    expect(screen.queryByTestId('plib-nomatch')).toBeNull();
  });

  test('filters that exclude everything are a different screen, with an exit', async () => {
    /*
      rejects: the same one sentence, this time over a populated library, with
      no way back except guessing which of three selects was the culprit. The
      exit has to name the filter AND what dropping it is worth.
    */
    await mount();

    fireEvent.change(screen.getByLabelText('Filter by engagement type'), {
      target: { value: 'wavelength' },
    });

    const nomatch = await screen.findByTestId('plib-nomatch');
    expect(nomatch.textContent).toMatch(/3 prompts exist/);
    expect(screen.queryByTestId('plib-empty')).toBeNull();

    const exit = within(nomatch).getByText(/Type: Wavelength/).closest('button');
    expect(exit.textContent).toMatch(/3 prompts/);

    fireEvent.click(exit);
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });
});

describe('the filters the card grid could not offer', () => {
  test('scenario types are offered before a game type is chosen', async () => {
    /*
      rejects: `filters.gameType !== 'all' && scenarioTypeOptions[...]` — the
      shipped guard, which left the Scenario select holding nothing but "All
      Scenario Types" until a game type was picked. "Show me every
      lessons-learned prompt" was two steps, and looked like zero.
    */
    await mount();

    const select = screen.getByLabelText('Filter by scenario');
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels[0]).toBe('All Scenario Types');
    expect(labels).toEqual(expect.arrayContaining([
      'Lessons Learned', 'Workplace & Business', 'Feedback & Assessment', 'Brainstorming',
    ]));
  });

  test('choosing a scenario filters on scenarioType, not on category', async () => {
    /*
      rejects: leaving `categoryKey` at its 'category' default. These records
      have no `category` attribute at all, so the shared filter would compare
      `undefined` to the slug, match nothing, and every scenario choice would
      empty the table.
    */
    await mount();

    fireEvent.change(screen.getByLabelText('Filter by scenario'), {
      target: { value: 'feedback-polls' },
    });

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2); // header + the one match
    expect(rowFor('Feedback Polls')).toBeTruthy();
    expect(screen.queryByTestId('plib-nomatch')).toBeNull();
  });

  test('there is a search box, and it reaches the tags', async () => {
    // rejects: the card grid, which had three selects and no free-text search.
    // `retro` is a tag on one prompt and appears in no name or description.
    await mount();

    fireEvent.change(screen.getByLabelText('Search prompts'), {
      target: { value: 'retro' },
    });

    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(rowFor('Lessons Learned Scenarios')).toBeTruthy();
  });
});

describe('only the controls this screen actually has', () => {
  test('no advisor, no archive and no defaults installer are drawn', async () => {
    /*
      rejects: rendering PromptLibraryPanel's full action set here. This screen
      has never had an advisor, a delete call or a defaults endpoint wired up,
      and design rule 2 is that a dead control is the one people reach for
      first — so the panel draws an action only where its handler exists.
    */
    await mount();

    expect(screen.queryByText('Advisor')).toBeNull();
    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.queryByText(/Populate Default Prompts/)).toBeNull();
    // The two it does have.
    expect(screen.getAllByText('Edit')).toHaveLength(3);
    expect(screen.getByText(/Create New Prompt/)).toBeInTheDocument();
  });

  test('a row Edit opens that prompt in the form, unlaundered', async () => {
    /*
      rejects: handing the panel adapted copies of the records — mapping
      `scenarioType` onto `category` in the caller would send a record with an
      extra attribute straight back through `admin/ai-prompts/save`. The panel
      is told the field name instead, so the object that reaches the form is
      the one the API returned.
    */
    await mount();

    fireEvent.click(within(rowFor('Workplace Trivia')).getByText('Edit'));

    expect(screen.getByText('Edit Prompt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Workplace Trivia')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Business and office questions.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
