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
  const utils = render(<AIGenerationPromptEditor />);
  await waitFor(() => expect(screen.queryByText('Loading prompts...')).toBeNull());
  return utils;
}

/** The status chip in a row — the only `plib-chip` that is ever a button. */
function statusControl(name) {
  return within(rowFor(name)).getByRole('button', { name: /^(Active|Draft|Archived)$/ });
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

/*
  ============================================================================
  THE STATUS CHIP, WHICH IS A BUTTON HERE NOW.

  The owner: *"the question set generator need to have the active button as
  well"*. The chip existed; `PromptLibraryPanel` rendered it as a plain span
  because this screen passed no `onToggleStatus`, which is design rule 2 — a
  dead control is the one people reach for first — not an oversight.

  EVERY TEST BELOW FAILS AGAINST THE SHIPPED SCREEN, where the chip was a
  `<span>` with no role and no handler.

  AND THE ROUTE IS REACHABLE, which is not a UI fact and is not asserted here:
  `PUT admin/ai-prompts/{promptId}` is absent from HOST_ADMIN_ROUTES in
  auth/authorizer.js, so `requiredGroupsForRoute` falls it through to
  `path.startsWith('admin') -> ['admins']`, and this console is admins-only.
  What these rows send it — a status-only body against a record with NO `s3Key`
  — is asserted end-to-end in tests/ai-prompt-status-update.js section 4,
  because it used to be a 500.
  ============================================================================
*/
describe('the status chip flips Active and Draft', () => {
  /** The response every PUT below gets unless a test says otherwise. */
  function respondToToggle(put = { ok: true, json: () => Promise.resolve({}) }) {
    global.fetch.mockImplementation((url, init) => {
      if (init && init.method === 'PUT') return Promise.resolve(put);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ prompts: PROMPTS }) });
    });
  }

  test('an Active row offers a control that says what it would do', async () => {
    /*
      rejects: the shipped `<span className="plib-chip">`. A span has no role,
      so `getByRole('button')` cannot find it — and `aria-pressed` is what says
      this is a two-state control rather than a link to somewhere.
    */
    await mount();
    respondToToggle();

    const chip = statusControl('Lessons Learned Scenarios');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.title).toMatch(/Deactivate/);
    expect(statusControl('Workplace Trivia')).toHaveAttribute('aria-pressed', 'false');
  });

  test('clicking it PUTs one field to that prompt, and nothing else', async () => {
    /*
      rejects: sending the whole row back. Every field this route receives as
      `undefined` is left alone; a resent record would rewrite name, isDefault
      and questionSetIds from a list projection that may not carry them — and
      would defeat the S3 guard in update-ai-prompt.js, which distinguishes a
      status-only write precisely by its emptiness.
    */
    await mount();
    respondToToggle();

    fireEvent.click(statusControl('Lessons Learned Scenarios'));

    await waitFor(() => expect(
      global.fetch.mock.calls.some(([, init]) => init && init.method === 'PUT')
    ).toBe(true));

    const [url, init] = global.fetch.mock.calls.find(([, i]) => i && i.method === 'PUT');
    expect(url).toMatch(/admin\/ai-prompts\/gen-call-and-answer-lessons-learned$/);
    expect(JSON.parse(init.body)).toEqual({ status: 'draft' });
  });

  test('the row moves AFTER the response, never before it', async () => {
    /*
      rejects: an optimistic flip. The pending fetch is held open here, so the
      chip is asserted mid-flight: it must still read Active, and it must be
      disabled — one click is one write, and a chip that can be clicked twice
      sends two writes of two different values whose order nothing controls.
    */
    await mount();
    let release;
    global.fetch.mockImplementation((url, init) => {
      if (init && init.method === 'PUT') {
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, json: () => Promise.resolve({}) });
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ prompts: PROMPTS }) });
    });

    fireEvent.click(statusControl('Lessons Learned Scenarios'));

    await waitFor(() => expect(statusControl('Lessons Learned Scenarios')).toBeDisabled());
    expect(statusControl('Lessons Learned Scenarios')).toHaveTextContent('Active');
    expect(statusControl('Lessons Learned Scenarios')).toHaveAttribute('aria-pressed', 'true');

    release();
    await waitFor(() => expect(statusControl('Lessons Learned Scenarios')).toHaveTextContent('Draft'));
    expect(statusControl('Lessons Learned Scenarios')).toHaveAttribute('aria-pressed', 'false');
    expect(statusControl('Lessons Learned Scenarios')).not.toBeDisabled();
  });

  test('only the clicked row is locked while its write is in flight', async () => {
    // rejects: a boolean `busy` instead of a promptId. Locking the whole table
    // for one row's round trip is a different, larger claim than the one the
    // in-flight state is making.
    await mount();
    global.fetch.mockImplementation((url, init) => {
      if (init && init.method === 'PUT') return new Promise(() => {});
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ prompts: PROMPTS }) });
    });

    fireEvent.click(statusControl('Lessons Learned Scenarios'));

    await waitFor(() => expect(statusControl('Lessons Learned Scenarios')).toBeDisabled());
    expect(statusControl('Workplace Trivia')).not.toBeDisabled();
  });

  test('a refusal keeps the row where it was and repeats the server sentence', async () => {
    /*
      rejects: swallowing the failure, and rejects inventing a local message.
      The handler's own refusals are specific ("its stored content ... could not
      be read", "status must be one of ...") and a generic "Something went
      wrong" throws that away. It also has to say what the row on screen now
      means, or the only way to find out is a reload.
    */
    await mount();
    respondToToggle({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Cannot apply a partial update to gen-x: nothing was changed.' }),
    });

    fireEvent.click(statusControl('Lessons Learned Scenarios'));

    const notice = await screen.findByTestId('pgen-notice');
    expect(notice).toHaveTextContent('Cannot apply a partial update to gen-x');
    expect(notice).toHaveTextContent(/still Active/);
    expect(statusControl('Lessons Learned Scenarios')).toHaveTextContent('Active');
    expect(statusControl('Lessons Learned Scenarios')).not.toBeDisabled();
  });

  test('a row with no promptId of its own gets a label, not a control', async () => {
    /*
      rejects: gating the chip on the handler alone. `Feedback Polls` is
      `malformed` — the id in the projection was synthesized from the SK by
      get-ai-prompts.js and there is no such attribute on the record — so the
      route keyed by promptId could only ever fail. The row already carries a
      "Broken record" chip saying so; offering a button beside it would be the
      screen contradicting itself.
    */
    await mount();
    const row = rowFor('Feedback Polls');
    expect(within(row).getByText(/Broken record/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Active' })).toBeNull();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  test('the panel keeps drawing only the actions this screen has handlers for', async () => {
    // rejects: "it has a status handler now, give it the whole action set". The
    // gate is per-prop and stays that way; this screen still has no advisor, no
    // delete, no export and no defaults installer.
    await mount();
    expect(screen.queryByText('Advisor')).toBeNull();
    expect(screen.queryByText('Retire')).toBeNull();
    expect(screen.queryByText('Copy to archive')).toBeNull();
  });
});

describe('it is a place in the console, not an overlay over it', () => {
  test('it renders no scrim, no modal card and no close button of its own', () => {
    /*
      rejects: the shipped shell — `.ai-prompt-editor-modal` fixed over the
      whole viewport, holding `.modal-overlay > .modal-content.large-modal` with
      no Escape, no focus trap, no `role="dialog"`, and a backdrop click that
      discarded a half-typed fourteen-field form without asking. AUDIT section 5
      counts that scrim as the fifth appearance of the centred-overflow trap.

      Asserted on the SOURCE rather than the DOM because two of the three are
      absences of class names, and jsdom resolves no CSS: what matters is that
      this component no longer asks for the global `.modal-overlay` rules at
      all.
    */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'components', 'AIGenerationPromptEditor.jsx'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    expect(src).not.toMatch(/className="modal-overlay"/);
    expect(src).not.toMatch(/large-modal/);
    expect(src).not.toMatch(/className="close-button"/);
    expect(src).toMatch(/className="pgen"/);
  });

  test('and it draws no exit, because the section owns the one both libraries share', async () => {
    /*
      rejects: giving this place a Back or Close of its own. The owner's
      complaint was that the two prompt libraries were REACHED differently; two
      separately-authored exits is the same defect one step later. `.padm-back`
      is rendered once by AdminPage for whichever library is open.
    */
    await mount();
    expect(screen.queryByRole('button', { name: /^(Close|Back|Prompts)$/ })).toBeNull();
    expect(screen.queryByText(/AI Generation Prompt Editor/)).toBeNull();
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
