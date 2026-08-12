/**
 * WHAT THE MODEL IS HANDED — components/PromptAssembledPreview.jsx
 *
 * The defect this file is really testing for is D2, and it is worth restating
 * because it is the reason the component exists. The advisor prompt's rule 10
 * was written
 *
 *     "If {responseCount} is 0, write one plain line…"
 *
 * and the model received
 *
 *     "If 11 is 0, write one plain line…"
 *
 * Every gate in the product passed it: `debugInfo.unresolvedVariables` was
 * empty on all six rounds, because the existing check looks for a token with NO
 * key and this is a token with a key, used as a noun.
 *
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine, so the size bar's width
 * is asserted as the number that produced it, never as a measured box.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import PromptAssembledPreview, {
  assemblePrompt,
  measureAssembly,
  substitute,
  promptBody,
  buildOutputContract,
  resolveOutputHeadings,
} from '../components/PromptAssembledPreview';

const body = () => screen.getByTestId('pap-body').textContent;
const clickRoom = (label) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('substitution is the lambda\'s substitution, prose included', () => {
  test('a variable named inside a sentence has its VALUE inlined — this is D2', () => {
    // rejects: any "only substitute in the output format" or "skip tokens
    // inside prose" cleverness. get-ai-summary.js:2224-2227 is one global
    // replace per key over the WHOLE prompt, and a preview that is kinder than
    // the runtime shows the author a prompt that does not exist.
    const out = substitute('If {responseCount} is 0, write one plain line.', { responseCount: 8 });
    expect(out).toBe('If 8 is 0, write one plain line.');
    expect(out).not.toContain('{responseCount}');
  });

  test('every occurrence is replaced, not the first', () => {
    // rejects: `String.replace` with a non-global pattern. The lambda uses a
    // /g regex; a first-only replace would understate duplication to zero.
    expect(substitute('{a} and {a}', { a: 'X' })).toBe('X and X');
  });

  test('the body is instructions + output format, or the legacy single field', () => {
    // rejects: dropping the legacy `template` branch. A prompt that carries
    // `template` ignores instructions/outputFormat entirely
    // (get-ai-summary.js:2162-2168), and previewing the wrong two fields would
    // show a prompt the model never sees.
    expect(promptBody({ template: 'LEGACY', instructions: 'i', outputFormat: 'o' })).toBe('LEGACY');
    expect(promptBody({ instructions: 'i', outputFormat: 'o' })).toBe('i\n\no');
  });
});

describe('the frame is part of the size, because it is part of the prompt', () => {
  test('the assembled string is VOICE, then the prompt, then the FORMAT contract', () => {
    // rejects: previewing only the authored text. get-ai-summary.js:2181 is
    // `VOICE:\n… + body + contract`; roughly 10.9 KB of the one measured prompt
    // was fixed text, so a size figure counting the middle third is wrong in
    // the direction that lets a prompt grow unnoticed.
    const a = assemblePrompt({ instructions: 'INSTR', outputFormat: 'FMT', gameType: 'call-and-answer' });
    expect(a.text.indexOf('VOICE:')).toBe(0);
    expect(a.text.indexOf('INSTR')).toBeGreaterThan(a.text.indexOf('VOICE:'));
    expect(a.text.indexOf('FORMAT (this part is not negotiable')).toBeGreaterThan(a.text.indexOf('FMT'));
  });

  test('the contract carries the declared headings, and falls back to the triad', () => {
    // rejects: emitting the default headings regardless of `outputSections`,
    // which would hide from the author that a declared shape is what the model
    // is actually told to produce.
    expect(resolveOutputHeadings(undefined)).toEqual(['Summary', 'Discussion Questions', 'Next Steps']);
    expect(resolveOutputHeadings([{ heading: 'What the room said' }])).toEqual(['What the room said']);
    const contract = buildOutputContract([{ heading: 'What the room said', guidance: 'Three bullets.' }]);
    expect(contract).toContain('## What the room said');
    expect(contract).toContain('Three bullets.');
    // The count word is spelled, exactly as personas.js spells it.
    expect(contract).toContain('exactly these one headings');
  });
});

describe('measurement: what is instruction and what is inlined data', () => {
  const measure = (authoredArgs) => measureAssembly(assemblePrompt(authoredArgs));

  test('a variable used twice reports its second copy as duplication', () => {
    // rejects: counting a variable once per NAME instead of once per
    // occurrence. In the measured prompt three variables appeared twice and
    // accounted for 7,222 chars, 40% of the whole, of which 3,611 was pure
    // duplication — a per-name count reports that as 3,611 and zero repeated.
    const stats = measure({
      instructions: 'Read {responsesText} first.',
      outputFormat: 'Then read {responsesText} again.',
      gameType: 'call-and-answer',
    });
    const v = stats.variables.find((x) => x.name === 'responsesText');
    expect(v.occurrences).toBe(2);
    expect(v.totalChars).toBe(v.valueChars * 2);
    expect(stats.duplicatedChars).toBe(v.valueChars);
    expect(stats.inlinedChars).toBe(v.valueChars * 2);
  });

  test('a variable used once contributes nothing to duplication', () => {
    // rejects: an off-by-one that charges every use as a duplicate, which would
    // make the loudest number on the screen permanently non-zero and therefore
    // ignored.
    const stats = measure({ outputFormat: '{responsesText}', instructions: 'x', gameType: 'call-and-answer' });
    expect(stats.duplicatedChars).toBe(0);
    expect(stats.inlinedChars).toBeGreaterThan(0);
  });

  test('an invented token inlines nothing — it stays on screen as braces', () => {
    // rejects: treating an unknown token as if it had a value, which would
    // report inlined characters for text that is four literal braces.
    const stats = measure({ instructions: 'x', outputFormat: '{wordFrequency}', gameType: 'call-and-answer' });
    const v = stats.variables.find((x) => x.name === 'wordFrequency');
    expect(v.known).toBe(false);
    expect(stats.inlinedChars).toBe(0);
  });

  test('variablesUsed is a count, matching preflightPrompt()\'s stats', () => {
    // rejects: returning an array under a name the preflight contract defines
    // as a scalar. The two shapes meet on one screen and a silent type swap
    // renders "[object Object]" or crashes a `.toLocaleString`.
    const stats = measure({ instructions: '{eventTitle}', outputFormat: '{responseCount}', gameType: 'call-and-answer' });
    expect(typeof stats.variablesUsed).toBe('number');
    expect(stats.variablesUsed).toBe(2);
  });

  test('assembledChars is the length of the string actually rendered', () => {
    // rejects: an estimate. The figure has to describe the text under it —
    // that is the entire reason this component measures rather than reading the
    // preflight's table-based estimate.
    const assembly = assemblePrompt({ instructions: 'a', outputFormat: 'b', gameType: 'call-and-answer' });
    expect(measureAssembly(assembly).assembledChars).toBe(assembly.text.length);
  });
});

describe('the sample room, and the branches nobody has ever run', () => {
  const render8 = (props = {}) =>
    render(
      <PromptAssembledPreview
        instructions="A thin round is said honestly."
        outputFormat="If {responseCount} is 0, write one plain line. The answers: {responsesText}"
        gameType="call-and-answer"
        {...props}
      />
    );

  test('the rendered body shows the substituted sentence, not the token', () => {
    // rejects: rendering the authored text with the tokens intact — which is
    // what the editor did before, and is exactly the view in which D2 is
    // invisible.
    render8();
    expect(body()).toContain('If 8 is 0, write one plain line.');
    expect(body()).not.toContain('{responseCount}');
  });

  test('the empty round is reachable, and renders "If 0 is 0"', () => {
    // rejects: hardcoding one room size. H14 — honest degradation on thin data
    // — is recorded UNTESTED because the smallest round ever run had 8 answers,
    // so the branch every prompt declares has never been read by anybody.
    render8();
    clickRoom('Nobody answered');
    expect(body()).toContain('If 0 is 0');
  });

  test('a 40-person room is where the prompt size goes', () => {
    // rejects: truncating the sample answer list, which nothing in
    // get-ai-summary.js does. `responsesText` grows linearly with the room and
    // naming it twice doubles the slope; a preview that caps it would hide the
    // one number worth having before a large session.
    render8();
    const small = screen.getByTestId('pap-body').textContent.length;
    clickRoom('A large room (40)');
    expect(screen.getByTestId('pap-body').textContent.length).toBeGreaterThan(small * 2);
  });

  test('duplication is named, per variable, with both figures', () => {
    // rejects: reporting a total with no breakdown. "40% of your prompt is
    // data" is not actionable; "{responsesText} ×2, 1,800 characters each" is.
    render(
      <PromptAssembledPreview
        instructions="Find two answers in {responsesText} that conflict."
        outputFormat="The answers: {responsesText}"
        gameType="call-and-answer"
      />
    );
    const dupe = screen.getByTestId('pap-duplication');
    expect(within(dupe).getByText('{responsesText}')).toBeInTheDocument();
    expect(dupe.textContent).toMatch(/×2/);
  });

  test('no duplication block when nothing repeats', () => {
    // rejects: an always-on panel. A warning that is always there is furniture.
    render(<PromptAssembledPreview instructions="x" outputFormat="{responsesText}" gameType="call-and-answer" />);
    expect(screen.queryByTestId('pap-duplication')).toBeNull();
  });

  test('the three blocks are labelled, and only the middle one is the author\'s', () => {
    // rejects: showing one undifferentiated blob. An author who cannot see
    // which kilobytes they control cannot budget against the total.
    render8();
    expect(screen.getByText('1. VOICE')).toBeInTheDocument();
    expect(screen.getByText('2. Your prompt, substituted')).toBeInTheDocument();
    expect(screen.getByText('3. FORMAT contract')).toBeInTheDocument();
  });

  test('the four headline figures are on screen', () => {
    // rejects: dropping the inlined/duplicated split and showing only a total,
    // which is the number the product already had (nowhere) and never helped.
    render8();
    const stats = screen.getByTestId('pap-stats');
    expect(stats.textContent).toContain('characters assembled');
    expect(stats.textContent).toContain('words, roughly');
    expect(stats.textContent).toContain('inlined data, not instruction');
    expect(stats.textContent).toContain('the model reads twice');
  });
});
