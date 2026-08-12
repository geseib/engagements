/**
 * WHAT THE PROMPT WILL DO WHEN IT IS ASSEMBLED — utils/promptPreflight.js
 *
 * Every expectation below is checked against the real behaviour in
 * `lambda-functions/game/get-ai-summary.js`, `game/prompt-shape.js` and
 * `game/template-variables.js`, cited inline. These are pure functions; nothing
 * renders, nothing is mocked, and there is not a `jest.mock` call in the file.
 *
 * Each test names the implementation change it rejects. Where the answer would
 * be "nothing", the test is not written. Every `rejects:` below was verified by
 * making that exact change and watching the test go red — the list of mutations
 * is in the handoff for this work.
 *
 * THE PRIMARY FIXTURE IS A REAL PROMPT.
 * `sets/prompt-callandanswer-workie-advisor.json` was authored with unusual
 * care, run end to end, and still shipped six defects. It is read off disk
 * rather than copied in, so an edit to that file moves these tests.
 */
const fs = require('fs');
const path = require('path');

import { preflightPrompt, describePreflight } from '../utils/promptPreflight';

const SETS = path.join(__dirname, '..', '..', '..', 'sets');
const loadPrompt = (file) => JSON.parse(fs.readFileSync(path.join(SETS, file), 'utf8'));

const ADVISOR = loadPrompt('prompt-callandanswer-workie-advisor.json');

const codes = (list) => list.map((f) => f.code);
const byCode = (list, code) => list.filter((f) => f.code === code);
const titled = (list, fragment) => list.find((f) => f.title.includes(fragment));

/** A prompt that is structurally fine, so a test can vary exactly one thing. */
const ok = (over = {}) => ({
  instructions: 'Read the answers and say what the room decided.\n\n- The answers: {responsesText}',
  outputFormat: 'Write clean Markdown.',
  gameType: 'call-and-answer',
  ...over,
});

/* ============================================================== BLOCKING == */

describe('tier one — the prompt will not run as written', () => {
  test('a token no variable emits is blocked, and the report says what it will look like', () => {
    // Exactly one place substitutes tokens (get-ai-summary.js:2224-2227); a token
    // not in `templateVars` survives the loop and is shown as literal braces.
    // rejects: dropping the unknownVariableTokens scan, which is the one check
    // that already existed and the only one a save gate performs today.
    const report = preflightPrompt(ok({
      instructions: 'Summarise using {roomMood} and {responsesText}.',
    }));
    const unknown = byCode(report.blocking, 'unknown-variable');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].title).toContain('{roomMood}');
    expect(unknown[0].evidence).toContain('{roomMood}');
    // The known one beside it must not be swept up.
    expect(unknown[0].title).not.toContain('responsesText');
  });

  test('an internal variable is not an unknown one', () => {
    // template-variables.js:511-520 — {totalPlayers} and friends are resolvable
    // and deliberately unadvertised, and `assertTemplateVariablesExist` accepts
    // them because live prompts use them. rejects: validating against the
    // advertised TEMPLATE_VARIABLES list alone, which would block prompts that
    // are shipped and working.
    const report = preflightPrompt(ok({ instructions: 'There were {totalPlayers} people.' }));
    expect(codes(report.blocking)).not.toContain('unknown-variable');
  });

  test('outputSections guidance is scanned for tokens, because it reaches the model too', () => {
    // buildOutputContract (personas.js:325-342) puts the guidance into the
    // prompt, and the substitution loop runs over the whole assembled string.
    // rejects: scanning only instructions and outputFormat — the shape most of
    // this file's checks would take if written from the field names alone.
    const report = preflightPrompt(ok({
      outputSections: [{ heading: 'Summary', guidance: 'Open with {roomVibe}.' }],
    }));
    const unknown = byCode(report.blocking, 'unknown-variable');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].evidence).toContain('outputSections[0].guidance');
  });

  test('instructions with no output format cannot run, and the report says it fails quietly', () => {
    // get-ai-summary.js:2162-2168 accepts `template`, or `instructions` AND
    // `outputFormat`. Failing it is not loud: the handler falls to
    // buildFallback() and the round makes no Bedrock call at all.
    // rejects: treating a prompt with good instructions as savable, which is
    // what the editor does today.
    const report = preflightPrompt({ instructions: 'Say what happened.', gameType: 'call-and-answer' });
    const shape = byCode(report.blocking, 'unusable-shape');
    expect(shape).toHaveLength(1);
    expect(shape[0].title).toContain('output format');
    expect(shape[0].detail).toMatch(/no Bedrock call/);
  });

  test('a legacy template alone is runnable, and the other two fields are then ignored', () => {
    // :2162 takes `template` and never reads instructions or outputFormat.
    // rejects: requiring instructions + outputFormat unconditionally, and
    // rejects: scanning fields the engine would ignore — {ghostToken} below is
    // in a field that never reaches the model, so reporting it teaches the
    // author something untrue.
    const report = preflightPrompt({
      template: 'Everything in one field. {responsesText}',
      instructions: 'stale draft using {ghostToken}',
      gameType: 'call-and-answer',
    });
    expect(codes(report.blocking)).toEqual([]);
  });

  test('a heading containing a brace throws the whole declared shape away', () => {
    // prompt-shape.js:139 refuses /[#*_`>|[\]{}]/ in a heading so a prompt
    // cannot smuggle extra sections — or a leading H1 — into the parser's
    // contract. rejects: relaxing that character class, and rejects: reporting
    // only the offending section, when normalizeOutputSections discards ALL of
    // them (`return null`) and the prompt silently gets the default triad.
    const report = preflightPrompt(ok({
      outputSections: [
        { heading: 'What {questionTitle} produced', guidance: 'x' },
        { heading: 'Next steps', guidance: 'y' },
      ],
    }));
    const discarded = byCode(report.blocking, 'output-shape-discarded');
    expect(discarded).toHaveLength(1);
    expect(discarded[0].detail).toMatch(/default Summary \/ Discussion Questions \/ Next Steps/);
  });

  test('two headings that differ only in case are a duplicate', () => {
    // prompt-shape.js:142-144 dedupes on `heading.toLowerCase()`, because a
    // response has to split unambiguously. rejects: comparing headings
    // case-sensitively, which passes here and is discarded at runtime.
    const report = preflightPrompt(ok({
      outputSections: [
        { heading: 'Next steps', guidance: 'a' },
        { heading: 'NEXT STEPS', guidance: 'b' },
      ],
    }));
    expect(codes(report.blocking)).toContain('output-shape-discarded');
  });

  test('a well-formed declared shape is not blocked', () => {
    // The other half of the same rule, so the validator cannot drift into
    // rejecting shapes the engine accepts. rejects: an over-eager check — the
    // advisor's own four sections must pass, and they are the reason
    // prompt-owned structure exists at all.
    const report = preflightPrompt(ADVISOR);
    expect(report.blocking).toEqual([]);
  });
});

/* ================================================================ SILENT == */

describe('the real advisor prompt — the defects it shipped with', () => {
  const report = preflightPrompt(ADVISOR);

  test('D2: it finds the four fields whose names were destroyed by their own values', () => {
    // The prompt's rules 2, 4, 5 and 10 name tokens as fields. The substitution
    // loop replaces them with values: rule 10's "If {responseCount} is 0"
    // arrived as "If 11 is 0". This is the single defect the module exists for.
    // rejects: any narrowing of the prose detector that loses D2 — the whole
    // point is that H13 and `unresolvedVariables` both pass this prompt.
    const prose = byCode(report.silent, 'prose-inlined-variable');
    expect(prose.map((f) => f.title.match(/\{(\w+)\}/)[1]).sort()).toEqual([
      'responseCount', 'responsesText', 'voteCount', 'voteTally', 'votingBreakdown',
    ]);
  });

  test('D2: the field list itself is not reported, only the rules that name it', () => {
    // Every one of those five ALSO appears in "WHAT YOU HAVE BEEN GIVEN" as
    // `- Label: {token}`, which is the correct use and the fix the report
    // recommends. rejects: reporting every occurrence — a check that flags a
    // well-formed field list is a check that gets switched off, and then it
    // protects nothing.
    const responsesText = titled(report.silent, '{responsesText} is named inside a sentence');
    expect(responsesText.evidence).toContain('Find two answers in {responsesText}');
    expect(responsesText.evidence).not.toContain('Every answer, ranked, with the vote points');
  });

  test('D2: it prices the one reference in rule 5 at the measured 2,244 characters', () => {
    // Measured by the evaluator on the round-4 prompt and re-measured
    // independently (hypothesis Part 2, D2). rejects: reporting the defect
    // without a number — "this might inline a lot" is the advice the author
    // already had, and it is why the prompt shipped.
    const responsesText = titled(report.silent, '{responsesText} is named inside a sentence');
    expect(responsesText.title).toContain('2,244 characters');
  });

  test('the three large fields each appear twice, and it says what the second copy costs', () => {
    // 7,222 characters — 40% of an 18,072-char prompt — of which 3,611 is pure
    // duplication. rejects: counting distinct variables rather than
    // occurrences, which is what `unresolvedVariables` does and why the
    // duplication was invisible.
    const dup = byCode(report.silent, 'duplicated-variable');
    const priced = dup.map((f) => f.title.match(/\{(\w+)\} appears 2 times, so about ([\d,]+)/).slice(1, 3));
    expect(priced).toEqual([
      ['responsesText', '2,244'],
      ['voteTally', '635'],
      ['votingBreakdown', '732'],
    ]);
    // 2,244 + 635 + 732 — the evaluator's independently measured figure.
    expect(report.stats.duplicatedChars).toBeGreaterThanOrEqual(3611);
  });

  test('isDefault names the blast radius and the tie-break nobody expects', () => {
    // findDefaultPromptId (get-ai-summary.js:340-390) matches on game type
    // alone, and resolves multiple claimants by PREFERRED_DEFAULT_CATEGORY
    // first (:369-383). rejects: describing isDefault as a property of this
    // question set, and rejects: dropping the tie-break, which is the half that
    // decides which prompt actually wins when two claim the flag.
    const blast = byCode(report.silent, 'default-blast-radius');
    expect(blast).toHaveLength(1);
    expect(blast[0].title).toContain('EVERY call-and-answer set');
    expect(blast[0].detail).toContain('lessons-learned');
    expect(blast[0].detail).toMatch(/more than one/i);
  });

  test('it does not report the sections as emptying the host remote, because they do not', () => {
    // "Discussion topics" matches SECTION_SYNONYMS.discussion and "Next steps"
    // matches nextSteps (get-ai-summary.js:95-99), so both structured fields
    // fill. rejects: firing structured-fields-empty on any non-default shape,
    // which would report the one prompt that got this right.
    expect(codes(report.silent)).not.toContain('structured-fields-empty');
  });

  test('every finding it produces carries all five contract fields as non-empty strings', () => {
    // The UI is built against `{ code, title, detail, evidence, fix }`.
    // rejects: a finding that omits `evidence` or `fix` — on the richest input
    // available, which is where an omission would actually happen.
    const all = [...report.blocking, ...report.silent, ...report.advisory];
    expect(all.length).toBeGreaterThan(10);
    for (const f of all) {
      for (const key of ['code', 'title', 'detail', 'evidence', 'fix']) {
        expect(typeof f[key]).toBe('string');
        expect(f[key].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the other prompts this repo ships — the false-positive floor', () => {
  // Three shipped defaults plus the hardcoded legacy template. All four use the
  // labelled field-list form throughout and none of them has D2. If the prose
  // detector reports anything here it is wrong, and a preflight that is wrong
  // about working prompts is one nobody runs twice.
  const HARDCODED = (() => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'lambda-functions', 'game', 'get-ai-summary.js'),
      'utf8'
    );
    const at = src.indexOf('template: `You are an expert business strategist');
    return src.slice(src.indexOf('`', at) + 1, src.indexOf('`,', at));
  })();

  test.each([
    ['prompt-poll-round.json'],
    ['prompt-trivia-vj.json'],
    ['prompt-wavelength-round.json'],
  ])('%s has no prose-inlined variable', (file) => {
    // rejects: loosening the cue list until prose POSITION alone is enough.
    // These three put two or three tokens in prose position each — "- The
    // session: {eventTitle}, set "{questionSetName}", round {currentRound}" —
    // and every one of them renders correctly.
    const report = preflightPrompt(loadPrompt(file));
    expect(byCode(report.silent, 'prose-inlined-variable')).toEqual([]);
  });

  test('the hardcoded lessons-learned template has no prose-inlined variable either', () => {
    // Its opening line is "analyzing team responses from {sessionContext}." —
    // a preposition, a token, a full stop — and it renders as "…from a Team
    // Building session using Amazon Leadership Principles." rejects: firing the
    // preposition cue when the clause ends at the token. This was a real false
    // positive before that condition was added, and it is the only one the
    // corpus produced.
    const report = preflightPrompt({ template: HARDCODED, gameType: 'call-and-answer' });
    expect(byCode(report.silent, 'prose-inlined-variable')).toEqual([]);
  });

  test('the shipped poll and wavelength defaults still get their unsafe-variable findings', () => {
    // Quiet is not the same as blind. rejects: suppressing the unsafe list
    // along with the prose noise — {topVotedAnswers} in the poll default really
    // does render "a participant: 13 vote points" with no answer text, and
    // {totalParticipants} in the wavelength default really is the answer count.
    const poll = preflightPrompt(loadPrompt('prompt-poll-round.json'));
    const wave = preflightPrompt(loadPrompt('prompt-wavelength-round.json'));
    expect(titled(poll.silent, '{topVotedAnswers}')).toBeTruthy();
    expect(titled(wave.silent, '{totalParticipants}')).toBeTruthy();
  });
});

describe('tier two — saves, runs, says nothing', () => {
  test('a large value used twice in field position is still duplicated', () => {
    // Duplication is independent of prose form: two labelled lines naming the
    // same field inline the answers twice. rejects: folding the duplication
    // check into the prose check, which would miss a field list that repeats
    // itself — the cheapest way for this defect to reappear.
    const report = preflightPrompt(ok({
      instructions: '- The answers: {responsesText}\n- Also the answers: {responsesText}',
    }));
    expect(byCode(report.silent, 'prose-inlined-variable')).toEqual([]);
    expect(byCode(report.silent, 'duplicated-variable')).toHaveLength(1);
  });

  test('a large value dropped mid-sentence with no grammatical cue is caught by its size alone', () => {
    // "Summarise these: {responsesText} and say what stands out." has no verb,
    // no preposition and no comparison in front of the token — nothing but
    // 2,244 characters arriving where the rest of a sentence was.
    // rejects: dropping the size cue and resting the whole check on grammar,
    // which is the version that reads well and misses the expensive half.
    const report = preflightPrompt(ok({
      instructions: 'Summarise these: {responsesText} and say what stands out.',
    }));
    const prose = byCode(report.silent, 'prose-inlined-variable');
    expect(prose).toHaveLength(1);
    expect(prose[0].detail).toMatch(/the value is large enough/);
  });

  test('a small value used twice is not duplication', () => {
    // The threshold is 200 characters, taken from the runtime check the
    // hypothesis proposes for the same condition (Part 3B item 2a), so the
    // save-time and runtime checks cannot disagree. rejects: dropping the
    // threshold, which reports every field list that mentions a count twice.
    const report = preflightPrompt(ok({
      instructions: '- Answered: {responseCount}\n- Reminder: {responseCount}',
    }));
    expect(byCode(report.silent, 'duplicated-variable')).toEqual([]);
  });

  test.each([
    ['totalParticipants', /answers\.length/],
    ['activeParticipants', /votes\.length : answers\.length/],
    ['topVotedAnswers', /a participant: 13 vote points/],
    ['votingPattern', /totalVotes \* 2/],
    ['resultsSummary', /firstPlacePoints/],
  ])('{%s} is reported with the specific line of code that makes it wrong', (name, evidence) => {
    // Each was read in get-ai-summary.js before it was written down — :1286,
    // :1542, :1596-1602, :1579, :1653-1654 respectively. rejects: a generic
    // "this variable is risky" list. A warning without the mechanism is one an
    // author overrules, and all five of these look correct from the catalogue.
    const report = preflightPrompt(ok({ instructions: `Report on {${name}}.` }));
    const found = titled(report.silent, `{${name}}`);
    expect(found).toBeTruthy();
    expect(found.code).toBe('unsafe-variable');
    expect(found.detail).toMatch(evidence);
  });

  test('totalParticipants beside responseCount reproduces the lie 78df15ca removed', () => {
    // Both resolve to `answers.length`, so a model told "12 joined, 12
    // answered" reports full participation — 100% by construction, on every
    // round, read aloud. rejects: reporting totalParticipants without noticing
    // what it is standing next to, which is the difference between a naming
    // complaint and the defect this repo has already shipped once.
    const alone = preflightPrompt(ok({ instructions: 'There were {totalParticipants}.' }));
    const paired = preflightPrompt(ok({
      instructions: 'There were {totalParticipants}, and {responseCount} answered.',
    }));
    expect(titled(alone.silent, '{totalParticipants}').detail).not.toMatch(/78df15ca/);
    expect(titled(paired.silent, '{totalParticipants}').detail).toMatch(/78df15ca/);
  });

  test('a custom shape matching no discussion or next-steps heading empties two host surfaces', () => {
    // parseAIResponse fills discussionQuestions and nextSteps only from a
    // SECTION_SYNONYMS match (get-ai-summary.js:95-99, :162-163); those feed
    // config/hostRemote.js:536 and GameHostPage.jsx:4792. rejects: treating a
    // valid declared shape as automatically fine — it parses, it renders, and
    // the phone goes blank.
    const report = preflightPrompt(ok({
      outputSections: [
        { heading: 'What the room said', guidance: 'a' },
        { heading: 'What the room voted', guidance: 'b' },
      ],
    }));
    const empty = byCode(report.silent, 'structured-fields-empty');
    expect(empty).toHaveLength(1);
    expect(empty[0].title).toContain('discussionQuestions and nextSteps');
  });

  test('isDefault absent says nothing at all', () => {
    // rejects: firing the blast-radius finding on every prompt, which turns the
    // silent tier into wallpaper — it is a warning about a flag, not about a
    // prompt.
    expect(codes(preflightPrompt(ok()).silent)).not.toContain('default-blast-radius');
    expect(codes(preflightPrompt(ok({ isDefault: false })).silent)).not.toContain('default-blast-radius');
  });
});

/* ============================================================== ADVISORY == */

describe('tier three — worth knowing before you commit to it', () => {
  test('a 400-word cap is measured against what max_tokens actually allows', () => {
    // get-ai-summary.js:2267-2276 — Haiku 4.5, max_tokens 1024, ~750 words.
    // Nothing truncates below that, so the cap is enforced only by the model.
    // rejects: quoting a model or a token budget that is not the one in the hot
    // path — the figure is the whole content of the finding.
    const report = preflightPrompt(ok({ outputFormat: 'Keep the whole reply under 400 words.' }));
    const cap = byCode(report.advisory, 'word-cap-not-enforced');
    expect(cap).toHaveLength(1);
    expect(cap[0].title).toContain('400-word cap');
    expect(cap[0].detail).toContain('1,024');
    expect(cap[0].detail).toContain('Claude Haiku 4.5');
  });

  test('a cap above what the model can produce is not worth mentioning', () => {
    // rejects: firing on every stated cap. A 900-word cap IS enforced — by
    // max_tokens, at about 750 — so there is nothing to warn about.
    const report = preflightPrompt(ok({ outputFormat: 'Keep it under 900 words.' }));
    expect(codes(report.advisory)).not.toContain('word-cap-not-enforced');
  });

  test('four evidence-bearing sections against a 400-word cap is called out', () => {
    // Friction F6, observed rather than predicted: both reports landed at 399
    // tokens after three trimming passes and what got cut was evidence, despite
    // the prompt saying "cut adjectives before you cut evidence".
    // rejects: reporting the cap without the sections it has to cover, which is
    // the arithmetic the author cannot do from either number alone.
    const report = preflightPrompt(ADVISOR);
    const budget = byCode(report.advisory, 'evidence-budget');
    expect(budget).toHaveLength(1);
    expect(budget[0].title).toContain('4 sections');
    expect(budget[0].title).toContain('100 words');
  });

  test('the same cap over four sections that do not quote is left alone', () => {
    // Deliberately the same arithmetic as the advisor — four sections, a
    // 400-word cap, 100 words each, under the 120-word floor — so the ONLY
    // thing standing between this input and a finding is that none of the four
    // asks for a verbatim quote. rejects: counting sections rather than
    // sections that require evidence. Four sections of ordinary prose fit
    // inside 400 words without cutting anything, and saying otherwise is noise.
    const report = preflightPrompt(ok({
      outputFormat: 'Under 400 words.',
      outputSections: [
        { heading: 'Summary', guidance: 'Two sentences on what happened.' },
        { heading: 'What changed', guidance: 'One sentence.' },
        { heading: 'Discussion topics', guidance: 'Two numbered questions.' },
        { heading: 'Next steps', guidance: 'Two numbered actions.' },
      ],
    }));
    expect(codes(report.advisory)).not.toContain('evidence-budget');
  });

  test('banning emoji while showing the model medals is named, with the line that builds them', () => {
    // D5. responsesText is built with 🥇/🥈/🥉 at get-ai-summary.js:1418-1421.
    // rejects: checking only the author's own text for emoji — the emoji come
    // from the material, which is exactly why nobody noticed.
    const report = preflightPrompt(ok({
      instructions: '- The answers: {responsesText}',
      outputFormat: 'No HTML, no links, no emoji.',
    }));
    const emoji = byCode(report.advisory, 'emoji-shown-and-banned');
    expect(emoji).toHaveLength(1);
    expect(emoji[0].detail).toContain('{responsesText}');
    expect(emoji[0].detail).toContain('1418-1421');
  });

  test('"no emoji-only lines" is not an emoji ban', () => {
    // The exact wording of `sets/prompt-poll-round.json`, `prompt-trivia-vj.json`
    // and `prompt-wavelength-round.json`, all three of which ban a LAYOUT and
    // not the character. rejects: a naive /no emoji/ match, which reports three
    // shipped prompts that are behaving correctly — the precise way a checker
    // earns being ignored.
    const report = preflightPrompt(ok({
      instructions: '- The answers: {responsesText}',
      outputFormat: 'No horizontal rules, no emoji-only lines.',
    }));
    expect(codes(report.advisory)).not.toContain('emoji-shown-and-banned');
  });

  test('one rule banning "the above" while another asks for it is a collision', () => {
    // Friction F2: obeying both cost about 25 words of a 400-word budget, and
    // those words came out of evidence. rejects: matching the banning sentence
    // against itself, which reports every prompt that contains the phrase at
    // all — including one that bans it and never uses it.
    const collided = preflightPrompt(ok({
      instructions: 'Never write "as discussed", "the above", or a bare pronoun.',
      outputSections: [
        { heading: 'Discussion topics', guidance: 'Make one of them the split you named above.' },
        { heading: 'Next steps', guidance: 'Two numbered actions.' },
      ],
    }));
    const clean = preflightPrompt(ok({
      instructions: 'Never write "as discussed", "the above", or a bare pronoun.',
      outputSections: [
        { heading: 'Discussion topics', guidance: 'Restate the split in full.' },
        { heading: 'Next steps', guidance: 'Two numbered actions.' },
      ],
    }));
    expect(codes(collided.advisory)).toContain('back-reference-collision');
    expect(codes(clean.advisory)).not.toContain('back-reference-collision');
  });

  test('"the material above" is not a back-reference to a section', () => {
    // The advisor's rules 1 and 2 both say "the material above", meaning the
    // field list a few lines up, and both are correct. rejects: widening the
    // use pattern to any occurrence of "above", which fires on the prompt that
    // was already doing the right thing.
    const report = preflightPrompt(ok({
      instructions: 'Never write "the above".\n\nEvery claim comes from the material above.',
    }));
    expect(codes(report.advisory)).not.toContain('back-reference-collision');
  });
});

/* ================================================================= STATS == */

describe('the numbers the panel shows', () => {
  test('the assembled size counts what substitution adds, not what the author typed', () => {
    // The advisor's authored text is 6,025 characters and the real assembled
    // prompt measured 18,072 (hypothesis Part 2). rejects: reporting
    // instructions.length + outputFormat.length as the size, which is the
    // number an editor can already show and the one that hid the problem.
    const report = preflightPrompt(ADVISOR);
    const authored = ADVISOR.instructions.length + 2 + ADVISOR.outputFormat.length;
    expect(authored).toBe(6025);
    expect(report.stats.assembledChars).toBeGreaterThan(15000);
    expect(report.stats.inlinedChars).toBeGreaterThanOrEqual(7222);
  });

  test('stats.variablesUsed is a count, and the per-variable detail is beside it', () => {
    // The contract's `stats` block is four scalars and this; a UI stat row
    // needs a number. rejects: returning the name list under `variablesUsed`,
    // which renders as a comma-joined string in a slot meant for a figure.
    const report = preflightPrompt(ADVISOR);
    expect(typeof report.stats.variablesUsed).toBe('number');
    expect(report.stats.variablesUsed).toBe(report.variables.length);
    const responsesText = report.variables.find((v) => v.name === 'responsesText');
    expect(responsesText).toEqual({
      name: 'responsesText', known: true, count: 2, renderedChars: 2244, proseUses: 1,
    });
  });

  test('an empty prompt is one blocking finding and zeroed stats, not a crash', () => {
    // rejects: reading .length off an absent field, which is what an editor
    // hands this module on every keystroke of a new prompt.
    const report = preflightPrompt({});
    expect(codes(report.blocking)).toEqual(['empty-prompt']);
    expect(report.silent).toEqual([]);
    expect(report.stats.assembledChars).toBe(0);
    expect(report.stats.variablesUsed).toBe(0);
  });

  test('preflightPrompt survives being called with nothing at all', () => {
    // rejects: a required argument. The UI is concurrent work and will call
    // this before it has anything to pass.
    expect(() => preflightPrompt()).not.toThrow();
  });

  test('describePreflight says what the prompt is before it says what is wrong', () => {
    // Same job as csvPreflight's one-liner: the size and the shape first, so
    // the tiers below it have something to be about. rejects: returning an
    // empty string for a valid report, and rejects: leading with the verdict.
    const line = describePreflight(preflightPrompt(ADVISOR));
    expect(line).toMatch(/^~[\d,]+ chars assembled · 10 variables · [\d,]+ substituted · /);
    expect(line).toContain('9 silent');
    expect(describePreflight(null)).toBe('');
  });

  test('a clean prompt says so rather than saying nothing', () => {
    // rejects: a describePreflight that trails off with an empty tier list on
    // the one input an author most wants confirmation about.
    const line = describePreflight(preflightPrompt(ok({
      instructions: '- The answers: {responsesText}\n\nSay what the room decided.',
    })));
    expect(line).toContain('nothing to report');
  });
});
