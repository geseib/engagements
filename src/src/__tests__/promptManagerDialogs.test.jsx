/**
 * CAN YOU GET OUT OF THE PROMPT EDITOR, AND DOES IT TELL YOU WHAT IT COST?
 *
 * Three defects, one screen:
 *
 * (1) NEITHER DIALOG WAS A DIALOG. Both were bare `<div>` overlays: no Escape,
 *     no focus trap, no scroll lock (the page scrolled under the cursor while
 *     you typed), no `role="dialog"` and no accessible name — on the tallest
 *     form in the product. Both go through `Modal` now.
 *
 * (2) THE ADVISOR HAD ONE EXIT, AT THE TOP. An `improve` run renders an
 *     improved prompt, a score, strengths, improvements, alternative approaches
 *     and recommendations. The × was above all of it. Commit `4fd425d6` is the
 *     same report about the set editor.
 *
 * (3) THE EDITOR'S TWO EXITS DID DIFFERENT THINGS TO UNSAVED WORK — both
 *     dropped it silently — and the destructive paths asked with
 *     `window.confirm('Are you sure...?')`, which names nothing.
 *
 * WHAT GREEN MEANS HERE. jsdom has no layout engine, so nothing below asserts a
 * position, a size or a scroll. "The exit is at the bottom" is asserted as
 * document ORDER, which jsdom does model, and the geometry that makes it
 * reachable is pinned as CSS text in `modalReachability.test.js`. Green means
 * the controls exist, are wired, and are wired to the same handler.
 *
 * One mocked module — `../auth/authFetch` — and no AuthProvider, because
 * AIPromptManager does not call `useAuth`. The SessionsPanel pattern.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';

const PROMPT = {
  promptId: 'p1',
  name: 'Lessons Learned',
  gameType: 'call-and-answer',
  category: 'lessons-learned',
  status: 'active',
  isDefault: true,
  questionSetIds: ['qs-1', 'qs-2', 'qs-3'],
  promptContent: { instructions: 'Given {responsesText}', outputFormat: '## Summary' },
};

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ prompts: [] }) });
});

async function openEditor() {
  render(<AIPromptManager />);
  fireEvent.click(await screen.findByText('Create New Prompt'));
  await screen.findByText('Create New AI Prompt');
}

const dialogNamed = (name) =>
  screen.getAllByRole('dialog').find((d) => (d.getAttribute('aria-label') || d.textContent).includes(name));

describe('the editor is a dialog, not a div', () => {
  test('it announces itself and is named by its own heading', async () => {
    // rejects: reverting to the bare overlay. Without role/aria-modal a screen
    // reader reads the page behind it as though it were still in play.
    await openEditor();
    const dialog = screen.getAllByRole('dialog')[0];
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Create New AI Prompt');
  });

  test('it has an × AND a bottom exit, and the bottom one is at the bottom', async () => {
    /*
      rejects: shipping one of the two. The owner's words on the set editor were
      "no x in upper right, or cancel bottom - add both. that should be pretty
      standard across our UX."

      Order, not geometry: jsdom returns zeroes for every rect, so a positional
      assertion here would pass against any stylesheet at all.
    */
    await openEditor();
    const x = screen.getByLabelText('Close the prompt editor');
    const cancel = screen.getByTestId('pmgr-editor-cancel');
    expect(x).toBeInTheDocument();
    expect(cancel).toBeInTheDocument();
    // eslint-disable-next-line no-bitwise
    expect(x.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('one requestClose, three ways in', () => {
  test('with nothing typed, the × just closes', async () => {
    // rejects: confirming an empty form, which trains people to click through
    // the confirmation they will one day need to read.
    await openEditor();
    fireEvent.click(screen.getByLabelText('Close the prompt editor'));
    await waitFor(() => expect(screen.queryByText('Create New AI Prompt')).not.toBeInTheDocument());
  });

  test('with work in hand, the × asks first', async () => {
    // rejects: an × that silently bins a half-written prompt.
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), {
      target: { value: 'You are a consultant. {topVotedAnswers}' },
    });
    fireEvent.click(screen.getByLabelText('Close the prompt editor'));
    expect(await screen.findByTestId('pmgr-discard-confirm')).toBeInTheDocument();
    expect(screen.getByText('Create New AI Prompt')).toBeInTheDocument();
  });

  test('with work in hand, Cancel asks the same question', async () => {
    /*
      rejects: the failure commit `4fd425d6` was written against — a second way
      out that skips the confirmation. Two exits that treat unsaved work
      differently is worse than one exit, because which one you reached for
      decides whether you keep an afternoon's work.
    */
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), { target: { value: 'draft' } });
    fireEvent.click(screen.getByTestId('pmgr-editor-cancel'));
    expect(await screen.findByTestId('pmgr-discard-confirm')).toBeInTheDocument();
  });

  test('"go back" returns to the form with the text still in it', async () => {
    // rejects: a confirmation that unmounts the editor whichever button is
    // pressed — the shape a confirm takes when it is bolted on afterwards.
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), { target: { value: 'half a prompt' } });
    fireEvent.click(screen.getByTestId('pmgr-editor-cancel'));
    fireEvent.click(await screen.findByTestId('pmgr-discard-keep'));
    await waitFor(() => expect(screen.queryByTestId('pmgr-discard-confirm')).not.toBeInTheDocument());
    expect(screen.getByTestId('prompt-input-textarea')).toHaveValue('half a prompt');
  });

  test('"close and lose it" is the only path that discards', async () => {
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), { target: { value: 'half a prompt' } });
    fireEvent.click(screen.getByTestId('pmgr-editor-cancel'));
    fireEvent.click(await screen.findByTestId('pmgr-discard-confirm'));
    await waitFor(() => expect(screen.queryByText('Create New AI Prompt')).not.toBeInTheDocument());
  });

  test('the confirmation says what is lost, not how serious it is', () => {
    // rejects: "Are you sure? This cannot be undone!" — the person already
    // knows discard is discard. RATIONALE §8: name what breaks.
    const jsx = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'components', 'AIPromptManager.jsx'), 'utf8',
    );
    expect(jsx).toMatch(/exists in this browser tab and nowhere else/);
    expect(jsx).not.toMatch(/cannot be undone!/);
  });
});

describe('Escape is gated on the work, not switched off', () => {
  test('a clean form closes on Escape', async () => {
    // rejects: `closeOnEscape={false}`, which is how a dialog ends up with no
    // keyboard exit at all on the argument that a draft needs protecting.
    await openEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Create New AI Prompt')).not.toBeInTheDocument());
  });

  test('a dirty form does not, and Escape does not even raise the question', async () => {
    /*
      rejects: a reflexive Escape binning a half-written prompt.

      The second assertion is the one that earns its place, and it was added
      because the first alone did not: with the gate removed, Escape reaches
      `requestClose`, which sees the dirty form and opens the discard
      confirmation — so the editor is still on screen and "is it still mounted?"
      passes against the broken version. The gate's actual job is to make
      Escape INERT while there is work in hand, so that a key pressed by reflex
      cannot put a destructive button under a reflexive second press.
    */
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), { target: { value: 'typed' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Create New AI Prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('pmgr-discard-confirm')).not.toBeInTheDocument();
  });
});

describe('the advisor got a way out of the bottom', () => {
  async function openAdvisor() {
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ prompts: [PROMPT] }) });
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTitle('Ask the AI advisor about this prompt'));
    await screen.findByText('AI Prompt Advisor');
  }

  test('it is a dialog with a name', async () => {
    await openAdvisor();
    const dialog = screen.getAllByRole('dialog')[0];
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/AI Prompt Advisor/);
  });

  test('the exit is after everything there is to read', async () => {
    /*
      rejects: the shipped state — an × in the header and nothing else beneath
      several screens of analysis. Asserted as document order because jsdom
      models order and models no geometry at all.
    */
    await openAdvisor();
    const body = screen.getByTestId('pmgr-advisor-body');
    const close = screen.getByTestId('pmgr-advisor-close');
    // eslint-disable-next-line no-bitwise
    expect(body.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the bottom exit actually closes it', async () => {
    // rejects: a decorative Cancel. A dead control is the one people reach for
    // first, so a rendered exit must be a wired exit.
    await openAdvisor();
    fireEvent.click(screen.getByTestId('pmgr-advisor-close'));
    await waitFor(() => expect(screen.queryByText('AI Prompt Advisor')).not.toBeInTheDocument());
  });

  test('the exit lives outside the region that scrolls', async () => {
    // rejects: putting the footer inside `.pmgr-advisor-body`, which is the
    // scrolling element — it would then be reachable only by scrolling to the
    // end of the analysis, which is the bug being fixed.
    await openAdvisor();
    const body = screen.getByTestId('pmgr-advisor-body');
    expect(body).not.toContainElement(screen.getByTestId('pmgr-advisor-close'));
  });
});

describe('the two destructive paths ask a question worth reading', () => {
  async function openArchive() {
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ prompts: [PROMPT] }) });
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTestId(`plib-retire-${PROMPT.promptId}`));
    return dialogNamed('Retire');
  }

  test('nothing is deleted before the question is answered', async () => {
    // rejects: firing the DELETE from the row and asking afterwards.
    await openArchive();
    expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'DELETE')).toBe(false);
  });

  test('it names the prompt, the default it demotes and the sets that pin it', async () => {
    /*
      rejects: "Are you sure you want to archive this prompt?" — the shipped
      copy, which named none of the three. "Count before you ask": the numbers
      that decide this are in hand before the click.
    */
    const dialog = await openArchive();
    expect(dialog.textContent).toContain('Lessons Learned');
    expect(within(dialog).getByTestId('pmgr-archive-default').textContent)
      .toMatch(/default Call & Answer summary prompt/);
    expect(within(dialog).getByTestId('pmgr-archive-pinned').textContent)
      .toMatch(/3 question sets pin this prompt/);
  });

  test('it offers the reversible neighbour, and that button opens the editor', async () => {
    /*
      rejects: a dialog that only offers the destructive option. Nine times in
      ten "archive this" means "stop offering it", which Draft already does —
      naming the non-destructive alternative inside the destructive dialog
      prevents more damage than any amount of red (RATIONALE §8).
    */
    const dialog = await openArchive();
    fireEvent.click(within(dialog).getByTestId('pmgr-archive-draft'));
    expect(await screen.findByText('Edit AI Prompt')).toBeInTheDocument();
    expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'DELETE')).toBe(false);
  });

  test('confirming retires it', async () => {
    const dialog = await openArchive();
    fireEvent.click(within(dialog).getByTestId('pmgr-archive-confirm'));
    await waitFor(() =>
      expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'DELETE')).toBe(true));
  });

  test('populate-defaults states the overwrite rule the lambda actually uses', async () => {
    /*
      rejects: the old line, "Existing prompts will be overwritten", which reads
      as "the ones I did not write". `populate-defaults.js:102` matches on
      `item.name === promptData.name` and this call sends `overwrite: true`, so
      the consequence is same name, same id, different text — and one built-in
      per engagement type carries isDefault, so the current default is demoted.
    */
    render(<AIPromptManager />);
    // Wait for the fetch to settle: the control is `disabled={loading}`, and a
    // click on a disabled button is silently nothing.
    await screen.findByTestId('plib-empty');
    fireEvent.click(screen.getByText(/Populate Default Prompts/i));
    const dialog = dialogNamed('Rewrite the built-in prompts');
    expect(dialog.textContent).toMatch(/matches on/i);
    expect(dialog.textContent).toMatch(/keeping its id/);
    expect(dialog.textContent).toMatch(/demoted/);
    expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'POST')).toBe(false);

    fireEvent.click(within(dialog).getByTestId('pmgr-populate-confirm'));
    await waitFor(() =>
      expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'POST')).toBe(true));
  });
});

/*
  CLICKING THE CHIP ACTUALLY CHANGES THE PROMPT.

  The panel's own tests pin what the chip sends its caller; these pin what the
  caller does with it — the round trip, the one field on the wire, and the two
  states the screen can end up in when it fails.

  The default case is the interesting one and it is the reverse of the obvious
  fear. `findDefaultPromptId` (get-ai-summary.js:326-345) selects on `isDefault`
  alone and never reads `status`, so a default set to Draft KEEPS RUNNING for
  every set of its engagement type. Drafting it only removes it from the
  question-set prompt picker (AdminPage.js:238 keeps `status === 'active'`).
  A row that reads Draft while the rooms still hear it is worth a sentence
  first, so it warns — and warns with the true consequence, not the scary one.
*/
describe('the status chip changes the prompt', () => {
  /** The library with one row in the given state, ready to click. */
  async function listing(overrides = {}) {
    const prompt = { ...PROMPT, ...overrides };
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ prompts: [prompt] }) });
    render(<AIPromptManager />);
    await screen.findByText('Lessons Learned');
    return prompt;
  }

  /** Every PUT this test made, with its parsed body. */
  const puts = () => authFetch.mock.calls
    .filter((c) => c[1] && c[1].method === 'PUT')
    .map((c) => ({ url: c[0], body: JSON.parse(c[1].body) }));

  test('deactivating a plain prompt PUTs status and nothing else', async () => {
    /*
      rejects: sending the whole record back. `PUT /admin/ai-prompts/{id}`
      treats every absent field as "leave alone", and re-sending a row built
      from the LIST response — which carries no instructions or outputFormat
      unless `includeContent` resolved them — would rewrite the prompt's text
      with whatever the list happened to hold.

      rejects: hitting the DELETE (archive) route, which is the same outcome as
      the button three cells over.
    */
    await listing({ isDefault: false, status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].url).toMatch(/admin\/ai-prompts\/p1$/);
    expect(puts()[0].body).toEqual({ status: 'draft' });
    expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'DELETE')).toBe(false);
  });

  test('the row follows the write, and only after it lands', async () => {
    /*
      rejects: an optimistic flip. AdminPage's question-set toggle updates the
      local row AFTER the response for a reason — an optimistic chip spends the
      moment of a failure showing the wrong answer, and this column is the one
      people read to find out what the AI will say to a room.
    */
    await listing({ isDefault: false, status: 'active' });

    let settle;
    authFetch.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    // In flight: still Active, and not clickable a second time.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Active' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(puts()).toHaveLength(1);

    settle({ ok: true, json: async () => ({ status: 'updated' }) });
    expect(await screen.findByRole('button', { name: 'Draft' })).toBeEnabled();
  });

  test('a refused change says so and leaves the row telling the truth', async () => {
    /*
      rejects: swallowing the failure, and rejects reverting a chip that was
      never moved. The banner has to say WHICH state the prompt is still in,
      because the row is the only other thing on screen making that claim.
    */
    await listing({ isDefault: false, status: 'active' });
    authFetch.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ message: 'stored content could not be read' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    const banner = await screen.findByTestId('pmgr-notice');
    expect(banner.textContent).toMatch(/was not changed/);
    expect(banner.textContent).toMatch(/stored content could not be read/);
    expect(banner.textContent).toMatch(/still Active/);
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();
  });

  test('deactivating the DEFAULT asks first, and nothing is written until it is answered', async () => {
    // rejects: firing the PUT from the row and explaining afterwards.
    await listing({ isDefault: true, status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    const dialog = dialogNamed('Set “Lessons Learned” to Draft');
    expect(dialog).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  test('the default warning says Draft does NOT stop it running', async () => {
    /*
      rejects: the plausible copy — "this leaves the engagement type with no
      default, so those sets get no summary". That is what archiving is
      documented to do and it is NOT what drafting does: the resolver never
      reads status, so the prompt keeps running and only leaves the picker.
      Telling an admin the opposite of what the engine does is how they retire
      a prompt, walk away, and hear it again in the next session.
    */
    await listing({ isDefault: true, status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    const warning = screen.getByTestId('pmgr-draft-still-runs');
    expect(warning.textContent).toMatch(/does not stop it running/i);
    expect(warning.textContent).toMatch(/never looks at status/i);
    // And the real exit is named, so the dialog is not just a shrug.
    const dialog = dialogNamed('Set “Lessons Learned” to Draft');
    expect(dialog.textContent).toMatch(/make.*that.*one the default/i);
  });

  test('leaving it Active writes nothing; confirming writes the draft', async () => {
    await listing({ isDefault: true, status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    fireEvent.click(screen.getByTestId('pmgr-draft-cancel'));
    expect(puts()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    fireEvent.click(screen.getByTestId('pmgr-draft-confirm'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ status: 'draft' });
  });

  test('re-activating the default does not ask — only the deactivation is surprising', async () => {
    // rejects: gating both directions on the dialog. Turning a prompt back on
    // does exactly what it looks like, and a confirmation on a harmless action
    // is what trains people to click through the one that matters.
    await listing({ isDefault: true, status: 'draft' });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ status: 'active' });
    expect(screen.queryByTestId('pmgr-draft-confirm')).toBeNull();
  });
});

describe('failures are reported on the surface they happened to', () => {
  test('a failed list load says the list is unknown, not empty', async () => {
    /*
      rejects: the `alert('Failed to load prompts')` this replaced. Dismissing
      it left `PromptLibraryPanel`'s "No prompts yet — create your first one"
      poster on screen, which is an outage rendered as an empty collection with
      a Create button as the suggested next step: the empty state that lies.
    */
    authFetch.mockRejectedValueOnce(new Error('502 Bad Gateway'));
    render(<AIPromptManager />);
    const banner = await screen.findByTestId('pmgr-notice');
    expect(banner.textContent).toMatch(/could not be loaded/);
    expect(banner.textContent).toMatch(/not because there are no prompts/);
  });

  test('a failed save leaves the editor open and says nothing was written', async () => {
    /*
      rejects: `alert('Failed to update prompt: …')`. It blocked the window,
      stated the severity, and left nothing behind — so a failed save looked
      exactly like a save that had not been pressed yet.
    */
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), {
      target: { value: 'You are a consultant.\n\nResponses: {topVotedAnswers}\n{voteTally}' },
    });
    // Prose, not [brackets]: the bracket-direction preflight finding blocks
    // the save button, and this test is about the FAILED-SAVE banner, not the
    // guard — the fixture has to be clean to reach the save at all.
    fireEvent.change(screen.getByTestId('prompt-output-textarea'), {
      target: { value: '## Summary\nWhat was asked, and what the room said.' },
    });
    // By DOM, not by label: the editor's labels are not `htmlFor`-associated,
    // which is its own defect and not one this change is fixing.
    fireEvent.change(document.querySelector('.prompt-editor-form input[type="text"]'), {
      target: { value: 'A prompt' },
    });
    await waitFor(() => expect(screen.getByText('Create Prompt')).not.toBeDisabled());

    authFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    fireEvent.click(screen.getByText('Create Prompt'));

    const banner = await screen.findByTestId('pmgr-editor-notice');
    expect(banner.textContent).toMatch(/Nothing was saved/);
    expect(banner.textContent).toMatch(/still in this form and nowhere else/);
    expect(screen.getByText('Create New AI Prompt')).toBeInTheDocument();
  });

  test('a failed generation says both halves are untouched', async () => {
    /*
      rejects: `alert('Failed to generate AI prompt: …')`. The wand rewrites
      both halves on success, so "it failed" is ambiguous in the one way that
      matters — whether it half-rewrote them. The banner says.
    */
    await openEditor();
    fireEvent.change(screen.getByTestId('prompt-input-textarea'), { target: { value: 'mine' } });

    authFetch.mockRejectedValueOnce(new Error('bedrock timeout'));
    fireEvent.click(screen.getByText(/AI Generate/));

    const banner = await screen.findByTestId('pmgr-editor-notice');
    expect(banner.textContent).toMatch(/wrote nothing/);
    expect(screen.getByTestId('prompt-input-textarea')).toHaveValue('mine');
  });
});

/**
 * TWO BUTTONS, TWO ARCHIVES, AND THE ROW USED TO OFFER ONLY THE WRONG ONE.
 *
 * The owner pressed the row's "Archive" expecting a copy and got a soft delete:
 * *"the new archive button in the prompts admin list shouldnt take it out of
 * the list, it should just put a copy in the archive"*.
 *
 * The two operations share no route, no verb and no outcome:
 *
 *   Copy to archive   POST admin/export-to-archive  -> a copy in the SHARED
 *                                                      cross-tier archive. The
 *                                                      prompt is untouched.
 *   Retire            DELETE admin/ai-prompts/{id}  -> status archived, row
 *                                                      gone, nothing copied.
 *
 * Everything below is about keeping them told apart, because the failure that
 * prompted it was entirely a naming failure.
 */
describe('copy to archive is not retire', () => {
  const seedList = () =>
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ prompts: [PROMPT] }) });

  const exportCalls = () =>
    authFetch.mock.calls.filter((c) => String(c[0]).includes('export-to-archive'));

  async function clickCopy() {
    fireEvent.click(await screen.findByTestId(`plib-copy-archive-${PROMPT.promptId}`));
  }

  test('it POSTs the export route with this one prompt, and no DELETE', async () => {
    /*
      rejects: wiring the new button to `onDelete` — the exact bug being fixed,
      which from the outside looks like a working button.
    */
    seedList();
    authFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { successful: [{ id: PROMPT.promptId }], failed: [] } }),
    });
    render(<AIPromptManager />);
    await clickCopy();

    await waitFor(() => expect(exportCalls().length).toBe(1));
    const [, init] = exportCalls()[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ selectedItems: ['p1'], exportType: 'prompts' });
    // rejects: copying AND retiring, which would be the worst of both.
    expect(authFetch.mock.calls.some((c) => c[1] && c[1].method === 'DELETE')).toBe(false);
  });

  test('it asks nothing first — a copy is not a destructive act', async () => {
    // rejects: reusing the retire confirmation for the copy, which would train
    // people to click through the dialog that does matter.
    seedList();
    authFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { successful: [{ id: PROMPT.promptId }], failed: [] } }),
    });
    render(<AIPromptManager />);
    await clickCopy();
    await waitFor(() => expect(exportCalls().length).toBe(1));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  test('the row survives the copy', async () => {
    // rejects: refetching into an empty list, or optimistically dropping the
    // row. "shouldnt take it out of the list" is the whole request.
    seedList();
    authFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { successful: [{ id: PROMPT.promptId }], failed: [] } }),
    });
    render(<AIPromptManager />);
    await clickCopy();
    await waitFor(() => expect(exportCalls().length).toBe(1));
    expect(await screen.findByTestId(`plib-copy-archive-${PROMPT.promptId}`)).toBeInTheDocument();
    expect(screen.getByText('Lessons Learned')).toBeInTheDocument();
  });

  test('a 200 carrying a per-item failure is reported as a failure', async () => {
    /*
      rejects: branching on `response.ok` alone. `export-to-archive` answers 200
      with `{ results: { successful, failed } }`, so the em-dash failure — the
      one that kept four trivia prompts out of the archive for a day — arrives
      as a success with a populated `failed` array. Reporting that as "copied"
      is how "export completed, 0 items exported" happened.
    */
    seedList();
    authFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: { successful: [], failed: [{ id: 'p1', error: 'the title contains "—" (U+2014).' }] },
      }),
    });
    render(<AIPromptManager />);
    await clickCopy();
    expect(await screen.findByText(/U\+2014/)).toBeInTheDocument();
    expect(screen.queryByText(/was copied to the shared archive/)).not.toBeInTheDocument();
  });

  test('a 200 with neither list populated does not claim a copy', async () => {
    // rejects: treating "no failures" as "succeeded". No evidence of a copy is
    // not evidence of a copy.
    seedList();
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: {} }) });
    render(<AIPromptManager />);
    await clickCopy();
    expect(await screen.findByText(/no error and no copy/)).toBeInTheDocument();
  });

  test('a failed copy says the prompt is unchanged', async () => {
    // rejects: a bare error string. After pressing a button whose old namesake
    // deleted things, "what happened to my prompt" is the first question.
    seedList();
    authFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
    render(<AIPromptManager />);
    await clickCopy();
    expect(await screen.findByText(/still in this list/)).toBeInTheDocument();
  });

  test('the two buttons do not share a word', async () => {
    /*
      rejects: leaving the destructive control labelled "Archive" beside a
      control that genuinely archives. This is the assertion that fails if
      anyone renames Retire back.
    */
    seedList();
    render(<AIPromptManager />);
    const retire = await screen.findByTestId(`plib-retire-${PROMPT.promptId}`);
    const copy = screen.getByTestId(`plib-copy-archive-${PROMPT.promptId}`);
    expect(retire.textContent).toBe('Retire');
    expect(retire.textContent.toLowerCase()).not.toContain('archive');
    expect(copy.textContent).toMatch(/Copy to archive/);
    // ...and the destructive one still says, on hover, that it copies nothing.
    expect(retire.getAttribute('title')).toMatch(/not copied to the archive/i);
  });

  test('the retire dialog no longer claims a retired default stops running', async () => {
    /*
      rejects: the shipped copy, "Archiving it leaves that engagement type with
      no default at all, so every set of that type gets no summary". False:
      `findDefaultPromptId` (game/get-ai-summary.js:326-345) selects on
      `isDefault === true` and never reads `status`, so the prompt keeps running.
      A warning that overstates is a warning people learn to disbelieve.
    */
    seedList();
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTestId(`plib-retire-${PROMPT.promptId}`));
    const text = (await screen.findByTestId('pmgr-archive-default')).textContent;
    expect(text).toMatch(/does not stop it running/i);
    expect(text).not.toMatch(/no default at all/);
  });
});
