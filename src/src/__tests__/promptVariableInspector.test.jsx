/**
 * WHAT A VARIABLE ACTUALLY RESOLVES TO — components/PromptVariableInspector.jsx
 *
 * THE DEFECT: `config/templateVariables.js` is a prompt author's only spec and
 * it is wrong about values. D11 — `voteTally`'s description reads "Detailed
 * breakdown of votes received by each response" with the example
 * "Alice: 3 first-place, 2 second-place votes (13 points)". That is
 * `votingBreakdown`'s shape. The real value (get-ai-summary.js:1580-1586,
 * non-trivia branch) is a top-3 list of answer TEXTS with point totals and no
 * names at all.
 *
 * So the whole point of this component is that its samples come from the
 * EMITTER, never from the catalogue prose, and these tests are written to fail
 * the moment anybody wires the description back in.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import PromptVariableInspector, {
  variableSamples,
  sampleTemplateVars,
  UNSAFE_VARIABLES,
  SAMPLE_ROOM_SIZES,
} from '../components/PromptVariableInspector';
import { TEMPLATE_VARIABLES } from '../config/templateVariables';

const sampleFor = (name, gameType = 'call-and-answer', size = 'typical') =>
  variableSamples(gameType, size).find((s) => s.name === name);

describe('samples come from the emitter, not from the catalogue', () => {
  test('voteTally has the shape the lambda emits, not the one it is described as', () => {
    // rejects: reading `variable.example` for the sample. The catalogue's
    // example names a person and counts first/second/third places; the real
    // value is numbered answer text with a vote-point total.
    const s = sampleFor('voteTally');
    expect(s.value).toMatch(/^1\. .+ \(\d+ vote points\)/);
    expect(s.value).not.toMatch(/first-place/);
    // And the catalogue really does still describe it wrongly, so this test
    // cannot quietly become vacuous if D11 is fixed elsewhere without telling
    // anyone: assert the premise.
    const entry = TEMPLATE_VARIABLES.find((v) => v.name === 'voteTally');
    expect(entry.example).toMatch(/first-place/);
  });

  test('votingBreakdown is the one that really has that shape', () => {
    // rejects: swapping the two samples, which is the same confusion in the
    // other direction and is exactly how D11 was written.
    expect(sampleFor('votingBreakdown').value).toMatch(/first-place, \d+ second-place/);
  });

  test('responsesText carries the medal emoji the output contract bans', () => {
    // rejects: cleaning the sample up. D5 — the material is built with 🥇🥈🥉
    // (get-ai-summary.js:1410-1413) while the FORMAT block says "no emoji", and
    // a sanitised preview hides the contradiction from the only person who can
    // fix it.
    expect(sampleFor('responsesText').value).toContain('\u{1F947}');
  });

  test('participationRate resolves to nothing at all', () => {
    // rejects: inventing a plausible "100% answered, 75% voted" sample from the
    // catalogue. It is the empty string by construction
    // (get-ai-summary.js:2124) and showing anything else recreates the defect
    // the emptying was meant to remove.
    const s = sampleFor('participationRate');
    expect(s.value).toBe('');
    expect(s.empty).toBe(true);
  });
});

describe('the sample room changes the sample', () => {
  test('an empty round reports zero answers, and every list is empty', () => {
    // rejects: a fixed sample. The 0-answer branch of every prompt in this
    // product has never been read by anyone — H14 is recorded UNTESTED because
    // the smallest round ever run had 8 answers.
    const vars = sampleTemplateVars('call-and-answer', 'empty');
    expect(vars.responseCount).toBe(0);
    expect(vars.responsesText).toBe('');
    expect(vars.winnerInfo).toBe('No clear winner');
  });

  test('a 40-person room produces a longer answer list than an 8-person one', () => {
    // rejects: truncating the sample list, which nothing in get-ai-summary.js
    // does — the prompt grows linearly with the room.
    const small = sampleTemplateVars('call-and-answer', 'typical').responsesText.length;
    const large = sampleTemplateVars('call-and-answer', 'large').responsesText.length;
    expect(large).toBeGreaterThan(small * 2);
  });

  test('the tallies stay at three entries however large the room gets', () => {
    // rejects: letting the sample tallies grow with the room. D4 —
    // `sortedAnswers` is sliced to 3 (:1283-1286) before voteTally,
    // votingBreakdown, topVotedAnswers, finalResults, roundScores and
    // scoreChanges all read it, so an author who budgets for five is wrong.
    const vars = sampleTemplateVars('call-and-answer', 'large');
    expect(vars.voteTally.split(/,\s\d\./).length).toBe(3);
    expect(vars.votingBreakdown.split('; ').length).toBe(3);
  });

  test('every declared room size is offered', () => {
    // rejects: dropping the empty round from the control because it looks
    // useless. It is the one branch nobody has ever seen.
    expect(SAMPLE_ROOM_SIZES.map((r) => r.answers)).toEqual([0, 1, 8, 40]);
  });
});

describe('unsafe variables are named, and named for what they do', () => {
  test('the silent ones are the ones that resolve without complaint', () => {
    // rejects: demoting any of these to advisory. Each saves, runs, produces
    // text, and the text is wrong or missing with nothing logged.
    for (const name of ['participationRate', 'votingParticipation', 'totalParticipants', 'votingPattern', 'resultsSummary']) {
      expect(UNSAFE_VARIABLES[name].tier).toBe('silent');
    }
  });

  test('a silent variable is flagged in its row', () => {
    // rejects: keeping the verdict in a tooltip. A tooltip is the same
    // affordance the wrong descriptions already lived in.
    render(<PromptVariableInspector gameType="call-and-answer" />);
    const row = screen.getByTestId('pvi-row-participationRate');
    expect(within(row).getByText(/Unsafe/)).toBeInTheDocument();
  });

  test('expanding a row states what it becomes and why it is unsafe', () => {
    // rejects: showing the sample and dropping the reason, which leaves an
    // author looking at an empty string with no idea it is empty on purpose.
    render(<PromptVariableInspector gameType="call-and-answer" />);
    const row = screen.getByTestId('pvi-row-participationRate');
    fireEvent.click(within(row).getByText('What it becomes'));
    expect(within(row).getByText(/nothing at all/)).toBeInTheDocument();
    expect(row.textContent).toMatch(/Resolves to the empty string, always/);
  });
});

describe('a variable this engagement type does not produce', () => {
  test('is shown, disabled, and says it produces nothing here', () => {
    // rejects: hiding it. Mockup 19: "Hiding the variables that do not apply
    // would make the palette shorter and the model wrong."
    render(<PromptVariableInspector gameType="poll" onInsert={() => {}} />);
    const row = screen.getByTestId('pvi-row-correctAnswer');
    expect(within(row).getByRole('button', { name: '{correctAnswer}' })).toBeDisabled();
    expect(within(row).getByText(/Produces nothing here/)).toBeInTheDocument();
  });

  test('the note says it vanishes rather than leaving braces', () => {
    // rejects: repeating mockup 19's claim that inserting one "leaves a literal
    // {answers}". Every catalogued token HAS a key in templateVars, so it is
    // substituted — with an empty or meaningless value. Silent, not visible,
    // which is the worse failure and the one worth naming.
    const s = sampleFor('correctAnswer', 'poll');
    expect(s.available).toBe(false);
    expect(s.unavailableNote).toMatch(/It just vanishes/);
    expect(s.unavailableNote).not.toMatch(/literal/i);
  });
});

describe('where no sample can be derived, it says so', () => {
  test('survey has no emitted values at all, and no invented ones', () => {
    // rejects: falling back to the catalogue's description for survey. No
    // survey set can exist — upload-questions.js refuses survey uploads — so no
    // survey round has ever been summarised and there is nothing to copy.
    const s = sampleFor('responseCount', 'survey');
    expect(s.unknown).toBe(true);
    expect(s.value).toBeNull();

    render(<PromptVariableInspector gameType="survey" />);
    const row = screen.getByTestId('pvi-row-responseCount');
    fireEvent.click(within(row).getByText('What it becomes'));
    expect(within(row).getByText(/No sample\./)).toBeInTheDocument();
    expect(row.textContent).toMatch(/is not shown here/);
  });
});

describe('the tokens the author has already used are marked', () => {
  test('a used variable is called out in its row', () => {
    // rejects: dropping `usedNames`, which is what makes the inspector a view
    // of THIS prompt rather than a catalogue reprint.
    render(<PromptVariableInspector gameType="call-and-answer" usedNames={['responsesText']} />);
    expect(within(screen.getByTestId('pvi-row-responsesText')).getByText('In your prompt')).toBeInTheDocument();
    expect(within(screen.getByTestId('pvi-row-eventTitle')).queryByText('In your prompt')).toBeNull();
  });
});
