/**
 * THE BRIEFING REACHES WORKIE — get-ai-summary.js with METADATA.Briefing.
 *
 * docs/design/session-setup-redesign RATIONALE §c "How the briefing enters
 * Workie's prompt". A Call & Answer session can carry a host-checked summary
 * of a document (METADATA.Briefing, encrypted on an org's session). Each round
 * Workie gets it as ONE layer, appended LAST — after the host's required
 * additions, the position games 1935 and 4567 showed the model obeys — and
 * nowhere else: not in the SESSION CONTEXT block, not as a voice.
 *
 * The round's summary row records only that it was briefed (BriefingUsed),
 * never the text, so a report can say which rounds were briefed.
 *
 * Drives the REAL handler in worker mode against a stubbed table, a KMS that
 * enforces the key policy, and a Bedrock that records its prompt and answers.
 *
 * rejects: a briefing that never reaches the prompt; one placed early, where
 * the template's material-only rules silence it; one repeated in the context
 * block; a summary row that copies the brief's text.
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
const stub = (name, exports) => stubs.set(name, exports);

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

/** A GetCommand with a ProjectionExpression returns only those attributes. */
function project(item, input) {
  if (!item || !input.ProjectionExpression) return item;
  const names = input.ExpressionAttributeNames || {};
  const out = {};
  for (const raw of input.ProjectionExpression.split(',')) {
    const attr = names[raw.trim()] || raw.trim();
    if (attr in item) out[attr] = item[attr];
  }
  return out;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: project(store.get(key(inp.Key.PK, inp.Key.SK)), inp) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        // `:isDefault` is findDefaultPromptId's filter on the AIPROMPTS partition.
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
          && (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// A bodyless S3 object makes fetchPromptFromS3 fall back to the DynamoDB
// record's own `template` — the same route tests/anonymous-round-flow.js uses.
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

// ---- Bedrock: record what Workie was told, and answer ------------------------
// A real reply, so the summary row is written from the model path — the only
// path on which a briefing can have been used.
let bedrockBodies = [];
const COMPLETION = '\n\nThe room put the easy fixes first, the classic quick-win play, and the brief puts MTTR at 3 weeks.'
  + '\n\n## Discussion Questions\n1. Who guards the hard tickets?\n\n## Next Steps\n- Pull the quick fixes into one sprint.';
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: COMPLETION }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand,
});

// ---- a KMS that behaves the way the key policy will ------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrap(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException: encryption context mismatch');
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

// ---- the session ------------------------------------------------------------
const ORG = 'org_acme';

// The MTTR fixture (docs/design/session-setup-redesign/_src/content.py).
const BRIEFING_TEXT = [
  'Q3 review of the support team, ahead of Q4 planning.',
  '- Open issues are up 15% on Q2 (1,840 to 2,116).',
  '- Mean time to resolve (MTTR) has stretched to 3 weeks. The Q4 target is 10 days.',
  '- Goal: MTTR under 10 days without adding headcount.',
].join('\n');
const BRIEFING = {
  text: BRIEFING_TEXT,
  source: { name: 'q3-support-ops-review.pdf', pages: 14, chars: 19400, truncated: false },
  namesRemoved: 2,
  draftedAt: '2026-09-23T10:00:00.000Z',
  editedAt: null,
};

const TEMPLATE =
  'EVENT: {eventTitle}\n' +
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  'TOP: {topVotedAnswers}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId);
}

/** One round at RESULTS, with the briefing as create stores it. */
async function seedRound(gameId, { orgId, briefing = null, aiContext = '' }) {
  const metadata = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'call-and-answer',
    Title: 'Support Ops Review — Q3', HostName: 'Host', Details: '', AIContext: aiContext,
    ...(briefing ? { Briefing: briefing } : {}),
    ...(orgId ? { orgId, QuestionSetScope: 'org' } : {}),
  };
  put(orgId ? await crypto.encryptItem(orgId, 'session', metadata) : metadata);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  const answers = [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Prioritise the easy-fix tickets' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'One owner per ticket' },
  ];
  for (const a of answers) put(orgId ? await crypto.encryptItem(orgId, 'answer', a) : a);
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
}

async function runWorker(gameId) {
  bedrockBodies = [];
  let res;
  try {
    res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', debug: 'true' });
  } catch (e) {
    res = { error: e.message };
  }
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  return { res, prompt, stored: store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary')) };
}

(async () => {
  await mintOrg(ORG);

  say('\n1. an org session with a briefing, and host instructions');
  await seedRound('5101', { orgId: ORG, briefing: BRIEFING, aiContext: 'End with one question for the ops leads' });
  const atRest = store.get(key('GAME#5101', 'METADATA'));
  await check('the briefing is ciphertext at rest, as create leaves it', () =>
    assert.ok(isEnvelope(atRest.Briefing), JSON.stringify(atRest.Briefing)));

  const run = await runWorker('5101');
  await check('the worker completed', () =>
    assert.strictEqual(run.res && run.res.ok, true, JSON.stringify(run.res)));
  await check('the briefing layer is in the prompt, with the text in the clear', () => {
    assert.ok(run.prompt.includes("THE BRIEFING — part of your material, printed under the label 'Briefing'."), 'no layer');
    assert.ok(run.prompt.includes(`Briefing:\n${BRIEFING_TEXT}\n`), 'the text is not in the prompt verbatim');
  });
  await check("it comes AFTER the host's required additions", () => {
    const host = run.prompt.indexOf("THE HOST'S REQUIRED ADDITIONS");
    const brief = run.prompt.indexOf('THE BRIEFING —');
    assert.ok(host > -1, 'no host directive in the fixture prompt');
    assert.ok(brief > host, `briefing at ${brief}, host directive at ${host}`);
  });
  await check('it is the LAST thing in the prompt', () =>
    assert.ok(run.prompt.trimEnd().endsWith('Mention it where it sharpens a point, not in every section.'),
      `the prompt ends: ${run.prompt.slice(-160)}`));
  await check('it appears once — not also in SESSION CONTEXT', () => {
    assert.strictEqual(run.prompt.split('Open issues are up 15%').length - 1, 1);
    const ctx = run.prompt.indexOf('SESSION CONTEXT');
    if (ctx > -1) assert.ok(!run.prompt.slice(ctx, run.prompt.indexOf('\n\n', ctx)).includes('Briefing'));
  });
  await check('the file name never reaches the prompt', () =>
    assert.ok(!run.prompt.includes('q3-support-ops-review.pdf')));
  await check('no envelope and no "[object Object]" in the prompt', () => {
    assert.ok(!run.prompt.includes('[object Object]'));
    assert.ok(!run.prompt.includes(atRest.Briefing.ct));
  });
  await check('the round is marked briefed — a flag, not the text', () => {
    assert.ok(run.stored, 'no AISummary row');
    assert.strictEqual(run.stored.BriefingUsed, true);
    assert.ok(!JSON.stringify(run.stored).includes('Open issues are up 15%'), 'the brief was copied onto the summary row');
  });
  await check('METADATA is still ciphertext after the run', () =>
    assert.ok(isEnvelope(store.get(key('GAME#5101', 'METADATA')).Briefing)));

  /*
    THE PUBLIC ROUTE NEVER HANDS IT BACK. GET /games/{id}/ai-summary carries no
    authorizer — every phone in the room reads it. Since 2026-09-25 it refuses
    ?debug=true outright (tests/ai-summary-host-only-params.js): the prompt is
    served only on GET /games/{id}/ai-summary/host, to the session's own host.
    "Participants never see it" (RATIONALE §c) holds on the public route
    because nothing of the prompt crosses it at all.
  */
  say('\n1b. the public read of the same round, as a phone makes it, with ?debug=true');
  const readRoute = async (routeKey, query, authorizer) => {
    const res = await getAiSummary({
      routeKey,
      pathParameters: { gameId: '5101' },
      queryStringParameters: { questionId: '001', ...query },
      requestContext: { routeKey, ...(authorizer ? { authorizer } : {}) },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const pub = await readRoute('GET /games/{gameId}/ai-summary', { debug: 'true' });
  await check('the public route refuses the prompt echo', () => {
    assert.strictEqual(pub.status, 403, JSON.stringify(pub.body));
    assert.ok(!('debugPrompt' in pub.body), 'a participant can read the prompt');
  });
  await check('and carries none of the briefing text', () =>
    assert.ok(!JSON.stringify(pub.body).includes('Open issues are up 15%'), 'the briefing is somewhere in the public reply'));

  /*
    The host's own door still withholds the layer: the briefing is a
    customer's document, and a debug echo is not where it should be read back.
  */
  say("\n1c. the same read on the host's own route, by the owning team's host");
  const own = await readRoute('GET /games/{gameId}/ai-summary/host', { debug: 'true' },
    { lambda: { userId: 'u-host', groups: 'hosts', orgId: ORG, orgIds: ORG } });
  await check('the cached summary is served, with its prompt', () =>
    assert.strictEqual(own.status, 200, JSON.stringify(own.body)));
  await check('its debug prompt says the briefing was withheld', () =>
    assert.match(own.body.debugPrompt || '', /THE BRIEFING — withheld/));
  await check('and carries none of the briefing text', () =>
    assert.ok(!JSON.stringify(own.body).includes('Open issues are up 15%'), 'the briefing is somewhere in the reply'));
  await check('everything before the layer is still there for the host debugging', () =>
    assert.ok((own.body.debugPrompt || '').includes("THE HOST'S REQUIRED ADDITIONS")));

  say('\n2. the same session with no briefing');
  await seedRound('5102', { orgId: ORG });
  const plain = await runWorker('5102');
  await check('the worker completed', () =>
    assert.strictEqual(plain.res && plain.res.ok, true, JSON.stringify(plain.res)));
  await check('no layer, not even its heading', () => assert.ok(!plain.prompt.includes('THE BRIEFING')));
  await check('the round is not marked briefed', () => assert.ok(!plain.stored.BriefingUsed));

  say('\n3. a platform session (no org) with a briefing');
  await seedRound('5103', { briefing: BRIEFING });
  const plat = await runWorker('5103');
  await check('the layer is there on a plaintext row too', () =>
    assert.ok(plat.prompt.includes(`Briefing:\n${BRIEFING_TEXT}\n`)));

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
