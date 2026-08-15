/**
 * The prompt editor's variable palette, and the author-time warning.
 *
 * Three shipped defects live here:
 *
 *  1. The palette iterated a HARDCODED list of category headers that omitted
 *     'Wavelength'. All six wavelength variables were declared and none was
 *     ever rendered — a wavelength author had no chips at all beyond the
 *     generic ones.
 *  2. That same list included 'Context', which no variable declares, so the
 *     branch was dead.
 *  3. The list filter's category dropdown offered only call-and-answer
 *     categories, while the editor's own select next to it derives them per
 *     game type.
 *
 * Plus the first of the three variable gates: an author typing an invented
 * {token} should be told so immediately. A warning, not a wall — the wall is
 * the save handler, which is the gate both AI helpers pass through.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';
import { TEMPLATE_VARIABLES } from '../config/templateVariables';

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ prompts: [] }) });
});

/** Mount the manager and open the create-prompt editor. */
async function openEditor() {
  render(<AIPromptManager />);
  await waitFor(() => expect(screen.getByText('Create New Prompt')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Create New Prompt'));
  await screen.findByText('Create New AI Prompt');
}

const palette = () => document.querySelector('.template-variables-panel');
const headers = () =>
  [...document.querySelectorAll('.category-header')].map((h) => h.textContent.trim());
const chipNames = () =>
  [...document.querySelectorAll('.variable-btn')].map((b) => b.textContent.trim());

const setGameType = (value) => {
  const select = document.querySelector('.prompt-editor-form select');
  fireEvent.change(select, { target: { value } });
};

describe('the variable palette is derived from the catalogue', () => {
  test('every catalogued variable gets a chip', async () => {
    await openEditor();
    const rendered = chipNames();
    const missing = TEMPLATE_VARIABLES
      .map((v) => `{${v.name}}`)
      .filter((token) => !rendered.some((r) => r.includes(token)));
    expect(missing).toEqual([]);
  });

  test('Wavelength is a rendered header, so its variables are reachable', async () => {
    await openEditor();
    expect(headers()).toContain('Wavelength');
    expect(chipNames().some((n) => n.includes('{commonWords}'))).toBe(true);
  });

  test('no header is rendered that has no variables under it', async () => {
    await openEditor();
    for (const header of headers()) {
      const group = [...document.querySelectorAll('.variable-category')]
        .find((el) => el.querySelector('.category-header').textContent.trim() === header);
      expect(within(group).getAllByRole('button').length).toBeGreaterThan(0);
    }
    // 'Context' was in the hardcoded list and is declared by nothing.
    expect(headers()).not.toContain('Context');
  });

  test('a poll author can reference the options', async () => {
    await openEditor();
    setGameType('poll');
    const chip = [...document.querySelectorAll('.variable-btn')]
      .find((b) => b.textContent.includes('{pollOptions}'));
    expect(chip).toBeTruthy();
    expect(chip).not.toBeDisabled();
  });

  test('a variable belonging to another game type is offered but disabled', async () => {
    await openEditor();
    setGameType('poll');
    const chip = [...document.querySelectorAll('.variable-btn')]
      .find((b) => b.textContent.includes('{correctAnswer}'));
    expect(chip).toBeDisabled();
  });

  /*
    THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal is the fix.

    It read "clicking a chip inserts its token into the output format", because
    the editor held ONE textarea ref — the output format's — so that was the
    only place a variable could land. That is the mechanical half of the defect
    the redesign exists for: the half of the prompt that carries the round's
    data could only ever be filled by typing, while every affordance on the
    screen pointed at the half that describes the reply. The prompt that broke a
    live session was built exactly that way.

    rejects: restoring a single insertion target, and restoring the output
    format as the default one. The two tests below are the pair — the default
    lands in the input half, and focus moves it.
  */
  test('clicking a chip inserts into the half that carries the data, by default', async () => {
    await openEditor();
    const given = screen.getByTestId('prompt-input-textarea');
    const writes = screen.getByTestId('prompt-output-textarea');
    fireEvent.change(given, { target: { value: '' } });
    fireEvent.change(writes, { target: { value: '' } });

    const chip = [...document.querySelectorAll('.variable-btn')]
      .find((b) => b.textContent.includes('{eventTitle}'));
    fireEvent.click(chip);

    await waitFor(() => expect(given.value).toContain('{eventTitle}'));
    expect(writes.value).not.toContain('{eventTitle}');
  });

  test('focusing the output half moves the target there', async () => {
    // rejects: hardcoding the input half as the only target, which would make
    // the output format unfillable from the palette — the same defect mirrored.
    await openEditor();
    const given = screen.getByTestId('prompt-input-textarea');
    const writes = screen.getByTestId('prompt-output-textarea');
    fireEvent.change(given, { target: { value: '' } });
    fireEvent.change(writes, { target: { value: '' } });

    fireEvent.focus(writes);
    const chip = [...document.querySelectorAll('.variable-btn')]
      .find((b) => b.textContent.includes('{eventTitle}'));
    fireEvent.click(chip);

    await waitFor(() => expect(writes.value).toContain('{eventTitle}'));
    expect(given.value).not.toContain('{eventTitle}');
  });

  test('the palette names the half it is aimed at, and the name follows focus', async () => {
    // rejects: moving the target silently. An insertion that lands somewhere
    // the author is not looking is indistinguishable from one that did nothing.
    await openEditor();
    expect(screen.getByTestId('pvi-insert-target')).toHaveTextContent('What the AI is given');
    fireEvent.focus(screen.getByTestId('prompt-output-textarea'));
    expect(screen.getByTestId('pvi-insert-target')).toHaveTextContent('What the AI writes');
  });

  test('a variable is inserted at the cursor, not appended', async () => {
    // rejects: the `current + token` shortcut. An author who has written a
    // labelled block and clicks back into the middle of it gets the token at
    // the end of the field, which reads as the click having failed.
    await openEditor();
    const given = screen.getByTestId('prompt-input-textarea');
    fireEvent.change(given, { target: { value: 'Question: \nResponses: ' } });
    given.setSelectionRange(10, 10);
    fireEvent.focus(given);

    const chip = [...document.querySelectorAll('.variable-btn')]
      .find((b) => b.textContent.includes('{questionInfo}'));
    fireEvent.click(chip);

    await waitFor(() => expect(given.value).toBe('Question: {questionInfo}\nResponses: '));
  });
});

describe('gate 1 — the author is warned about an invented token', () => {
  /*
    ADDRESSED BY testid, NOT BY POSITION OR BY `rows`.

    These two used to be `.template-textarea-container textarea[0]` and
    "whichever textarea has rows=4" — both incidental. The second in particular
    would have silently started matching the description field the day anybody
    changed a row count, and a test that reads the wrong field passes for the
    wrong reason. The halves carry stable ids now.
  */
  const outputFormatField = () => screen.getByTestId('prompt-output-textarea');
  const instructionsField = () => screen.getByTestId('prompt-input-textarea');

  test('an unknown token is named under the field', async () => {
    await openEditor();
    fireEvent.change(outputFormatField(), {
      target: { value: '## Summary\n{wordFrequency} and {leaderboard}' },
    });
    const warning = await screen.findByTestId('unknown-variable-warning');
    expect(warning).toHaveTextContent('{wordFrequency}');
    // A variable that resolves must not be listed, or the warning is noise.
    expect(warning).not.toHaveTextContent('{leaderboard}');
  });

  test('the warning covers the instructions field too', async () => {
    await openEditor();
    fireEvent.change(instructionsField(), { target: { value: 'Given {vibeCheck}, summarise.' } });
    expect(await screen.findByTestId('unknown-variable-warning')).toHaveTextContent('{vibeCheck}');
  });

  test('an internal variable is not reported — live prompts use them', async () => {
    await openEditor();
    fireEvent.change(outputFormatField(), { target: { value: '{totalPlayers} played' } });
    await waitFor(() => expect(outputFormatField().value).toContain('totalPlayers'));
    expect(screen.queryByTestId('unknown-variable-warning')).toBeNull();
  });

  test('nothing is warned about when every token resolves', async () => {
    await openEditor();
    fireEvent.change(outputFormatField(), { target: { value: '## Summary\n{responsesText}' } });
    await waitFor(() => expect(outputFormatField().value).toContain('responsesText'));
    expect(screen.queryByTestId('unknown-variable-warning')).toBeNull();
  });

  test('a JSON example is not mistaken for a variable', async () => {
    await openEditor();
    fireEvent.change(outputFormatField(), { target: { value: 'Reply as { "verdict": "x" }' } });
    await waitFor(() => expect(outputFormatField().value).toContain('verdict'));
    expect(screen.queryByTestId('unknown-variable-warning')).toBeNull();
  });

  /*
    THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal is deliberate.

    It read "the warning is a warning, not a wall — save stays enabled", on the
    reasoning that the wall was the save handler and blocking here would only
    stop the one person who can already see the problem. That reasoning stood
    while this warning was the ONLY author-time check. It does not stand now:
    `utils/promptPreflight.js` classifies an unresolvable token as `blocking`,
    for the reason its own detail text gives — `assertTemplateVariablesExist`
    refuses the write, so leaving the button live only buys a round trip that
    is guaranteed to 400. The warning copy has always said so out loud: "the
    prompt will be rejected when you save."

    rejects: dropping `saveBlocked` out of the submit button's `disabled`, and
    also dropping the `if (saveBlocked) return` guard in handleSubmit — a
    disabled submit button does not stop Enter-in-a-text-input from submitting
    the form, which is how a "blocked" save ships anyway.
  */
  test('an unresolvable token now blocks the save, and the block is stated', async () => {
    await openEditor();
    fireEvent.change(outputFormatField(), { target: { value: '{wordFrequency}' } });
    await screen.findByTestId('unknown-variable-warning');
    expect(screen.getByText('Create Prompt')).toBeDisabled();
    expect(await screen.findByTestId('save-blocked-note')).toBeInTheDocument();
  });

  test('a prompt with only resolvable tokens still saves', async () => {
    // The other half, so the block above cannot quietly become "always
    // blocked". rejects: disabling the button on any finding rather than on a
    // blocking one — the silent tier must never stop a save.
    await openEditor();
    fireEvent.change(instructionsField(), { target: { value: 'You are an advisor.' } });
    fireEvent.change(outputFormatField(), { target: { value: '## Summary\n{responsesText}' } });
    await waitFor(() => expect(outputFormatField().value).toContain('responsesText'));
    expect(screen.getByText('Create Prompt')).not.toBeDisabled();
    expect(screen.queryByTestId('save-blocked-note')).toBeNull();
  });
});

describe('the list filter derives its categories from the selected game type', () => {
  const filterSelects = () => [...document.querySelectorAll('.prompt-filters select')];
  const categoryOptions = () =>
    [...filterSelects()[1].querySelectorAll('option')].map((o) => o.value);

  test('trivia categories replace the call-and-answer ones', async () => {
    render(<AIPromptManager />);
    await waitFor(() => expect(screen.getByText('Create New Prompt')).toBeInTheDocument());

    fireEvent.change(filterSelects()[0], { target: { value: 'trivia' } });
    const options = categoryOptions();
    expect(options).toContain('technology');
    expect(options).not.toContain('lessons-learned');
  });

  test('wavelength categories are offered at all', async () => {
    render(<AIPromptManager />);
    await waitFor(() => expect(screen.getByText('Create New Prompt')).toBeInTheDocument());

    fireEvent.change(filterSelects()[0], { target: { value: 'wavelength' } });
    expect(categoryOptions()).toContain('word-association');
  });

  test('"All Game Types" offers every category, so nothing becomes unreachable', async () => {
    render(<AIPromptManager />);
    await waitFor(() => expect(screen.getByText('Create New Prompt')).toBeInTheDocument());

    const options = categoryOptions();
    expect(options).toContain('all');
    expect(options).toContain('lessons-learned');
    expect(options).toContain('word-association');
    expect(options).toContain('technology');
  });
});
