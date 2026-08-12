/**
 * THE DEFAULT CHECKBOX, AND THE WIRING — components/AIPromptManager.jsx
 *
 * WHAT THE CHECKBOX ACTUALLY DOES, which the screen used to say nothing about.
 * The label read "Set as default prompt for this category" and it is wrong in
 * the direction that matters:
 *
 *   - create-ai-prompt.js:230 and update-ai-prompt.js:255 clear `isDefault`
 *     from every other prompt of this GAME TYPE, not this category. That is
 *     deliberate: `findDefaultPromptId` (get-ai-summary.js:344-352) looks the
 *     default up by game type alone, and per-category defaults once produced
 *     seven simultaneous call-and-answer "defaults" and an arbitrary winner.
 *   - So ticking the box demotes whatever is default now, in the same write,
 *     with no record of which prompt it was.
 *   - Un-ticking it later does not restore that prompt: update-ai-prompt.js:320
 *     deletes the lookup row and puts nothing back, leaving the engagement type
 *     with no default at all.
 *
 * One mocked module — `../auth/authFetch` — and no AuthProvider, because
 * AIPromptManager does not call `useAuth`. The SessionsPanel pattern.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ prompts: [] }) });
});

async function openEditor() {
  render(<AIPromptManager />);
  await waitFor(() => expect(screen.getByText('Create New Prompt')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Create New Prompt'));
  await screen.findByText('Create New AI Prompt');
}

const defaultCheckbox = () =>
  document.querySelector('.default-group input[type="checkbox"]');

const setGameType = (value) => {
  fireEvent.change(document.querySelector('.prompt-editor-form select'), { target: { value } });
};

describe('the blast radius is stated at the point of the decision', () => {
  test('the consequence appears the moment the box is ticked', async () => {
    // rejects: leaving the consequence in a tooltip, a help link, or a
    // confirmation after submit. The decision is made at the checkbox and
    // nowhere else; a warning further down the page is read after the choice.
    await openEditor();
    expect(screen.queryByTestId('default-blast-warning')).toBeNull();
    fireEvent.click(defaultCheckbox());
    expect(await screen.findByTestId('default-blast-warning')).toBeInTheDocument();
  });

  test('it names the engagement type, and it is every set of that type', async () => {
    // rejects: the old copy, "Set as default prompt for this category". The
    // scope is the game type; saying "category" understates the blast radius by
    // however many categories that type has — eight, for call-and-answer.
    await openEditor();
    setGameType('trivia');
    // The label itself, first: it is the sentence somebody reads while deciding,
    // and it used to be the wrong one.
    const group = document.querySelector('.default-group');
    expect(group.querySelector('label').textContent).toMatch(/default Trivia summary prompt/);
    expect(group.querySelector('label').textContent).not.toMatch(/category/i);

    fireEvent.click(defaultCheckbox());
    const warning = await screen.findByTestId('default-blast-warning');
    expect(warning.textContent).toContain('Trivia');
    expect(warning.textContent).toMatch(/every/i);
    expect(warning.textContent).not.toMatch(/this category/i);
  });

  test('it says the current default is demoted and cannot be put back', async () => {
    // rejects: warning only that "this becomes the default" — which sounds
    // additive. The write is a swap, it names nothing, and un-ticking the box
    // later leaves the engagement type with NO default rather than the old one.
    await openEditor();
    fireEvent.click(defaultCheckbox());
    const warning = await screen.findByTestId('default-blast-warning');
    expect(warning.textContent).toMatch(/demoted/i);
    expect(warning.textContent).toMatch(/does not put it back/i);
  });

  test('it is announced, not just drawn', async () => {
    // rejects: dropping role="alert". The block appears in response to a click
    // that moves focus nowhere, so a screen reader is otherwise never told the
    // page grew a consequence.
    await openEditor();
    fireEvent.click(defaultCheckbox());
    expect(await screen.findByTestId('default-blast-warning')).toHaveAttribute('role', 'alert');
  });

  test('the standing note is there before anything is ticked', async () => {
    // rejects: hiding the scope until the box is on. Someone deciding WHETHER
    // to tick it needs to know what it does first.
    await openEditor();
    expect(document.querySelector('.default-blast-note').textContent)
      .toMatch(/exactly one default per engagement type/i);
  });
});

describe('a blocked save is blocked by more than a disabled button', () => {
  test('submitting the form directly sends nothing', async () => {
    // rejects: deleting the `if (saveBlocked) return` guard in handleSubmit and
    // relying on `disabled` alone. Pressing Enter in any text input submits a
    // form whose submit button is disabled — the browser does not consult it —
    // so without the guard a "blocked" save reaches the API, 400s on
    // assertTemplateVariablesExist, and surfaces as an alert() the author
    // cannot act on.
    await openEditor();
    fireEvent.change(document.querySelectorAll('.template-textarea-container textarea')[0], {
      target: { value: '{wordFrequency}' },
    });
    await screen.findByTestId('save-blocked-note');

    const callsBefore = authFetch.mock.calls.length;
    fireEvent.submit(document.querySelector('.prompt-editor-form'));
    await waitFor(() => expect(screen.getByTestId('save-blocked-note')).toBeInTheDocument());
    expect(authFetch.mock.calls.length).toBe(callsBefore);
  });
});

describe('the three new surfaces are actually wired into the editor', () => {
  /*
    Rendered rather than source-asserted. AIPromptManager mounts in jsdom on
    its own — it does not call `useAuth` — so the wiring can be exercised for
    real, which a `*CallSite.test.js` regex cannot: a source assertion here
    would pass on the import line with the JSX deleted.
  */
  test('the preflight panel, the preview and the inspector are all present', async () => {
    // rejects: deleting any one of the three from the form, or leaving them
    // rendered only behind a toggle that defaults to off.
    await openEditor();
    expect(screen.getByTestId('prompt-variable-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-assembled-preview')).toBeInTheDocument();
    expect(
      screen.queryByTestId('prompt-preflight-panel') || screen.queryByTestId('prompt-preflight-absent')
    ).toBeInTheDocument();
  });

  test('typing in the output format changes the substituted preview', async () => {
    // rejects: rendering a static example, or passing `prompt` instead of
    // `formData` to the preview — either would show a preview that never moves
    // while the author edits, which is the state the editor was already in.
    await openEditor();
    const outputFormat = document.querySelectorAll('.template-textarea-container textarea')[0];
    fireEvent.change(outputFormat, { target: { value: 'If {responseCount} is 0, stop.' } });
    await waitFor(() =>
      expect(screen.getByTestId('pap-body').textContent).toContain('If 8 is 0, stop.'));
    expect(screen.getByTestId('pap-body').textContent).not.toContain('{responseCount}');
  });

  test('the inspector and the preview share one sample room', async () => {
    // rejects: giving each component its own room-size state. Two different
    // sample sets on one screen — a variable row saying one thing and the
    // preview substituting another — would be a worse lie than showing none.
    await openEditor();
    const outputFormat = document.querySelectorAll('.template-textarea-container textarea')[0];
    fireEvent.change(outputFormat, { target: { value: '{responseCount} answered' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nobody answered' }));
    await waitFor(() =>
      expect(screen.getByTestId('pap-body').textContent).toContain('0 answered'));

    const row = screen.getByTestId('pvi-row-responseCount');
    fireEvent.click(row.querySelector('.pvi-more'));
    expect(row.querySelector('.pvi-sample').textContent).toBe('0');
  });

  test('the preflight is told which model will read the prompt', async () => {
    // rejects: dropping `targetModel`. §D.1 of the dry run is binding — the
    // summaries run on Haiku 4.5 (get-ai-summary.js:2267), and a prompt that
    // behaves on a large model is not evidence about that one. Source-asserted
    // with COMMENTS STRIPPED FIRST: a previous test in this repo passed on a
    // comment, and this file's own header names the model twice.
    const fs = require('fs');
    const path = require('path');
    const src = fs
      .readFileSync(path.join(__dirname, '..', 'components', 'AIPromptManager.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/targetModel:\s*SUMMARY_MODEL_ID/);
    expect(src).toMatch(/SUMMARY_MODEL_ID\s*=\s*'claude-haiku-4-5-20251001'/);
  });
});
