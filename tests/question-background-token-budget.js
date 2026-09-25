/**
 * THE GENERATORS ARE BUDGETED FOR THE ITEM THEY NOW ASK FOR.
 *
 * ── THE GAP ────────────────────────────────────────────────────────────────
 *
 * The question-background work made `background` a REQUIRED field in both tool
 * schemas — up to 600 characters on a Call & Answer item, 400 on a trivia one —
 * and raised no output budget to pay for it. structured-generation.js had no
 * `call-and-answer` entry at all (it fell through to `default: 420`, which was
 * sized before Apply/Improve rounds could carry a 900-character detail), and
 * trivia stayed at 380. A worst-case item then costs more than its budget, the
 * pass hits max_tokens, the halved retry is priced from the same per-item
 * figure and truncates again — the wavelength incident's shape
 * (scenario-generation-job.js, "the wavelength budget pays for the WIRE
 * shape"), on the two types that write the most.
 *
 * ── THE CHECK ──────────────────────────────────────────────────────────────
 *
 * The worst case is COMPUTED FROM THE LIVE LIMITS — parsed out of the length
 * guidance each generator actually sends, and out of the tool schema's own
 * property list — so raising a limit in a prompt without raising the budget
 * fails here. The arithmetic matches the comment on PER_ITEM_TOKENS:
 *
 *   tokens(chars) = ceil(chars / 3.5)        conservative for English prose
 *   + 5 tokens per JSON key                  "key": "…",
 *   + 2 for the item's braces
 *   × 1.2                                    a model overshoots a stated maximum;
 *                                            clampBackground trims only AFTER the
 *                                            tokens were paid for
 *
 * rejects: a per-item budget under that figure; a budget that is only the
 *          default by accident; a full pass or a halved retry that cannot hold
 *          its worst-case items; the trivia worker reading a different budget
 *          key than the one pinned here.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const sg = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'));
const { ROUND_KIND_IDS } = require(path.join(REPO, 'lambda-functions/admin/shared/round-kinds.js'));
const { MAX_TAGS } = require(path.join(REPO, 'lambda-functions/admin/shared/tags.js'));
const trivia = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));

// ---- The arithmetic ---------------------------------------------------------
const CHARS_PER_TOKEN = 3.5;
const OVERRUN = 1.2;
const KEY_TOKENS = 5;
const BRACES = 2;
// Fields the prompts bound in words or not at all, sized generously.
const WORD_CHARS = 8;          // "3-10 words" → 10 × 8 characters
const LABEL_CHARS = 40;        // category, school
const TAG_CHARS = 20;          // a kebab-case tag, "conflict-resolution"
const LIST_PUNCT_TOKENS = 3;   // "…", in an array
const tok = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

/** `- <field>: … N characters maximum` out of a LENGTH LIMITS block. */
function charLimit(text, field) {
  const m = text.match(new RegExp(`^- ${field}:[^\\n]*?(\\d+) characters maximum`, 'm'));
  assert.ok(m, `no "${field}: … N characters maximum" line in the length guidance`);
  return Number(m[1]);
}
function titleWords(text) {
  const m = text.match(/^- title: \d+-(\d+) words/m);
  assert.ok(m, 'no "title: a-b words" line in the length guidance');
  return Number(m[1]);
}
const tagTokens = () => MAX_TAGS * (tok(TAG_CHARS) + LIST_PUNCT_TOKENS);
const keyTokens = (schemaItem) => Object.keys(schemaItem.properties).length * KEY_TOKENS + BRACES;

// ---- Call & Answer: the worst ROUND KIND is the one that sets the budget -----
function callAndAnswerWorst(kind) {
  const guidance = sg.lengthGuidance('call-and-answer', kind);
  const item = sg.buildItemsTool('call-and-answer', kind).input_schema.properties.items.items;
  assert.ok(item.properties.background, 'the call-and-answer schema no longer asks for background');
  return tok(titleWords(guidance) * WORD_CHARS)
    + tok(LABEL_CHARS)                                  // category
    + tok(charLimit(guidance, 'detail'))
    + tok(charLimit(guidance, 'customInstructions'))
    + tok(charLimit(guidance, 'background'))
    + tagTokens()
    + keyTokens(item);
}
const caWorst = Math.max(...ROUND_KIND_IDS.map(callAndAnswerWorst));

// ---- Trivia: six options, all six correct -----------------------------------
function triviaWorst() {
  const config = { numChoices: 6, numCorrect: 6, topic: 't', difficulty: 'medium', categories: 2 };
  const guidance = trivia.buildPrompt({ config, count: 1, alreadyUsedTitles: [] });
  const item = trivia.buildTool(config).input_schema.properties.items.items;
  assert.ok(item.properties.background, 'the trivia schema no longer asks for background');
  const optionIds = Object.keys(item.properties).filter((key) => /^option[A-F]$/.test(key));
  return tok(titleWords(guidance) * WORD_CHARS)
    + tok(charLimit(guidance, 'questionDetail'))
    + tok(LABEL_CHARS)                                  // category
    + optionIds.length * tok(charLimit(guidance, 'each option'))
    + config.numCorrect * (tok('OptionA'.length) + LIST_PUNCT_TOKENS)
    + tok(charLimit(guidance, 'answerDetails'))
    + tok(LABEL_CHARS)                                  // school
    + tok('medium'.length)                              // difficulty
    + tagTokens()
    + tok(charLimit(guidance, 'background'))
    + keyTokens(item);
}
const triviaWorstCase = triviaWorst();

// ---- The checks ---------------------------------------------------------------
for (const [kind, worst] of [['call-and-answer', caWorst], ['trivia', triviaWorstCase]]) {
  say(`\n${kind}: worst case ${worst} tokens, ${Math.ceil(worst * OVERRUN)} with overrun headroom`);
  const perItem = sg.perItemTokens(kind);

  check('has an explicit budget of its own, not the default by accident', () =>
    assert.ok(Object.prototype.hasOwnProperty.call(sg.PER_ITEM_TOKENS, kind),
      `PER_ITEM_TOKENS has no '${kind}' entry; it falls through to default: ${sg.PER_ITEM_TOKENS.default}`));

  check('the per-item budget covers the worst-case item with headroom', () =>
    assert.ok(perItem >= Math.ceil(worst * OVERRUN),
      `${kind} is budgeted at ${perItem} tokens/item; a worst-case item needs ${Math.ceil(worst * OVERRUN)}`));

  check('a full pass holds its worst-case items and stays inside one call', () => {
    const n = sg.itemsPerCall(kind);
    assert.ok(n >= 1);
    assert.ok(sg.maxTokensFor(kind, n) >= n * worst,
      `${n} items get ${sg.maxTokensFor(kind, n)} tokens; worst case is ${n * worst}`);
    assert.ok(sg.maxTokensFor(kind, n) <= sg.MAX_TOKENS_PER_CALL);
  });

  // The truncation retry halves the chunk and re-prices it with the same
  // per-item figure, so it is only a rescue if that figure is right.
  check('the halved retry is priced for its worst-case items too', () => {
    const halved = Math.max(1, Math.floor(sg.itemsPerCall(kind) / 2));
    assert.ok(sg.maxTokensFor(kind, halved) >= halved * worst,
      `a halved pass of ${halved} gets ${sg.maxTokensFor(kind, halved)} tokens; worst case is ${halved * worst}`);
  });
}

say('\nthe workers read the keys pinned above');
check('the trivia worker budgets under tokenKind \'trivia\'', () => {
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'), 'utf8');
  assert.match(src, /tokenKind:\s*'trivia'/);
});
check('the scenario worker budgets under the engagement type itself', () => {
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js'), 'utf8');
  assert.match(src, /maxTokens:\s*maxTokensFor\(engagementType,\s*chunkSize\)/);
  assert.match(src, /maxTokens:\s*maxTokensFor\(engagementType,\s*halved\)/);
});

say(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
