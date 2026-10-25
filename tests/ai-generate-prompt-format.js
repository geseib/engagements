/**
 * THE ADMIN'S "WRITE / IMPROVE A PROMPT" HELPER (lambda-functions/admin/ai-generate-prompt.js).
 *
 *   1. A reply cut off at the output budget is a failure with a sentence, not
 *      half a prompt handed back as the answer (it had 2000 tokens and no
 *      stop_reason check).
 *   2. The model writes the two halves between tags, as the prompt advisor's
 *      rewrites do; a JSON reply is still read.
 *   3. The example in the prompt uses a variable this game type HAS — it showed
 *      {voteTally} for every type, wavelength included.
 *   4. No padding language in what the model is asked to write.
 *
 * The model call is stubbed at shared/claude-route.js's `send`, which is the
 * one door every call goes through. Plain node; judged by exit code.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const ADMIN = path.join(REPO, 'lambda-functions/admin');
process.env.ACCOUNT_ID = process.env.ACCOUNT_ID || '123456789012';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const claudeRoute = require(path.join(ADMIN, 'shared/claude-route.js'));
const sent = [];
let reply = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '' }] });
claudeRoute.send = async (_client, command) => {
  const body = JSON.parse(command.input.body);
  sent.push(body);
  return { body: new TextEncoder().encode(JSON.stringify(reply(body))) };
};

const generate = require(path.join(ADMIN, 'ai-generate-prompt.js'));
const { variablesForGameType } = require(path.join(ADMIN, 'shared/template-variables.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let failed = 0;
async function test(name, fn) {
  try { await fn(); say(`  PASS  ${name}`); } catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

// An internal call (no groups, no org) is admitted by canAuthorPrompts.
const call = (gameType = 'call-and-answer') => generate.handler({
  requestContext: { http: { method: 'POST' } },
  body: JSON.stringify({ gameType, category: 'lessons-learned', currentInstructions: 'Summarise the room.' }),
});

(async () => {
  await test('the budget is 8000 tokens', async () => {
    sent.length = 0;
    reply = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<instructions>\nA\n</instructions>\n<outputFormat>\n{responsesText}\n</outputFormat>' }] });
    await call();
    assert.strictEqual(sent[0].max_tokens, 8000);
  });

  await test('a reply that hit max_tokens fails with a sentence and is not asked again', async () => {
    sent.length = 0;
    reply = () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '<instructions>\nhalf a prom' }] });
    const res = await call();
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 502);
    assert.match(body.message, /ran past its length limit/);
    assert.match(body.message, /nothing was changed/);
    assert.strictEqual(sent.length, 1, 'the fallback has the same budget; asking it again only repeats the cut');
  });

  await test('the reply is read from its tags, verbatim', async () => {
    reply = () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '<instructions>\nSay what the room said.\nKeep it "short".\n</instructions>\n<outputFormat>\n**What the room said**\n{responsesText}\n</outputFormat>' }],
    });
    const res = await call();
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body.instructions, 'Say what the room said.\nKeep it "short".');
    assert.strictEqual(body.outputFormat, '**What the room said**\n{responsesText}');
    assert.match(sent[sent.length - 1].messages[0].content, /<instructions>[\s\S]*<\/outputFormat>/, 'the prompt asks for the tagged format');
  });

  await test('a JSON reply is still read', () => {
    const parsed = generate.parseGeneratedContent({
      content: [{ type: 'text', text: 'Here: {"instructions": "I", "outputFormat": "O"}' }],
    }, 'custom', 'x');
    assert.deepStrictEqual(parsed, { instructions: 'I', outputFormat: 'O' });
  });

  await test('the example variable is one the game type has', async () => {
    for (const gameType of ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']) {
      const [name] = generate.exampleVariableFor(gameType);
      assert.ok(variablesForGameType(gameType).some((v) => v.name === name), `${gameType}: {${name}} is not in its catalogue`);
    }
    assert.notStrictEqual(generate.exampleVariableFor('wavelength')[0], 'voteTally');
    assert.notStrictEqual(generate.exampleVariableFor('poll')[0], 'voteTally', 'a poll has no vote');
    sent.length = 0;
    await call('wavelength');
    // The example block only: the save rules (template-variable-usage.js) name
    // {voteTally} as a preference for the types that have it.
    const prompt = sent[0].messages[0].content;
    const example = prompt.slice(prompt.indexOf('EXAMPLE OF A CORRECT outputFormat'), prompt.indexOf('HOW TO WRITE IT'));
    assert.ok(example.length > 0, 'no example block found');
    assert.ok(!example.includes('{voteTally}'), 'the wavelength example still shows {voteTally}');
    assert.ok(example.includes('{commonWords}'));
  });

  await test('no padding language is asked for', async () => {
    sent.length = 0;
    await call();
    const prompt = sent[0].messages[0].content;
    for (const phrase of [/comprehensive frameworks/i, /deep expertise/i, /domain expertise/i, /enhance them with more detail/i, /expert AI prompt engineer/i]) {
      assert.ok(!phrase.test(prompt), `the prompt still says ${phrase}`);
    }
  });

  say(`\n${failed ? `${failed} failed` : 'all passed'}`);
  if (failed) process.exit(1);
})();
