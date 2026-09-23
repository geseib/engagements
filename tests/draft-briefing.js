/**
 * POST /games/briefing/draft — Workie writes a briefing from a document's text.
 *
 * docs/design/session-setup-redesign RATIONALE §c "From file to text", step 3.
 * The dialog reads the host's PDF through parse-document, sends the TEXT here,
 * and gets back a draft of at most 1,500 characters and a count of names it
 * swapped for roles. The host reads and edits it before anything is stored.
 *
 * STATELESS BY DESIGN: the document's text passes through and is dropped. Only
 * the summary the host signs off is ever stored, and only by create or Save.
 * So this handler has no table at all — the stub below throws if it reaches
 * for one.
 *
 * Driven against a stubbed Bedrock that records what it was sent.
 *
 * rejects: a route that stores the document; a draft over its cap reaching the
 * host; an unbounded input; a route open to any account with a token.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// No table: a draft that reaches for DynamoDB is a draft that stores something.
let tableTouched = 0;
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class { constructor() { tableTouched++; } } });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => ({ send: async () => { tableTouched++; return {}; } }) },
});

let sent = [];
let reply = null;          // what the stubbed model answers
let throwOnce = null;      // an error name to throw on the next call only
class InvokeModelCommand { constructor(i) { this.input = i; } }
stubs.set('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      sent.push({ ...cmd.input, body: JSON.parse(cmd.input.body) });
      if (throwOnce) { const e = new Error(throwOnce); e.name = throwOnce; throwOnce = null; throw e; }
      if (reply instanceof Error) throw reply;
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: reply }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand,
});

process.env.ACCOUNT_ID = '123456789012';

const { handler } = require(path.join(REPO, 'lambda-functions/game/draft-briefing.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}
const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, warn, error }); }
};
const post = async (body) => {
  const res = await quiet(() => handler({ body: JSON.stringify(body) }));
  return { status: res.statusCode, body: JSON.parse(res.body), headers: res.headers };
};

const DOC = [
  'Q3 SUPPORT OPERATIONS REVIEW — prepared by Dana Whitfield, Director of Support.',
  'Open issues rose 15% on Q2, from 1,840 to 2,116. Mean time to resolve is now 3 weeks.',
  'Marcus Oyelaran, tier-2 lead, notes most escalations begin with a reopened ticket.',
].join('\n');

(async () => {
  console.log('\n1. a document becomes a draft');

  reply = '"briefing":"Q3 review of the support team.\\n- Open issues are up 15% on Q2 (1,840 to 2,116).\\n- MTTR is 3 weeks.\\n- The support director and the tier-2 lead say most escalations start with a reopened ticket.","namesRemoved":2}';
  const ok = await post({ text: DOC, fileName: 'q3-support-ops-review.pdf', pages: 14, truncated: false });

  await check('200 with the draft and the count of names removed', () => {
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.briefing, /^Q3 review of the support team\./);
    assert.strictEqual(ok.body.namesRemoved, 2);
  });
  await check('neither name from the document is in the draft', () => {
    assert.ok(!/Dana|Whitfield|Marcus|Oyelaran/.test(ok.body.briefing));
  });
  await check('the model got the document fenced, and the rules', () => {
    const prompt = sent[0].body.messages[0].content;
    assert.ok(prompt.includes(DOC), 'the document text is not in the prompt');
    assert.match(prompt, /<document>/);
    assert.match(prompt, /1,500 characters/);
  });
  await check('the reply is prefilled with "{" so it comes back as JSON', () => {
    const msgs = sent[0].body.messages;
    assert.strictEqual(msgs[msgs.length - 1].role, 'assistant');
    assert.strictEqual(msgs[msgs.length - 1].content, '{');
  });
  await check('the file NAME is not sent to the model — it can say more than the contents', () => {
    assert.ok(!JSON.stringify(sent[0].body).includes('q3-support-ops-review.pdf'));
  });
  await check('it runs on Haiku 4.5, the model the round summaries use', () => {
    assert.match(sent[0].modelId, /inference-profile\/us\.anthropic\.claude-haiku-4-5-20251001-v1:0$/);
    assert.ok(sent[0].modelId.includes('123456789012'));
  });
  await check('nothing touched a table', () => assert.strictEqual(tableTouched, 0));

  console.log('\n2. the bounds');

  await check('a draft over 1,500 characters is cut at a line before it reaches the host', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `- Fact ${i}: something measured this quarter.`);
    reply = JSON.stringify({ briefing: lines.join('\n'), namesRemoved: 0 }).slice(1);
    const r = await post({ text: DOC });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.briefing.length <= 1500, `${r.body.briefing.length}`);
  });

  await check('text over 50,000 characters is refused before the model is called', async () => {
    sent = [];
    const r = await post({ text: 'x'.repeat(50200) });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(sent.length, 0, 'the model was called anyway');
  });

  await check('parse-document\'s own truncation marker still fits', async () => {
    reply = '"briefing":"A fact.","namesRemoved":0}';
    const r = await post({ text: `${'x'.repeat(50000)}... [truncated]`, truncated: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  });

  await check('no text is a 400, and the model is not called', async () => {
    sent = [];
    for (const body of [{}, { text: '' }, { text: '   ' }, { text: 42 }]) {
      const r = await post(body);
      assert.strictEqual(r.status, 400, JSON.stringify(body));
    }
    assert.strictEqual(sent.length, 0);
  });

  await check('a malformed body is a 400, not a 500', async () => {
    const res = await quiet(() => handler({ body: '{not json' }));
    assert.strictEqual(res.statusCode, 400);
  });

  console.log('\n3. when the model does not cooperate');

  await check('a reply with no briefing is a 502 the dialog can offer Try again on', async () => {
    reply = 'I would rather not."}';
    const r = await post({ text: DOC });
    assert.strictEqual(r.status, 502);
    assert.match(r.body.error, /couldn.t write the briefing/i);
  });

  await check('a model error is a 502 too, never a 500 with a stack', async () => {
    reply = new Error('ValidationException: boom');
    const r = await post({ text: DOC });
    assert.strictEqual(r.status, 502);
    assert.ok(!/ValidationException/.test(JSON.stringify(r.body)), 'the model error leaked to the browser');
  });

  await check('one throttle is retried, once', async () => {
    sent = [];
    throwOnce = 'ThrottlingException';
    reply = '"briefing":"Retried fine.","namesRemoved":0}';
    const r = await post({ text: DOC });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sent.length, 2);
  });

  await check('every answer carries the CORS origin header', async () => {
    reply = '"briefing":"x","namesRemoved":0}';
    assert.strictEqual((await post({ text: DOC })).headers['Access-Control-Allow-Origin'], '*');
    assert.strictEqual((await post({})).headers['Access-Control-Allow-Origin'], '*');
  });

  console.log('\n4. the route is closed, and allowed its model');
  {
    const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');
    const { requiredGroupsForRoute, hasPermission } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
    const routes = routesFromTemplate();
    await check('the template scanner works', () => assertScannerWorks(routes));
    await check('POST /games/briefing/draft carries CognitoAuthorizer', () => {
      const hit = findRoute(routes, 'POST', '/games/briefing/draft');
      assert.ok(hit, 'the route is not in template-clean.yaml');
      assert.strictEqual(hit.authorizer, 'CognitoAuthorizer');
    });
    await check('the authorizer asks for hosts or admins, and refuses pending', () => {
      for (const p of ['games/briefing/draft']) {
        assert.deepStrictEqual(requiredGroupsForRoute('POST', p), ['hosts', 'admins']);
        assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('POST', p)), false);
      }
    });
    await check('the function may invoke Haiku 4.5 and has no table policy', () => {
      const src = require('fs').readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
      const at = src.indexOf('Handler: draft-briefing.handler');
      assert.ok(at > -1, 'no function runs draft-briefing.handler');
      const block = src.slice(src.lastIndexOf('Type: AWS::Serverless::Function', at), src.indexOf('\n  # ', at) > -1 ? src.indexOf('\n  # ', at) : at + 3000);
      const fnBlock = block.slice(0, block.indexOf('Tags:') + 200);
      assert.match(fnBlock, /CodeUri: lambda-functions\/game\//);
      assert.match(fnBlock, /bedrock:InvokeModel/);
      assert.match(fnBlock, /inference-profile\/us\.anthropic\.claude-haiku-4-5-20251001-v1:0/);
      assert.ok(!/DynamoDB\w*Policy/.test(fnBlock), 'a stateless route was given the table');
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`CRASH ${e.stack}`); process.exit(1); });
