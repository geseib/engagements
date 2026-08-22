/**
 * THE TWO HALVES — components/AIPromptManager.jsx
 *
 * THE DEFECT THIS SCREEN IS BEING REBUILT FOR. A live call-and-answer round
 * produced this summary, verbatim:
 *
 *   "I'm ready to facilitate this leadership principles review as Jeff Bezos
 *    and Andy Jassy. However, I notice you haven't provided the [Summary of the
 *    core idea/response being analyzed] yet."
 *
 * A player HAD answered. The prompt's only variables were {questionTitle} and
 * {questionDetail} — nothing carrying the responses — and its output format was
 * full of `[bracketed]` text that reads like a placeholder and is prose. So the
 * model got a persona, a question, a layout telling it to critique an answer,
 * and no answer, and it politely asked for one. That reply was stored and shown
 * to the room. Nothing errored and nothing was logged.
 *
 * Three separate things had to be true for that to happen, and each has a test
 * below:
 *
 *   1. The editor never said which half carries data. Both labels described the
 *      form — "General Instructions", "Output Format" — and neither said the
 *      first is where the round goes.
 *   2. The variable palette could only insert into the OUTPUT half. It held one
 *      textarea ref. Filling the input half meant typing.
 *   3. The preflight rule written to catch exactly this — `no-answer-variable`,
 *      shipped in e8c167d1 — was never reached, because the editor's call site
 *      did not pass `promptType` and the rule is gated on it.
 *
 * (3) is the one that matters most and is the one no existing test could see:
 * `promptPreflight.test.js` exercises the rule with an explicit promptType, so
 * the MODULE was green while the SCREEN was unprotected. That is the standing
 * landmine "test the call site, not just the module", reproduced exactly.
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

const given = () => screen.getByTestId('prompt-input-textarea');
const writes = () => screen.getByTestId('prompt-output-textarea');

/** The exact prompt that broke the live session, in the shape it was authored. */
const BROKEN_INSTRUCTIONS = 'You are Jeff Bezos and Andy Jassy reviewing leadership principles.';
const BROKEN_OUTPUT =
  '## Leadership Review\n[Summary of the core idea/response being analyzed]\n\n'
  + '## Principle Alignment\n[Which principle this maps to]';

describe('the halves say what they are for', () => {
  test('the labels name the model, not the form', async () => {
    // rejects: reverting to "General Instructions" / "Output Format (Markdown)".
    // Neither says the first half is where the round's data goes, and an author
    // who has read them still does not know where to put the responses. That is
    // not a wording preference — it is the confusion the outage came out of.
    await openEditor();
    const g = screen.getByTestId('prompt-half-given');
    const w = screen.getByTestId('prompt-half-writes');
    expect(g.textContent).toMatch(/What the AI is given/i);
    expect(w.textContent).toMatch(/What the AI writes/i);
    expect(g.textContent).not.toMatch(/General Instructions/i);
    expect(w.textContent).not.toMatch(/Output Format \(Markdown\)/i);
  });

  test('the halves are still stored as instructions and outputFormat', async () => {
    // rejects: renaming the STORAGE keys along with the labels. The lambda
    // reads promptData.instructions and promptData.outputFormat
    // (get-ai-summary.js:2145), and every prompt already in S3 and DynamoDB
    // carries those two names. Only the screen's words changed.
    await openEditor();
    expect(screen.getByTestId('prompt-half-given').textContent).toMatch(/instructions/);
    expect(screen.getByTestId('prompt-half-writes').textContent).toMatch(/outputFormat/);
  });
});

describe('the {} vs [] convention is stated, because it silently broke a session', () => {
  test('both kinds of bracket are explained, and what each one does', async () => {
    // rejects: deleting the legend, or explaining only one of the two. Square
    // brackets ALONE look like a placeholder — that is precisely why they were
    // used for the responses — so naming braces without naming brackets leaves
    // the misreading intact.
    await openEditor();
    const legend = screen.getByTestId('prompt-convention');
    expect(legend.textContent).toMatch(/\{braces\}/);
    expect(legend.textContent).toMatch(/\[brackets\]/);
    expect(legend.textContent).toMatch(/replaced with real data/i);
    expect(legend.textContent).toMatch(/prose/i);
    expect(legend.textContent).toMatch(/Nothing replaces them/i);
  });

  test('the brackets an author has written are listed back as directions', async () => {
    // rejects: dropping the readout. The distinction has to be visible at the
    // moment the bracket is typed; a legend at the top of a long form is read
    // once, and "[Summary of the core idea/response being analyzed]" was typed
    // by somebody who had every reason to think it was a slot.
    await openEditor();
    fireEvent.change(writes(), { target: { value: BROKEN_OUTPUT } });
    const readout = await screen.findByTestId('prompt-writes-readout');
    expect(readout.textContent).toMatch(/read as prose/i);
    expect(readout.textContent).toContain('[Summary of the core idea/response being analyzed]');
  });

  test('a markdown link is not reported as a direction', async () => {
    // rejects: a naive /\[.*\]/ scan. `[the runbook](https://x)` is a link, and
    // a readout that cries wolf on every link is one an author stops reading —
    // which is the failure mode that gets a check deleted rather than heeded.
    await openEditor();
    fireEvent.change(writes(), { target: { value: 'See [the runbook](https://example.com) first.' } });
    await waitFor(() => expect(writes().value).toContain('runbook'));
    expect(screen.queryByTestId('prompt-writes-readout')).toBeNull();
  });
});

describe('the input half reports what the model will actually receive', () => {
  test('an empty input half is called out, in the words of the failure', async () => {
    // rejects: showing the readout only when it is populated. The absent case
    // is the whole defect: a prompt with no data variables looks finished, and
    // every screen it passed through agreed with it.
    await openEditor();
    fireEvent.change(given(), { target: { value: BROKEN_INSTRUCTIONS } });
    const empty = await screen.findByTestId('prompt-given-empty');
    expect(empty.textContent).toMatch(/names no data/i);
    expect(empty.textContent).toMatch(/not the responses/i);
  });

  test('the variables in the input half are named once there are any', async () => {
    /*
      rejects: counting tokens from BOTH halves here. A variable in the output
      format is still substituted — but the reading this panel offers is "what
      is the model given", and answering it with the reply's tokens is how the
      original prompt looked complete.

      THE OUTPUT HALF IS FILLED FIRST, AND THE ORDER IS LOAD-BEARING. Written
      the other way round this test SURVIVED the mutation it exists for: the
      readout is a useMemo keyed on `formData.instructions`, so a version that
      wrongly read the output format too would still not recompute when the
      output format changed after the input. The assertion passed against a
      value computed before the mutation had anything to act on — a stale memo
      standing in for a correct one. Found by mutation, not by reading.
    */
    await openEditor();
    fireEvent.change(writes(), { target: { value: '## Summary {leaderboard}' } });
    fireEvent.change(given(), { target: { value: 'Here is what was said: {topVotedAnswers}' } });
    const readout = await screen.findByTestId('prompt-given-readout');
    expect(readout.textContent).toContain('{topVotedAnswers}');
    expect(readout.textContent).not.toContain('{leaderboard}');
    expect(screen.queryByTestId('prompt-given-empty')).toBeNull();
  });
});

describe('the preflight rule written for this bug can now actually fire', () => {
  test('a summary prompt with no answer variable blocks the save', async () => {
    /*
      rejects: dropping `promptType` from the preflightPrompt() call in
      AIPromptManager.jsx. That argument is the entire gate —
      promptPreflight.js:933 reads `String(input.promptType || '') ===
      'analysis'` — and it was missing from the call site, so the rule shipped in
      e8c167d1 could not fire in the editor at all. The module's own tests pass
      it explicitly and were green throughout.

      This reconstructs the real prompt: a persona, a bracketed layout, and no
      variable carrying the responses.
    */
    await openEditor();
    fireEvent.change(given(), { target: { value: BROKEN_INSTRUCTIONS } });
    fireEvent.change(writes(), { target: { value: BROKEN_OUTPUT } });

    const note = await screen.findByTestId('save-blocked-note');
    expect(note).toBeInTheDocument();
    expect(screen.getByText('Create Prompt')).toBeDisabled();
    expect(document.body.textContent).toMatch(/never receives the responses/i);
  });

  test('adding a variable that carries the responses clears the block', async () => {
    /*
      The other half, so the test above cannot quietly become "always blocked" —
      which would be indistinguishable from a rule that fires on everything, and
      that is the version of this rule that had to be narrowed once already
      (it lit up ten question-generation defaults).

      rejects: blocking on any finding rather than a blocking one, and rejects a
      rule that ignores the INPUT half — the owner's whole model puts the data
      there, and substitution runs over the assembled prompt
      (get-ai-summary.js:2205), so a variable in `instructions` is a real one.
    */
    await openEditor();
    fireEvent.change(given(), {
      target: { value: `${BROKEN_INSTRUCTIONS}\n\nResponses: {topVotedAnswers}\n{voteTally}` },
    });
    // The output must lose its [brackets] too: the bracket-direction rule
    // (the OTHER half of the same LP failure) blocks on them independently,
    // so clearing the save means fixing both defects — exactly what a real
    // author now has to do.
    fireEvent.change(writes(), {
      target: { value: '## Leadership Review\nThe core idea of the responses.\n\n## Principle Alignment\nWhich principle this maps to.' },
    });

    await waitFor(() => expect(given().value).toContain('topVotedAnswers'));
    expect(document.body.textContent).not.toMatch(/never receives the responses/i);
    expect(screen.getByText('Create Prompt')).not.toBeDisabled();
  });
});

describe('the two controls the owner called unhelpful are gone, and nothing was lost', () => {
  test('Category and Scenario are no longer in the editor', async () => {
    // rejects: leaving them in place. Neither reaches the model — `category` is
    // a list facet and a generator hint, `scenario` goes to the advisor — and
    // both sat above the two fields that decide what the summary says.
    await openEditor();
    const form = document.querySelector('.prompt-editor-form');
    expect(form.textContent).not.toMatch(/Scenario/);
    const labels = [...form.querySelectorAll('label')].map((l) => l.textContent.trim());
    expect(labels).not.toContain('Category');
  });

  test('an existing prompt keeps its category and scenario through an edit', async () => {
    /*
      rejects: deleting the fields from formData along with the controls. That
      would strip `category` from every prompt the moment somebody opened and
      saved it, orphaning it from the library's category filter — a silent data
      loss dressed as a layout change.
    */
    authFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        prompts: [{
          promptId: 'p1',
          name: 'Lessons Learned',
          gameType: 'call-and-answer',
          category: 'lessons-learned',
          scenario: 'Lessons Learned Scenarios',
          status: 'active',
          promptContent: { instructions: 'Given {responsesText}', outputFormat: '## Summary' },
        }],
      }),
    });
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTitle('Edit this prompt'));
    await screen.findByText('Edit AI Prompt');

    authFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      const put = authFetch.mock.calls.find((c) => c[1] && c[1].method === 'PUT');
      expect(put).toBeTruthy();
      const body = JSON.parse(put[1].body);
      expect(body.category).toBe('lessons-learned');
      expect(body.scenario).toBe('Lessons Learned Scenarios');
    });
  });
});
