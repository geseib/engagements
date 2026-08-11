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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
