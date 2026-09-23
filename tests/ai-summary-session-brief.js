/**
 * THE HOST'S BRIEF REACHES WORKIE IN THE CLEAR — get-ai-summary.js on an org session.
 *
 * `ENCRYPTED_FIELDS.session` is Title / HostName / Details / AIContext, and
 * websocket/schema-compliant-manager.js and game/update-game.js write all four
 * as envelopes on an organisation's `GAME#<id>/METADATA`. get-ai-summary.js
 * read that row with a plain GetCommand and never decrypted it, then handed
 * the fields straight to the prompt:
 *
 *     eventTitle:    metadata.EventTitle || metadata.Title       -> {v,iv,tag,ct}
 *     gameAiContext: metadata.AIContext                          -> {v,iv,tag,ct}
 *     eventDetails:  metadata.EngagementInfo || metadata.Details -> {v,iv,tag,ct}
 *
 * An envelope is a truthy OBJECT, so every `||` picked it, and it failed two
 * ways depending on which voice won:
 *
 *   - no persona picked and no set context: personas.js reached
 *     `gameAiContext.trim()` on the envelope and THREW, so the worker failed,
 *     the room got `aiSummaryError`, and no Workie summary was written at all;
 *   - a persona or set context won first: nothing threw, and every template
 *     literal and `String(...)` downstream (buildHostDirective and
 *     buildContextBlock included) put "[object Object]" where the host's
 *     instructions, the event details and the title belonged — and the
 *     fallback heading read "## [object Object] — Summary".
 *
 * Every other read in the file already decrypted (answers, votes, results, the
 * cached summary); this was the one row it forgot.
 *
 * This file drives the REAL handler (worker mode, the path the HTTP route
 * self-invokes into) against a stubbed DynamoDB and a KMS that enforces the
 * key policy, captures the body actually sent to Bedrock, and looks for the
 * host's words in it.
 *
 * Stubbing by request NAME through Module._load, not by resolved path, for the
 * reason tests/org-authored-prompts.js gives: @aws-sdk/client-kms exists only
 * in the deployed bundle.
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
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        // findDefaultPromptId's `PK = :pk AND isDefault = :isDefault` shape.
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          (v[':pk'] === undefined || i.PK === v[':pk'])
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

// ---- Bedrock: record what Workie was told, then fail ------------------------
// Failing after recording sends the handler down its data-driven fallback, which
// is the second place the title lands (the "## <title> — Summary" heading).
let bedrockBodies = [];
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      throw new Error('stub: no Bedrock in tests');
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

// Four distinctive strings, so a hit in the prompt can only be the decrypted field.
const BRIEF = {
  Title: 'Q3 Restructure Retro',
  HostName: 'Amara Okafor',
  Details: 'Offsite for the platform team after the September reorg',
  AIContext: 'Name the two biggest risks the room raised before anything else',
};

// No {contextSections} in the template, so the context layer is injected ahead
// of it; {eventTitle} places the title explicitly.
const TEMPLATE =
  'EVENT: {eventTitle}\n' +
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  'TOP: {topVotedAnswers}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

/** Mint the org as create-org does: one GenerateDataKey, blob onto ORG#<id>/METADATA. */
async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId); // make the handler walk loader -> KMS Decrypt itself
}

/** One round at RESULTS, with the session brief as the writer stores it. */
async function seedRound(gameId, { orgId, personaId = null }) {
  const metadata = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'call-and-answer',
    ...BRIEF,
    ...(orgId ? { orgId, QuestionSetScope: 'org' } : {}),
    ...(personaId ? { PersonaId: personaId } : {}),
  };
  put(orgId ? await crypto.encryptItem(orgId, 'session', metadata) : metadata);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  const answers = [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'ship smaller' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'fewer handoffs' },
  ];
  for (const a of answers) put(orgId ? await crypto.encryptItem(orgId, 'answer', a) : a);
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
}

async function runWorker(gameId) {
  bedrockBodies = [];
  // Worker mode RETHROWS (so the Event invoke retries); catch it here so one
  // failing section reports instead of ending the file.
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

  say('\n1. an org session: the brief is ciphertext at rest');
  await seedRound('4821', { orgId: ORG });
  const atRest = store.get(key('GAME#4821', 'METADATA'));
  await check('the seeded METADATA row carries envelopes, as the writers leave it', () => {
    for (const f of ['Title', 'HostName', 'Details', 'AIContext']) {
      assert.ok(isEnvelope(atRest[f]), `${f} is not an envelope: ${JSON.stringify(atRest[f])}`);
    }
  });

  say('\n2. …and reaches Workie in the clear');
  const org = await runWorker('4821');
  await check('the worker completed', () =>
    assert.strictEqual(org.res && org.res.ok, true, JSON.stringify(org.res)));
  await check('a prompt was sent to the model', () =>
    assert.ok(org.prompt.length > 0, 'Bedrock was never called'));
  await check("the host's AI instructions (AIContext) are in the prompt", () =>
    assert.ok(org.prompt.includes(BRIEF.AIContext), `AIContext missing from:\n${org.prompt}`));
  await check("the session's details (Details) are in the prompt", () =>
    assert.ok(org.prompt.includes(BRIEF.Details), `Details missing from:\n${org.prompt}`));
  await check('the session title is in the prompt', () =>
    assert.ok(org.prompt.includes(BRIEF.Title), `Title missing from:\n${org.prompt}`));
  await check('no "[object Object]" anywhere in the prompt', () =>
    assert.ok(!org.prompt.includes('[object Object]'), `stringified envelope in:\n${org.prompt}`));
  await check('no envelope fragment anywhere in the prompt', () => {
    const fragments = ['Title', 'Details', 'AIContext'].map((f) => atRest[f].ct);
    for (const ct of fragments) assert.ok(!org.prompt.includes(ct), 'ciphertext reached the prompt');
    assert.ok(!/"ct"\s*:/.test(org.prompt) && !/"iv"\s*:/.test(org.prompt), 'an envelope was serialised into the prompt');
  });

  say('\n2b. the same, when a persona the host picked wins the voice');
  // With no persona the envelope reached personas.js's `gameAiContext.trim()`
  // and THREW, so the worker failed loudly. A host-picked persona returns
  // before that rung, and then nothing threw at all: the prompt was built with
  // "[object Object]" where the brief should be. This is the quiet half.
  put({ PK: 'AIPROMPTS', SK: 'PERSONA#coach', personaId: 'coach', name: 'Coach',
        voice: 'You are a warm, direct facilitator.', status: 'active' });
  await seedRound('4823', { orgId: ORG, personaId: 'coach' });
  const picked = await runWorker('4823');
  await check('the worker completed', () =>
    assert.strictEqual(picked.res && picked.res.ok, true, JSON.stringify(picked.res)));
  await check('the picked persona is the voice', () =>
    assert.ok(picked.prompt.includes('warm, direct facilitator'), 'persona voice missing'));
  await check('AIContext, Details and Title still reach the prompt in the clear', () => {
    for (const f of ['AIContext', 'Details', 'Title']) {
      assert.ok(picked.prompt.includes(BRIEF[f]), `${f} missing from:\n${picked.prompt}`);
    }
  });
  await check('no "[object Object]" in the prompt', () =>
    assert.ok(!picked.prompt.includes('[object Object]'), `stringified envelope in:\n${picked.prompt}`));

  say('\n3. the summary it stored');
  await check('an AISummary row was written, sealed under the org', () => {
    assert.ok(org.stored, 'no AISummary row');
    assert.ok(isEnvelope(org.stored.SummaryText) || isEnvelope(org.stored.MarkdownResponse),
      'the org summary was stored in plaintext');
  });
  const opened = org.stored ? await crypto.decryptItem(ORG, 'aiSummary', org.stored) : {};
  await check('the fallback heading carries the real title, not "[object Object]"', () => {
    const md = String(opened.MarkdownResponse || '');
    assert.ok(!md.includes('[object Object]'), `stored markdown: ${md.slice(0, 200)}`);
    assert.ok(md.includes(BRIEF.Title), `title missing from stored markdown: ${md.slice(0, 200)}`);
  });
  await check('nothing in the stored summary is a stringified envelope', () =>
    assert.ok(!JSON.stringify(opened).includes('[object Object]'),
      'a stored field carries "[object Object]"'));

  say('\n4. the session row itself is untouched');
  await check('METADATA is still ciphertext after the run (decrypted for the prompt only)', () => {
    const after = store.get(key('GAME#4821', 'METADATA'));
    for (const f of ['Title', 'HostName', 'Details', 'AIContext']) {
      assert.ok(isEnvelope(after[f]), `${f} was written back in the clear`);
    }
  });

  say('\n5. a platform (orgless) session: plaintext passes straight through');
  await seedRound('4822', { orgId: '' });
  const plat = await runWorker('4822');
  await check('the worker completed', () =>
    assert.strictEqual(plat.res && plat.res.ok, true, JSON.stringify(plat.res)));
  await check('AIContext, Details and Title reach the prompt unchanged', () => {
    for (const f of ['AIContext', 'Details', 'Title']) {
      assert.ok(plat.prompt.includes(BRIEF[f]), `${f} missing from:\n${plat.prompt}`);
    }
  });
  await check('no "[object Object]" in the platform prompt either', () =>
    assert.ok(!plat.prompt.includes('[object Object]')));

  say('\n6. the QUESTION row, served from an org set, reaches the prompt in the clear');
  // The same file's worker also reads the question the round was served
  // from — via the REF row the host pinned — and ENCRYPTED_FIELDS.question
  // puts Title / Detail / the options on an org set's rows as envelopes.
  // It read that row with a plain GetCommand too, so {questionTitle} came out
  // as "[object Object]" on every org session of every game type.
  {
    const gameId = '4823';
    await seedRound(gameId, { orgId: ORG });
    const { setMetadataKey } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
    const setRef = { scope: 'org', orgId: ORG, setId: 'retro-set' };
    put({ ...setMetadataKey(setRef), orgId: ORG, activeVersion: 1, engagementType: 'call-and-answer' });
    put(await crypto.encryptItem(ORG, 'question', {
      PK: `ORG#${ORG}#SET#retro-set#v1`, SK: 'QUESTION#c001#001',
      Title: 'Which handoff hurt most this quarter?',
      Detail: 'Think of the one that cost the most days.',
      Category: 'Delivery',
    }));
    put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
      SetId: 'retro-set', SetVersion: 1, SetScope: 'org', SetOrgId: ORG });
    const atRest = store.get(key(`ORG#${ORG}#SET#retro-set#v1`, 'QUESTION#c001#001'));
    await check('the seeded question row carries envelopes, as the importer leaves it', () =>
      assert.ok(isEnvelope(atRest.Title) && isEnvelope(atRest.Detail), 'fixture is not encrypted'));
    const run = await runWorker(gameId);
    await check('the worker completed', () =>
      assert.strictEqual(run.res && run.res.ok, true, JSON.stringify(run.res)));
    await check("the question's title is in the prompt", () =>
      assert.ok(run.prompt.includes('Which handoff hurt most this quarter?'), `title missing from:\n${run.prompt}`));
    await check('no "[object Object]" and no envelope in the prompt', () => {
      assert.ok(!run.prompt.includes('[object Object]'), `stringified envelope in:\n${run.prompt}`);
      assert.ok(!run.prompt.includes(atRest.Title.ct), 'question ciphertext reached the prompt');
    });
    await check('the question row is still ciphertext after the run', () =>
      assert.ok(isEnvelope(store.get(key(`ORG#${ORG}#SET#retro-set#v1`, 'QUESTION#c001#001')).Title)));
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
