/**
 * THE SUGGESTION CALL (lambda-functions/game/followup-asks.js), with the model
 * faked — no model API is ever called here.
 *
 *   - the request: Sonnet 4.6 on Bedrock, one user turn (no prefill), no
 *     temperature, the tool forced; and what claude-route.js makes of it for
 *     the 5.5 models: `auto` plus the sentence naming the tool, and a reply
 *     without the tool call treated as a failure (so it falls back);
 *   - a good tool call is read and checked; no tool call, junk, a thrown
 *     call, a throttle and a deadline each give `{asks: []}` with a reason
 *     word, and nothing is thrown;
 *   - the prompt file: every {variable} it names is one the call fills; the
 *     tool's kinds are the first build's two; no banned deploy phrase;
 *   - the log line carries counts and reason words, never the answers, the
 *     read, the prompt or the reply.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
process.env.ACCOUNT_ID = '123456789012';
const F = require(path.join(REPO, 'lambda-functions/game/followup-asks.js'));
const route = require(path.join(REPO, 'lambda-functions/game/claude-route.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); process.stdout.write(`  PASS  ${label}\n`); pass++; }
  catch (e) { process.stdout.write(`  FAIL  ${label}\n        ${e.message}\n`); fail++; }
}

// Capture every log line the call writes.
const logs = [];
const realLog = console.log, realWarn = console.warn;
console.log = (...a) => logs.push(a.join(' '));
console.warn = (...a) => logs.push(a.join(' '));

const RANKED = [
  { n: 1, text: 'I stop reading the implementation body and read the interface diff.', points: 14 },
  { n: 2, text: 'Security-sensitive files only: auth, IAM, payments.', points: 9 },
  { n: 3, text: 'Code can be rolled back; a bad backfill cannot.', points: 5 },
];
const READ = '## What the room said\nThe room stopped reading bodies; one voice held out for backfills.';
const NAMES = ['Marcus Hale', 'Aisha Rahman', 'Priya Shah'];
const SECRET_BITS = ['interface diff', 'backfill', 'stopped reading bodies', 'Marcus', 'Aisha', 'Security-sensitive'];

const reply = (content, extra = {}) => ({ body: new TextEncoder().encode(JSON.stringify({ content, stop_reason: 'tool_use', ...extra })) });
const toolCall = (asks) => reply([{ type: 'tool_use', id: 't1', name: 'suggest_follow_up_asks', input: { asks } }]);
const GOOD = [
  { type: 'agree', statement: 'Code can be rolled back; a bad backfill cannot.', answers: [3], why: 'Tests the backfill line.' },
  { type: 'choice', question: 'What do you read first?', answers: [1, 2], why: 'Settles the split.',
    options: [{ text: 'the interface diff', answer: 1 }, { text: 'Security-sensitive files only', answer: 2 }] },
  { type: 'agree', statement: 'Marcus reads the interface diff', answers: [1], why: '' },
];

const call = (send, extra = {}) => F.suggestFollowUps({
  eventTitle: 'Platform offsite', task: 'Say what you would stop reading.', questionTitle: 'What are you reviewing?',
  ranked: RANKED, voteCount: 9, readBack: READ, rosterNames: NAMES, send, logContext: { gameId: '4821', round: '003' }, ...extra,
});

(async () => {
  process.stdout.write('\n1. the request\n');
  const sent = [];
  await call(async (cmd) => { sent.push(cmd); return toolCall(GOOD); });
  const body = JSON.parse(sent[0].input.body);
  await check('Bedrock Sonnet 4.6, by inference profile', () => {
    assert.strictEqual(sent[0].input.modelId, 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6');
    assert.strictEqual(route.apiModelFor(sent[0].input.modelId), 'claude-sonnet-5-5');
  });
  await check('one user turn, no prefill, no temperature', () => {
    assert.strictEqual(body.messages.length, 1);
    assert.strictEqual(body.messages[0].role, 'user');
    for (const k of ['temperature', 'top_p', 'top_k', 'system']) assert.ok(!(k in body), k);
  });
  await check('the tool, forced on the Bedrock body, max_tokens from the prompt file', () => {
    assert.deepStrictEqual(body.tool_choice, { type: 'tool', name: 'suggest_follow_up_asks' });
    assert.deepStrictEqual(body.tools, [F.PROMPT.tool]);
    assert.strictEqual(body.max_tokens, F.PROMPT.maxTokens);
  });
  await check('the prompt carries the numbered answers and the read, with no name', () => {
    const p = body.messages[0].content;
    assert.ok(p.includes('1. (14 vote points) "I stop reading the implementation body and read the interface diff."'));
    assert.ok(p.includes(READ));
    assert.ok(!/\{[A-Za-z]+\}/.test(p), 'an unfilled variable');
    for (const n of NAMES) assert.ok(!p.includes(n), n);
  });
  await check('claude-route turns it into the 5.5 request: auto, the sentence, no prefill', () => {
    const plan = route.toApiRequest(sent[0].input.body, 'claude-sonnet-5-5');
    assert.deepStrictEqual(plan.request.tool_choice, { type: 'auto' });
    assert.ok(plan.request.messages[0].content.endsWith('Answer by calling the suggest_follow_up_asks tool. Do not answer in text.'));
    assert.strictEqual(plan.prefill, '');
    assert.strictEqual(plan.forced, true);
    assert.ok(!('temperature' in plan.request));
  });
  await check('and a 5.5 reply without the tool call is a failure there (so Bedrock answers instead)', () => {
    const plan = route.toApiRequest(sent[0].input.body, 'claude-sonnet-5-5');
    assert.throws(() => route.toBedrockShape({ content: [{ type: 'text', text: 'Here are some asks' }], stop_reason: 'end_turn' }, plan, 'claude-sonnet-5-5'));
    const ok = route.toBedrockShape({ content: [{ type: 'tool_use', id: 'x', name: 'suggest_follow_up_asks', input: { asks: [] } }], stop_reason: 'tool_use' }, plan, 'claude-sonnet-5-5');
    assert.strictEqual(F.toolInputOf(ok).asks.length, 0);
  });

  process.stdout.write('\n2. the reply\n');
  logs.length = 0;
  const good = await call(async () => toolCall(GOOD));
  await check('a good tool call: checked, the named one dropped, the rest kept', () => {
    assert.strictEqual(good.reason, null);
    assert.deepStrictEqual(good.asks.map((a) => a.type), ['agree', 'choice']);
    assert.deepStrictEqual(good.reasons, { names: 1 });
    assert.strictEqual(good.raw, 3);
    assert.strictEqual(good.servedBy, F.FOLLOWUP_MODEL_ID);
    assert.strictEqual(good.promptVersion, F.PROMPT.version);
  });
  await check('served by 5.5 is recorded as 5.5', async () => {
    const r = await call(async () => ({ ...toolCall(GOOD), claudeModel: 'claude-sonnet-5-5' }));
    assert.strictEqual(r.servedBy, 'claude-sonnet-5-5');
  });
  const cases = [
    ['no tool call (text only)', async () => reply([{ type: 'text', text: 'Some asks' }]), 'no-tool-call'],
    ['the wrong tool', async () => reply([{ type: 'tool_use', name: 'other', input: { asks: GOOD } }]), 'no-tool-call'],
    ['junk input', async () => reply([{ type: 'tool_use', name: 'suggest_follow_up_asks', input: { asks: 'lots' } }]), 'malformed'],
    ['a body that is not JSON', async () => ({ body: new TextEncoder().encode('<html>') }), 'malformed'],
    ['a thrown call', async () => { throw Object.assign(new Error('boom'), { name: 'ValidationException' }); }, 'model-error'],
  ];
  for (const [label, send, reason] of cases) {
    await check(`${label}: no asks, reason "${reason}", nothing thrown`, async () => {
      const r = await call(send);
      assert.deepStrictEqual(r.asks, []);
      assert.strictEqual(r.reason, reason);
    });
  }
  await check('a throttle is retried once, as the read is', async () => {
    let n = 0;
    const r = await call(async () => { n++; if (n === 1) throw Object.assign(new Error('slow'), { name: 'ThrottlingException' }); return toolCall(GOOD); });
    assert.strictEqual(n, 2);
    assert.strictEqual(r.asks.length, 2);
  });
  await check('a call past its deadline gives up with reason "timeout"', async () => {
    const r = await call(() => new Promise((resolve) => setTimeout(() => resolve(toolCall(GOOD)), 200)), { deadlineMs: 20 });
    assert.strictEqual(r.reason, 'timeout');
    assert.deepStrictEqual(r.asks, []);
  });
  await check('a round with no answers is never sent', async () => {
    let called = false;
    const r = await call(async () => { called = true; return toolCall(GOOD); }, { ranked: [] });
    assert.strictEqual(called, false);
    assert.strictEqual(r.reason, 'no-answers');
  });

  process.stdout.write('\n3. the log\n');
  await check('one structured line per call: counts and reason words', () => {
    const lines = logs.filter((l) => l.includes('"event":"followup-asks"'));
    assert.ok(lines.length >= 1);
    const first = JSON.parse(lines[0]);
    assert.deepStrictEqual(Object.keys(first).sort(), ['answers', 'dropReasons', 'dropped', 'event', 'gameId', 'kept', 'keptKinds', 'marks', 'model', 'ms', 'promptVersion', 'raw', 'reason', 'round', 'servedBy'].sort());
  });
  await check('never the answers, the read, a name, the prompt or the reply', () => {
    const all = logs.join('\n');
    for (const bit of SECRET_BITS) assert.ok(!all.includes(bit), bit);
    assert.ok(!all.includes('FOLLOW-UP ASKS'), 'the prompt was logged');
  });

  process.stdout.write('\n4. the prompt file\n');
  await check('every variable it names is one the call fills', () => {
    assert.deepStrictEqual(F.promptVariables().sort(),
      ['eventTitle', 'numberedAnswers', 'questionTitle', 'readBack', 'responseCount', 'task', 'voteCount'].sort());
  });
  await check('the tool schema parses and offers the first build\'s two kinds', () => {
    const t = F.PROMPT.tool;
    assert.strictEqual(t.name, 'suggest_follow_up_asks');
    assert.deepStrictEqual(t.input_schema.properties.asks.items.properties.type.enum, ['agree', 'choice']);
    assert.strictEqual(t.input_schema.properties.asks.maxItems, 3);
    assert.ok(!/"open"/.test(F.PROMPT.instructions), 'the instructions still offer open asks');
  });
  await check('it is the design draft\'s v2 rules otherwise, word for word', () => {
    const draft = require(path.join(REPO, 'docs/design/ca-followup-asks/prompt-draft.json')).followUpAsks.instructions;
    for (const rule of ['A1. Ground it.', 'A2. Do not lead.', 'A4. A statement every person', 'A5. Name nobody.', 'A9. Never ask for anything personal']) {
      const line = draft.split('\n').find((l) => l.startsWith(rule));
      assert.ok(line && F.PROMPT.instructions.includes(line), rule);
    }
  });
  await check('no banned deploy phrase in the prompt file', () => {
    const text = fs.readFileSync(path.join(REPO, 'lambda-functions/game/followup-prompt.json'), 'utf8').toLowerCase();
    // Spelled apart so this file does not trip tests/no-retired-twin-references.js itself.
    for (const banned of [['deploys', 'nothing'], ['tags', 'only']].map((w) => w.join(' '))) assert.ok(!text.includes(banned), banned);
  });

  console.log = realLog; console.warn = realWarn;
  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`CRASH ${e.stack}\n`); process.exit(1); });
