/**
 * THE SAVE-TIME GUARDS AGAINST THE LP FAILURE CLASS (game 4856).
 *
 * A prompt whose format carried [square-bracket placeholders] and no response
 * variable saved cleanly and put "the [Summary of the response] placeholder is
 * empty" on a projector. An audit found 26 more stored prompts in the same
 * state across the tiers. These tests hold the wall that stops new ones:
 * the two assertions in admin/shared/template-variable-usage.js, and the
 * wiring that makes create-ai-prompt and update-ai-prompt actually call them.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const {
  ANSWER_TOKENS,
  assertNoBracketDirections,
  assertReceivesResponses,
} = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'template-variable-usage.js'));

let pass = 0; let fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass += 1; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; }
};
const throws = (fn, contains) => {
  try { fn(); } catch (e) {
    assert(e.message.includes(contains), `error should mention "${contains}", got: ${e.message.slice(0, 140)}`);
    return;
  }
  assert.fail('expected a throw and got none');
};

console.log('\nassertNoBracketDirections — brackets are prose, and prose is refused\n');

check('the LP prompt\'s own placeholder is refused, naming the field and the span', () => {
  // rejects: the exact text that shipped. If this passes the gate, the gate
  // guards nothing.
  throws(
    () => assertNoBracketDirections({ outputFormat: '**REVIEWED:**\n[Summary of the core idea/response being analyzed]' }),
    'outputFormat: [Summary of the core idea/response being analyzed]'
  );
});

check('a markdown link is not a direction', () => {
  // rejects: refusing "[label](https://…)" — a link, and the one legitimate
  // bracket the catalogue already excludes.
  assertNoBracketDirections({ instructions: 'see [the docs](https://example.com) for context' });
});

check('clean fields pass, and empty input passes', () => {
  assertNoBracketDirections({ template: 'Review {responsesText} and be kind.' });
  assertNoBracketDirections({});
  assertNoBracketDirections();
});

console.log('\nassertReceivesResponses — a review prompt must be shown the answers\n');

check('a prompt naming no response variable is refused with the fix in the message', () => {
  throws(
    () => assertReceivesResponses({ instructions: 'Judge the room on {questionTitle} and {eventTitle}.' }),
    '{responsesText}'
  );
});

check('any single answer token anywhere satisfies it — including section guidance', () => {
  for (const token of ANSWER_TOKENS) {
    assertReceivesResponses({ instructions: `use {${token}} well` });
  }
  assertReceivesResponses({ instructions: 'no data here', section2: 'quote {voteTally} sparingly' });
});

check('the token list matches promptPreflight\'s ANSWER_TOKENS byte for byte', () => {
  // The editor's advice and the server's wall must not disagree about which
  // prompts are clean — the preflight list already paid for its lessons
  // (three names that were variables of nothing; three real carriers missing).
  const preflight = fs.readFileSync(
    path.join(REPO, 'src', 'src', 'utils', 'promptPreflight.js'), 'utf8'
  );
  const m = preflight.match(/const ANSWER_TOKENS = \[([\s\S]*?)\];/);
  assert(m, 'promptPreflight.js no longer declares ANSWER_TOKENS');
  const theirs = m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual([...ANSWER_TOKENS].sort(), theirs.sort());
});

console.log('\nthe wiring — the handlers actually call the wall\n');

const createSrc = fs.readFileSync(path.join(REPO, 'lambda-functions', 'admin', 'create-ai-prompt.js'), 'utf8');
const updateSrc = fs.readFileSync(path.join(REPO, 'lambda-functions', 'admin', 'update-ai-prompt.js'), 'utf8');

check('create-ai-prompt gates explicitly-declared analysis prompts', () => {
  // Explicit, not inferred: the shipped question-generation prompts use the
  // legacy template field and infer as analysis, and they have no responses
  // to receive. Gating on the inferred type would refuse all of them —
  // promptPreflight.js paid for this lesson when its first version lit up
  // ten defaults at once.
  assert(/if \(requestedPromptType === 'analysis'\) \{/.test(createSrc));
  assert(createSrc.includes('assertNoBracketDirections('));
  assert(createSrc.includes('assertReceivesResponses('));
});

check('update-ai-prompt gates stored-analysis prompts, and only on content edits', () => {
  // A metadata-only edit (name, status, archive) of a legacy broken prompt
  // must still save — the guard fires when the request touches content, and
  // judges the response check on the MERGED result rather than the delta.
  assert(/currentPrompt\.promptType === 'analysis' && touchesContent/.test(updateSrc));
  assert(updateSrc.includes('assertNoBracketDirections('));
  assert(updateSrc.includes('assertReceivesResponses(merged)'));
  assert(/template !== undefined \? template : \(base\.template \|\| ''\)/.test(updateSrc));
});

check('supplying both halves clears a stale legacy template', () => {
  // The near-miss that proved it: the dev repair of Art & Creative Titles
  // rewrote instructions and outputFormat, passed every guard — and the old
  // bracketed layout survived in `template`, which get-ai-summary takes
  // OUTRIGHT and never reads past. An update that authors the two-field
  // shape must retire the single-field one, exactly as if it sent ''.
  assert(/const template = \(rawTemplate === undefined\s*&& instructions !== undefined && outputFormat !== undefined\)\s*\? '' : rawTemplate;/.test(updateSrc));
});

check('both guards run before anything is written', () => {
  for (const [name, src] of [['create', createSrc], ['update', updateSrc]]) {
    const guard = src.indexOf('assertNoBracketDirections(');
    const s3Write = src.indexOf('PutObjectCommand(');
    assert(guard > -1 && s3Write > -1 && guard < s3Write,
      `${name}: the guard must precede the S3 write (guard@${guard}, write@${s3Write})`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
