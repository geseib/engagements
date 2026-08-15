/**
 * The catalogue IS the contract: one list of template variables, checked
 * against the only thing that can actually resolve them.
 *
 * The bug this exists for: three lists disagreed.
 *
 *   - AIPromptManager.jsx advertised 49 variables to the prompt author.
 *   - ai-generate-prompt.js kept its own table keyed `callandanswer`/`polls`,
 *     so a lookup with the dashed `call-and-answer`/`poll`/`survey` the UI
 *     actually sends missed entirely and produced []. The model was then told
 *     "include appropriate template variables from the available list" with no
 *     list under the heading, so it invented them. That is the owner's
 *     complaint — "the AI generator ... will put in all kinds of nonexistent
 *     variables, so the Prompt doesn't work".
 *   - Where that table DID hit, its `wavelength` row named five variables that
 *     have never existed: wordFrequency, uniqueWords, wordStats,
 *     conceptualThemes, customInstructions.
 *   - ai-prompt-advisor.js was asked to "validate variable usage" while being
 *     told nothing whatsoever about which variables exist.
 *
 * Reality is the `templateVars` object built in get-ai-summary.js — the only
 * place a `{token}` is ever substituted. So this file reads THAT object's keys
 * out of the source and holds the catalogue to them in both directions:
 * nothing advertised that cannot resolve, nothing resolvable that is neither
 * advertised nor explicitly declared internal.
 *
 * It also pins the three deployed copies byte-identical. `lambda-functions/
 * admin/` and `lambda-functions/game/` are separate CodeUri (template-clean.yaml)
 * and `src/` is a separate webpack build, so a single shared module is simply
 * not in the other two bundles — the same constraint that already forces three
 * copies of game-types.js. Copies are fine; SILENT copies are not.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const CANONICAL = path.join(REPO, 'lambda-functions', 'game', 'template-variables.js');
const COPIES = [
  path.join(REPO, 'lambda-functions', 'admin', 'shared', 'template-variables.js'),
  path.join(REPO, 'src', 'src', 'config', 'templateVariables.js'),
];

const catalogue = require(CANONICAL);
const {
  TEMPLATE_VARIABLES,
  INTERNAL_TEMPLATE_VARIABLES,
  VARIABLE_CATEGORY_ORDER,
  isKnownTemplateVariable,
  variablesForGameType,
  variableCategoriesForGameType,
  extractVariableTokens,
  unknownVariableTokens,
} = catalogue;

let pass = 0, fail = 0;
function check(label, fn) {
  try {
    const r = fn();
    assert(!(r && typeof r.then === 'function'), 'check() takes a synchronous assertion');
    console.log(`  PASS  ${label}`); pass++;
  } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/**
 * Top-level keys of the `const templateVars = { ... }` literal in
 * get-ai-summary.js.
 *
 * Read from source rather than by running the handler because building that
 * object for real needs a seeded game, a question, answers, votes and scores —
 * a fixture heavy enough that people would stop updating it, which is the
 * failure mode this whole file exists to prevent. Depth-tracked so the arrow
 * IIFEs and template literals nested inside values cannot contribute keys.
 */
function templateVarKeysFromSource() {
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');
  const start = src.indexOf('const templateVars = {');
  assert(start !== -1, 'could not find `const templateVars = {` — has it been renamed?');
  let i = src.indexOf('{', start);
  let depth = 0;
  const keys = [];
  let atKeyPosition = false;

  for (; i < src.length; i++) {
    const c = src[i];
    const two = src.slice(i, i + 2);

    if (two === '//') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (two === '/*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === quote) break;
      }
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (depth === 1) atKeyPosition = true;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) break;
      if (depth === 1) atKeyPosition = false;
      continue;
    }
    if (depth === 1 && c === ',') { atKeyPosition = true; continue; }
    if (depth === 1 && atKeyPosition && /[A-Za-z_$]/.test(c)) {
      const rest = src.slice(i);
      const m = rest.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (m) { keys.push(m[1]); i += m[0].length - 1; }
      atKeyPosition = false;
      continue;
    }
  }
  return keys;
}

const runtimeKeys = templateVarKeysFromSource();
const advertised = TEMPLATE_VARIABLES.map((v) => v.name);
const internal = INTERNAL_TEMPLATE_VARIABLES.map((v) => v.name);

console.log('Template variable catalogue: one list, held to what actually resolves\n');

// === 0. The reader itself is not lying =====================================
check('the templateVars parser found a plausible object (60+ keys, known members)', () => {
  assert(runtimeKeys.length >= 60,
    `parsed only ${runtimeKeys.length} keys — the parser is broken, so every check below is vacuous`);
  for (const known of ['questionTitle', 'pollOptions', 'contextInstructions', 'teamScore']) {
    assert(runtimeKeys.includes(known), `parser missed the known key ${known}`);
  }
  // Anything from inside a nested IIFE would mean the depth tracking leaked.
  assert(!runtimeKeys.includes('opts'), 'parser leaked an identifier from a nested scope');
});

check('templateVars declares no key twice', () => {
  const dupes = runtimeKeys.filter((k, idx) => runtimeKeys.indexOf(k) !== idx);
  assert.deepStrictEqual(dupes, [], `duplicate keys silently shadow: ${dupes.join(', ')}`);
});

// === 1. Nothing advertised that cannot resolve =============================
check('every catalogued variable is one get-ai-summary actually substitutes', () => {
  const phantom = advertised.filter((n) => !runtimeKeys.includes(n));
  assert.deepStrictEqual(phantom, [],
    `advertised but never substituted, so it renders as literal {text} on a projector: ${phantom.join(', ')}`);
});

check('every internal variable is one get-ai-summary actually substitutes', () => {
  const phantom = internal.filter((n) => !runtimeKeys.includes(n));
  assert.deepStrictEqual(phantom, [],
    `declared internal but does not exist: ${phantom.join(', ')}`);
});

check('the five phantom wavelength variables are gone for good', () => {
  for (const ghost of ['wordFrequency', 'uniqueWords', 'wordStats', 'conceptualThemes', 'customInstructions']) {
    assert(!isKnownTemplateVariable(ghost),
      `${ghost} was in ai-generate-prompt.js's wavelength row and has never existed`);
  }
});

// === 2. Nothing resolvable left undeclared =================================
check('every templateVars key is either catalogued or explicitly internal', () => {
  const orphans = runtimeKeys.filter((k) => !advertised.includes(k) && !internal.includes(k));
  assert.deepStrictEqual(orphans, [],
    'a variable that resolves but is in neither list is invisible to authors AND rejected at save time: ' +
    orphans.join(', '));
});

check('the variables an author most needs are advertised, not buried', () => {
  // pollOptions is the named gap: a poll author could not reference the options.
  // playerResponses is used by the live sets/prompt-trivia-vj.json.
  for (const n of ['pollOptions', 'playerResponses', 'wordAnalysis', 'totalUniqueWords']) {
    assert(advertised.includes(n), `${n} must be a chip, not a secret`);
  }
});

check('a name is never both advertised and internal', () => {
  const both = advertised.filter((n) => internal.includes(n));
  assert.deepStrictEqual(both, [], `ambiguous: ${both.join(', ')}`);
});

check('every internal variable says why it is internal', () =>
  INTERNAL_TEMPLATE_VARIABLES.forEach((v) =>
    assert(typeof v.reason === 'string' && v.reason.length > 10,
      `${v.name} is hidden from authors with no stated reason`)));

// === 3. Entries are fit to render ==========================================
check('no catalogue entry is half-filled', () =>
  TEMPLATE_VARIABLES.forEach((v) => {
    for (const field of ['name', 'description', 'category', 'example']) {
      assert(typeof v[field] === 'string' && v[field].trim().length > 0,
        `${v.name || '(unnamed)'}.${field} is empty — it renders as "undefined" in a chip tooltip`);
    }
    assert(Array.isArray(v.gameTypes) && v.gameTypes.length > 0,
      `${v.name} lists no game types, so it is available nowhere`);
  }));

check('no catalogue entry is declared twice', () => {
  const dupes = advertised.filter((n, i) => advertised.indexOf(n) !== i);
  assert.deepStrictEqual(dupes, [], `duplicate chips: ${dupes.join(', ')}`);
});

check('every gameTypes entry is a canonical dashed id', () => {
  const CANON = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];
  TEMPLATE_VARIABLES.forEach((v) => v.gameTypes.forEach((t) =>
    assert(CANON.includes(t),
      `${v.name} lists "${t}"; the legacy spellings callandanswer/polls are what split this vocabulary in the first place`)));
});

check('every category used by a variable is in the declared order', () =>
  TEMPLATE_VARIABLES.forEach((v) =>
    assert(VARIABLE_CATEGORY_ORDER.includes(v.category),
      `${v.name} is in category "${v.category}", which the palette would never draw a header for`)));

check('the declared order contains no category no variable uses', () => {
  const used = new Set(TEMPLATE_VARIABLES.map((v) => v.category));
  const dead = VARIABLE_CATEGORY_ORDER.filter((c) => !used.has(c));
  assert.deepStrictEqual(dead, [],
    `dead header(s): ${dead.join(', ')} — "Context" was one of these, hardcoded into the palette and declared by nothing`);
});

check('Wavelength is a real category with variables behind it', () => {
  assert(VARIABLE_CATEGORY_ORDER.includes('Wavelength'));
  const wl = TEMPLATE_VARIABLES.filter((v) => v.category === 'Wavelength');
  assert(wl.length >= 6,
    `only ${wl.length} wavelength variables; the palette used to omit this header so all of them were unreachable`);
});

// === 4. Per-game-type derivation ===========================================
check('every game type the editor offers gets a non-empty variable list', () =>
  ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'].forEach((t) =>
    assert(variablesForGameType(t).length > 0,
      `${t} yields []; an empty list under "AVAILABLE TEMPLATE VARIABLES:" is what made the model invent them`)));

check('variablesForGameType actually filters rather than returning everything', () => {
  const trivia = variablesForGameType('trivia').map((v) => v.name);
  const poll = variablesForGameType('poll').map((v) => v.name);
  assert(trivia.includes('correctAnswer'), 'trivia must offer correctAnswer');
  assert(!poll.includes('correctAnswer'), 'a poll has no correct answer');
  assert(poll.includes('pollOptions'), 'a poll author must be able to reference the options');
  assert(!trivia.includes('pollOptions'), 'trivia has triviaChoices, not pollOptions');
});

check('wavelength offers its own variables and not the vote ones', () => {
  const wl = variablesForGameType('wavelength').map((v) => v.name);
  assert(wl.includes('commonWords') && wl.includes('connectionScore'));
  assert(!wl.includes('voteTally'), 'wavelength never votes');
});

check('variableCategoriesForGameType drops headers with nothing under them', () => {
  const cats = variableCategoriesForGameType('wavelength');
  assert(cats.includes('Wavelength'));
  assert(!cats.includes('Vote Tally'),
    'an empty header is the palette bug in the other direction');
  assert.deepStrictEqual(cats, VARIABLE_CATEGORY_ORDER.filter((c) => cats.includes(c)),
    'categories must come back in the declared order');
});

// === 4b. THE 2026-08-15 METADATA AUDIT ====================================
/*
  WHAT THESE PIN, AND WHY THEY ARE HERE RATHER THAN IN A DOC.

  Every `gameTypes` list in the catalogue is a claim about get-ai-summary.js:
  "a real round of this type substitutes this variable with something about
  that round". A wrong claim does not error — the key exists on every path, so
  the token is substituted with '' and the sentence built around it silently
  loses its content. That is the same mechanism, one level up, as the live
  summary that read "I notice you haven't provided the [Summary of the core
  idea/response being analyzed] yet".

  So each check below re-derives its claim from the HANDLER SOURCE rather than
  restating the catalogue. A check that only compared the catalogue to itself
  would pass for any pair of consistent lies, which is exactly the fixture
  failure this repo has already shipped twice.
*/
const summarySource = fs.readFileSync(
  path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');

const typesFor = (name) => (TEMPLATE_VARIABLES.find((v) => v.name === name) || {}).gameTypes || [];

check('the always-empty variables are exactly the ones hardcoded to \'\' in the handler', () => {
  /*
    Derived, not listed. Any `name: '',` at the top level of the templateVars
    literal is a variable that cannot carry anything on any path — and the
    catalogue must mark precisely those, no more and no fewer.

    rejects: marking a variable alwaysEmpty because it looks useless, and the
    opposite — restoring participationRate or votingParticipation to the
    insertable palette without restoring a real figure behind them. Both were
    100% by construction and were read aloud to the room (:1530-1551).
  */
  const literal = summarySource.slice(summarySource.indexOf('const templateVars = {'));
  const end = literal.indexOf('\n  };');
  const hardcodedEmpty = [...literal.slice(0, end).matchAll(/^\s{4}([A-Za-z_$][\w$]*):\s*''\s*,/gm)]
    .map((m) => m[1]).sort();
  const marked = TEMPLATE_VARIABLES.filter((v) => v.alwaysEmpty).map((v) => v.name).sort();
  assert.deepStrictEqual(marked, hardcodedEmpty,
    `the handler hardcodes [${hardcodedEmpty}] to the empty string; the catalogue marks [${marked}]`);
  assert(marked.length > 0, 'the parser found nothing — every assertion here would be vacuous');
});

check('an always-empty variable is offered by no game type, and still resolves', () => {
  // rejects: deleting them outright. A token with no key at all survives the
  // substitution loop and lands on a projector as literal {participationRate};
  // a live prompt already using one must keep rendering blank, not braces.
  for (const v of TEMPLATE_VARIABLES.filter((x) => x.alwaysEmpty)) {
    assert(isKnownTemplateVariable(v.name), `${v.name} must stay resolvable`);
    for (const t of ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']) {
      assert(!variablesForGameType(t).some((x) => x.name === v.name),
        `${v.name} is offered for ${t}, where it carries nothing`);
    }
  }
});

check('pollOptions is offered to polls and NOT to surveys', () => {
  /*
    The audit's clearest single correction. `pollOptions` was tagged
    ['poll','survey']; its only assignment is inside
    `gameType === 'polls' || gameType === 'poll'`, so a survey round leaves it
    at the '' it was initialised to.

    rejects: putting survey back on that entry. Also asserts the branch it
    depends on still reads that way — if the handler ever adds survey to the
    condition, this test is where the catalogue gets told.
  */
  assert(summarySource.includes("gameType === 'polls' || gameType === 'poll'"),
    'the poll branch condition has changed; re-derive pollOptions before trusting its tag');
  assert.deepStrictEqual(typesFor('pollOptions'), ['poll']);
});

check('triviaResponses is offered to polls too, because the poll branch assigns it', () => {
  // rejects: trusting the NAME. It is assigned twice — once in the trivia
  // branch and once in the poll branch, where it formats as "option: n votes".
  // Tagging it trivia-only left a poll author with no per-option distribution.
  const assignments = [...summarySource.matchAll(/^\s*triviaResponses = /gm)].length;
  assert.strictEqual(assignments, 2,
    `expected two assignments to triviaResponses (trivia and poll); found ${assignments}`);
  assert.deepStrictEqual(typesFor('triviaResponses').sort(), ['poll', 'trivia']);
});

check('the ballot-derived variables exclude the two types that never store a vote', () => {
  /*
    :803 gates the whole tally loop on `gameType !== 'trivia' && !== 'wavelength'`,
    so firstPlace/secondPlace/thirdPlace are zero for those two and every figure
    built from them is a row of zeroes.

    rejects: re-adding trivia to votingBreakdown or voteCount, which is the tag
    they carried before poll and survey were even considered.
  */
  assert(/gameType !== 'trivia' && gameType !== 'wavelength'/.test(summarySource),
    'the vote-loop guard has changed; re-derive the ballot variables');
  for (const name of ['voteCount', 'votingBreakdown', 'votingPattern', 'activeParticipants']) {
    const types = typesFor(name);
    assert(!types.includes('trivia'), `${name} must not be offered to trivia`);
    assert(!types.includes('wavelength'), `${name} must not be offered to wavelength`);
    assert(types.includes('poll'), `${name} must be offered to polls, which do vote`);
  }
});

check('scoringSystem is not offered to trivia, whose points come from somewhere else', () => {
  /*
    The correction that runs the other way: it was advertised to trivia and
    actively misinforms there. :1703 builds it from ScoringConfig's first/
    second/third-place VOTE ranks; a trivia round awards `answer.PointsEarned`
    (base + speed bonus) and never consults that config. So a trivia prompt
    naming it told the model a scoring scheme the round did not use.

    rejects: restoring trivia here on the grounds that trivia "has scores".
  */
  assert(summarySource.includes('PointsEarned || answer.pointsEarned'),
    'trivia scoring no longer reads PointsEarned; re-derive scoringSystem');
  assert(!typesFor('scoringSystem').includes('trivia'));
});

check('the score variables exclude wavelength alone, which writes no player score row', () => {
  // rejects: leaving the old SCORED_TYPES = ['call-and-answer','trivia'] in
  // place. Poll and survey take get-results.js's vote path, which writes
  // PLAYER#…#SCORE rows exactly as call-and-answer does; wavelength is routed
  // to handleWavelengthResults, which writes none, so the leaderboard is empty
  // for wavelength and only for wavelength.
  const results = fs.readFileSync(path.join(REPO, 'lambda-functions', 'game', 'get-results.js'), 'utf8');
  assert(/if \(gameType === 'wavelength'\) \{\s*\n\s*return await handleWavelengthResults/.test(results),
    'wavelength no longer bypasses the scoring path; re-derive the score variables');
  for (const name of ['cumulativeScores', 'leaderboard', 'playerRankings', 'averageScore', 'roundScores']) {
    assert.deepStrictEqual(typesFor(name).sort(),
      ['call-and-answer', 'poll', 'survey', 'trivia'],
      `${name} has drifted from the four types that accrue per-player scores`);
  }
});

check('every type gained variables it can actually use', () => {
  // rejects: an audit that only ever REMOVES. The catalogue's real failure was
  // in both directions — poll had 22 of 59 variables and wavelength 27, mostly
  // because entries with no game-type branch at all had been tagged
  // call-and-answer by habit.
  const counts = Object.fromEntries(
    ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']
      .map((t) => [t, variablesForGameType(t).length])
  );
  assert(counts.poll >= 30, `poll offers only ${counts.poll} variables`);
  assert(counts.wavelength >= 28, `wavelength offers only ${counts.wavelength} variables`);
  assert(counts.survey >= 28, `survey offers only ${counts.survey} variables`);
});

check('{questionInfo} exists, is composite, and labels both halves', () => {
  /*
    The owner's own `{questioninfo}`: his model of a prompt opens with one line
    for "here is what was asked", and until now that took two variables and two
    hand-written labels — a prompt that wrote only the first silently dropped
    the context the question depends on.

    rejects: adding the catalogue entry without adding the key (the token would
    render as literal braces on a projector) and adding a key that is just an
    alias of questionTitle, which would make the composite pointless.
  */
  assert(isKnownTemplateVariable('questionInfo'));
  assert.deepStrictEqual(typesFor('questionInfo').length, 5, 'every type asks a question');
  // Search FORWARD from questionInfo. `triviaChoices` is also declared as a
  // `let` some three hundred lines earlier, so a bare indexOf for the closing
  // marker returns a position BEFORE the opening one and slices an empty
  // string — which passed every `includes` check by being vacuous. Caught by
  // mutating the handler and watching this check stay green.
  const from = summarySource.indexOf('questionInfo: [');
  assert(from !== -1, 'questionInfo is not assigned in templateVars');
  const block = summarySource.slice(from, summarySource.indexOf('triviaChoices:', from));
  assert(block.length > 20, 'the slice is empty, so every assertion below is vacuous');
  assert(block.includes('Question: '), 'questionInfo must label the question line');
  assert(block.includes('Detail: '), 'questionInfo must label the detail line');
  assert(block.includes('.filter(Boolean)'),
    'the detail line must be dropped when absent, not printed as a placeholder the model reads as fact');
});

// === 4c. Bracket directions are NOT variables =============================
check('extractBracketDirections finds prose directions and skips markdown links', () => {
  /*
    Square brackets read like a placeholder and are prose. Only {braced} names
    are substituted. That distinction is what made the broken prompt look
    finished, and it is now stated in the editor and listed back to the author.

    rejects: a naive /\[.*\]/ scan that reports every markdown link as a
    direction — a readout that cries wolf is one an author stops reading.
  */
  assert.deepStrictEqual(
    catalogue.extractBracketDirections('## S\n[Summary of the responses]\nSee [the runbook](https://x).'),
    ['Summary of the responses']);
  assert.deepStrictEqual(catalogue.extractBracketDirections('no brackets here'), []);
  assert.deepStrictEqual(catalogue.extractBracketDirections(undefined), []);
  assert.deepStrictEqual(catalogue.extractBracketDirections('[a] and [a]'), ['a'],
    'unique, in order of first appearance, like extractVariableTokens');
});

// === 5. Token extraction — the shared basis of all three gates =============
check('extractVariableTokens finds the tokens and nothing else', () =>
  assert.deepStrictEqual(
    extractVariableTokens('## {questionTitle}\n{responsesText} and {questionTitle} again'),
    ['questionTitle', 'responsesText'],
    'tokens come back unique and in order of first appearance'));

check('extractVariableTokens ignores JSON-ish braces', () =>
  assert.deepStrictEqual(
    extractVariableTokens('Return { "instructions": "x" } and { spaced } and {}'),
    [],
    'a brace with quotes or spaces is not a template variable; treating it as one would reject every prompt containing an example'));

check('unknownVariableTokens names only what is not known', () =>
  assert.deepStrictEqual(
    unknownVariableTokens('{questionTitle} {wordFrequency} {totalPlayers} {nope}'),
    ['wordFrequency', 'nope'],
    'totalPlayers is internal — resolvable, so it must NOT be reported unknown'));

check('unknownVariableTokens tolerates absent text', () => {
  assert.deepStrictEqual(unknownVariableTokens(undefined), []);
  assert.deepStrictEqual(unknownVariableTokens(null), []);
  assert.deepStrictEqual(unknownVariableTokens(''), []);
});

check('isKnownTemplateVariable accepts internal names as well as advertised ones', () => {
  assert.strictEqual(isKnownTemplateVariable('totalPlayers'), true,
    'live trivia prompts use {totalPlayers}; rejecting it would break them');
  assert.strictEqual(isKnownTemplateVariable('leaderboard'), true);
  assert.strictEqual(isKnownTemplateVariable('bananas'), false);
  assert.strictEqual(isKnownTemplateVariable(''), false);
  assert.strictEqual(isKnownTemplateVariable(undefined), false);
});

// === 6. The live prompt installed in dev must survive the gate =============
check('sets/prompt-trivia-vj.json uses only variables that resolve', () => {
  const live = JSON.parse(fs.readFileSync(path.join(REPO, 'sets', 'prompt-trivia-vj.json'), 'utf8'));
  const unknown = [
    ...unknownVariableTokens(live.instructions),
    ...unknownVariableTokens(live.outputFormat),
    ...unknownVariableTokens(live.template),
  ];
  assert.deepStrictEqual(unknown, [],
    `this prompt is installed and working in dev. If the gate rejects it the CATALOGUE is wrong, not the prompt: ${unknown.join(', ')}`);
});

// === 7. The three deployed copies cannot drift =============================
check('the admin and frontend copies are byte-identical to the canonical file', () => {
  const canonical = fs.readFileSync(CANONICAL, 'utf8');
  for (const copy of COPIES) {
    assert(fs.existsSync(copy), `missing copy: ${path.relative(REPO, copy)}`);
    assert.strictEqual(fs.readFileSync(copy, 'utf8'), canonical,
      `${path.relative(REPO, copy)} has drifted from lambda-functions/game/template-variables.js. ` +
      'Separate CodeUri means separate bundles; copy the file rather than editing one.');
  }
});

check('the copies really are loadable modules, not just matching text', () =>
  COPIES.forEach((copy) => {
    const m = require(copy);
    assert.strictEqual(m.TEMPLATE_VARIABLES.length, TEMPLATE_VARIABLES.length);
    assert.strictEqual(m.isKnownTemplateVariable('pollOptions'), true);
  }));

check('the catalogue requires nothing, so the copies stay portable', () => {
  const src = fs.readFileSync(CANONICAL, 'utf8');
  assert(!/\brequire\s*\(/.test(src),
    'a require() here would resolve to a different path in each of the three bundles');
});

// === 8. The PROSE must not promise what the engine does not emit ==========
/*
  THE DEFECT THIS EXISTS FOR, and it shipped.

  `topVotedAnswers` was described as "Top 3 most-voted responses with their vote
  detail", with the example "Alice's response (13 points)". Both were false for
  every game type except trivia: get-ai-summary.js branches, and the non-trivia
  arm emits `${playerName}: ${score} vote points` — a name and a number, no
  response text at all. Under anonymity the name degrades too.

  It survived the whole game-type audit because that pass checked `gameTypes`
  against the engine and took the DESCRIPTION on trust. That asymmetry is the
  point: a wrong tag renders empty and somebody notices, while wrong prose sends
  an author to the wrong variable and the prompt still produces confident output
  about nothing. A handoff doc recommended it for exactly the round it cannot
  serve.

  So this reads the engine, not the catalogue's opinion of the engine.
*/
check('topVotedAnswers does not claim to carry response text it never emits', () => {
  const engine = fs.readFileSync(
    path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');

  // The non-trivia arm of topAnswers_formatted, which becomes topVotedAnswers.
  const at = engine.indexOf('const topAnswers_formatted');
  assert(at > -1, 'topAnswers_formatted has moved; re-point this assertion');
  const branch = engine.slice(at, at + 400);
  /*
    THE NON-TRIVIA ARM IS THE SECOND `topAnswers.map(`, NOT "everything after
    the first colon". My first version sliced on `indexOf(':')`, which lands
    inside the template literal `${a.playerName}: ${a.answer}` in the TRIVIA
    arm — so it read the trivia branch, found `a.answer`, and reported that the
    engine had started carrying response text. A test that cannot tell the two
    arms apart is worse than none here, because its failure message tells you
    to delete the assertion.
  */
  const firstMap = branch.indexOf('topAnswers.map(');
  const secondMap = branch.indexOf('topAnswers.map(', firstMap + 1);
  assert(secondMap > -1, 'topAnswers_formatted is no longer a two-arm ternary; re-point this');
  const nonTrivia = branch.slice(secondMap);

  const carriesText = /a\.answer\b|answerText/.test(nonTrivia);
  const entry = TEMPLATE_VARIABLES.find((v) => v.name === 'topVotedAnswers');
  assert(entry, 'topVotedAnswers is gone from the catalogue');

  if (!carriesText) {
    // rejects: restoring prose that implies the responses themselves are here.
    const says = `${entry.description} ${entry.example || ''}`;
    assert(/no response text|name and points/i.test(says),
      'the engine emits no response text on the non-trivia path, so the description '
      + 'must say so plainly. Use {responsesText} for the text of every response.');
  } else {
    assert.fail('the engine now DOES carry answer text on the non-trivia path — '
      + 'update the catalogue description and delete this branch.');
  }
});

// === 9. Two more entries that promised what the engine never emits =========
/*
  THE SAME DEFECT AS topVotedAnswers, FOUND TWICE MORE while rewriting the
  default prompts. Both were caught by reading get-ai-summary.js; neither was
  visible from the catalogue, which is the whole point.

  uniqueAnswers  :1644-1645  [...new Set(...)].slice(0, 5).join(', ')
      claimed "with how many chose each", example "Ship it Friday (5)".
      No counts exist, and everything past the FIFTH distinct answer is
      dropped in silence — a room of thirty reads as five. Worse than the
      topVotedAnswers case because uniqueAnswers is in promptPreflight's
      ANSWER_TOKENS: a prompt SATISFIES the blocking "you receive no answers"
      rule with it and is then handed less than it asked for.

  answerCategories :1648-1650  a ternary between two literal sentences
      claimed "Responses grouped into themes", example "Speed-first (5)".
      There is no grouping anywhere. The value is a sentence about a count
      that happens to contain the word "themes", so a prompt told to use
      those themes will invent them.
*/
check('uniqueAnswers admits it has no counts and truncates', () => {
  const engine = fs.readFileSync(
    path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');
  const at = engine.indexOf('const uniqueAnswersText');
  assert(at > -1, 'uniqueAnswersText has moved; re-point this assertion');
  const line = engine.slice(at, at + 200);

  const truncates = /slice\(0,\s*5\)/.test(line);
  const hasCounts = /length|count|\(\$\{/.test(line.split('join')[0].replace('slice(0, 5)', ''));
  const entry = TEMPLATE_VARIABLES.find((v) => v.name === 'uniqueAnswers');
  const says = `${entry.description} ${entry.example || ''}`;

  if (truncates) {
    // rejects: prose that hides the cap, which is what made this survivable.
    assert(/truncat|five|only the first/i.test(says),
      'the engine slices to five and the description must say so');
  }
  if (!hasCounts) {
    // rejects: restoring "with how many chose each" or a "(5)" example.
    assert(!/\(\d+\)/.test(says) && /no counts/i.test(says),
      'the engine emits a bare join with no counts; the description must not imply any');
  }
});

check('answerCategories does not claim themes it cannot supply', () => {
  const engine = fs.readFileSync(
    path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');
  const at = engine.indexOf('const answerCategories');
  assert(at > -1, 'answerCategories has moved; re-point this assertion');
  const body = engine.slice(at, at + 300);

  // The value is built from string literals only — no reduce, no map, no
  // grouping of any kind. That is what makes "themes" a false promise.
  const groups = /\.reduce\(|\.map\(|groupBy/.test(body);
  const entry = TEMPLATE_VARIABLES.find((v) => v.name === 'answerCategories');
  const says = `${entry.description} ${entry.example || ''}`;

  if (!groups) {
    // rejects: "Responses grouped into themes" and a "Speed-first (5)" example.
    assert(/not themes|no grouping/i.test(says),
      'nothing groups anything here; the description must say the themes are not real');
    assert(!/^\s*Speed-first/.test(entry.example || ''),
      'the example must not invent themes the engine cannot produce');
  }
});

// === 10. The blocking rule's token list must name only real variables ======
check('every ANSWER_TOKEN is a variable that actually resolves', () => {
  /*
    This list decides whether a summary prompt is BLOCKED, so a name in it that
    is not a variable lets a prompt clear the rule with a token that renders as
    literal braces on a projector. Three did: answerCount, topAnswer and
    winningAnswer appear in neither the catalogue nor the engine.
  */
  const pf = fs.readFileSync(
    path.join(REPO, 'src', 'src', 'utils', 'promptPreflight.js'), 'utf8');
  const block = pf.slice(pf.indexOf('const ANSWER_TOKENS'));
  const list = block.slice(0, block.indexOf(']'));
  const tokens = [...list.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert(tokens.length >= 5, `parsed too few ANSWER_TOKENS: ${tokens.length}`);

  const known = new Set(TEMPLATE_VARIABLES.map((v) => v.name));
  const phantom = tokens.filter((t) => !known.has(t));
  assert.deepStrictEqual(phantom, [],
    `ANSWER_TOKENS names variables that do not exist: ${phantom.join(', ')} — `
    + 'a prompt can satisfy the blocking rule with one and receive nothing.');
});

/* ==========================================================================
   THE WITHHELD REVEAL, AND THE TAG THAT HID IT
   ==========================================================================

   Reported on the art round: "the AI mentions that the real name would be
   revealed. i think that is data in the question set but it is not revealed."

   The data was there and the plumbing was right. `AnswerDetails` is stored for
   every engagement type (upload-questions.js:588-601 lifted the trivia gate)
   and is carried by NO player or host payload, which is exactly the property a
   reveal needs. get-ai-summary.js reads it with no game-type branch.

   What was wrong was ONE TAG in this catalogue: `gameTypes: ['trivia']`, left
   behind when the importer's gate was lifted. `variablesToOffer()` filters the
   editor's variable panel by that field, so {answerDetails} was never offered
   while writing a call-and-answer prompt — the author described the reveal in
   prose and never inserted the tag.

   Nothing failed. The usage gate checks catalogue MEMBERSHIP, not type, so the
   prompt saved cleanly and simply had nothing to say. That is this file's
   stated failure mode one level up: "a variable that resolves to nothing does
   not error, does not warn, and does not leave visible braces."
*/

check('the reveal field is offered for every type that can carry it', () => {
  // rejects: the stale `gameTypes: ['trivia']`. This is the assertion that
  // would have caught the original defect, and it fails against it.
  for (const name of ['answerDetails', 'reveal']) {
    const v = TEMPLATE_VARIABLES.find((x) => x.name === name);
    assert.ok(v, `${name} is not in the catalogue`);
    assert.deepStrictEqual(
      [...v.gameTypes].sort(),
      ['call-and-answer', 'poll', 'survey', 'trivia', 'wavelength'],
      `${name} is tagged for fewer types than upload-questions.js stores it for`
    );
  }
});

check('{reveal} is a real substitution, not a name in a list', () => {
  /*
    rejects: advertising an alias the engine never assigns — which would put a
    findable name in the picker that silently resolves to nothing, the exact
    shape of the bug being fixed. Read from get-ai-summary's source, the same
    way every other assertion in this file establishes reality.
  */
  const src = fs.readFileSync(
    path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');
  assert.match(src, /\breveal:\s*question\.answerDetails/,
    'get-ai-summary does not assign `reveal`, so the catalogue is advertising nothing');
});

check('{reveal} is empty rather than prose when the author left it blank', () => {
  /*
    rejects: `question.answerDetails || 'No explanation provided'` for the alias.
    That literal is a trivia-era default and reads as prose inside a sentence
    built around a reveal — "the real title is No explanation provided". A short
    sentence is recoverable; a confident wrong one is not.
  */
  const src = fs.readFileSync(
    path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');
  const line = src.split('\n').find((l) => /\breveal:\s*question\.answerDetails/.test(l));
  assert.ok(line, 'no `reveal` assignment found');
  assert.doesNotMatch(line, /No explanation provided/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
