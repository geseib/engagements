/**
 * IS THE ENCRYPTION ACTUALLY WIRED IN? — the test tenants/tenant-crypto.js
 * cannot be.
 *
 * tests/tenant-crypto.js proves the MODULE is correct: the cipher round-trips,
 * the AAD binds, the cache is bounded, plaintext passes through. Every one of
 * those assertions stays green while not a single handler calls it. This file
 * is the other half — it drives the REAL handlers and looks at what is actually
 * in the store afterwards.
 *
 * That distinction is the whole reason it exists. A field shipping in plaintext
 * breaks NOTHING: the product behaves identically, every existing test passes,
 * and the only symptom is that docs/design/tenancy-redesign/08-privacy.html has
 * become a lie. There is no runtime signal to notice. So the assertions below
 * are deliberately about BYTES AT REST, not about what a handler returns —
 * "get-question gave me the right title" is true whether or not anything was
 * ever encrypted.
 *
 * rejects: upload-questions writing an org's question rows or set metadata in
 * plaintext; get-question failing to unwrap them on the ANONYMOUS participant
 * path (where there is no caller org, so a caller-derived org would throw);
 * websocket/message.js storing a participant's answer in plaintext;
 * get-answers returning envelopes to the room; encrypting PLATFORM content,
 * which would make the shared library unreadable by everybody; and the
 * passthrough rule breaking, so that a row written before this change stops
 * being readable.
 *
 * The cipher is REAL — node:crypto, real envelopes. Only KMS and DynamoDB are
 * stubbed, and the KMS stub behaves the way the key policy will: a Decrypt that
 * does not name the right org in its encryption context is refused.
 */
const path = require('path');
const assert = require('assert');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '..');
const TABLE = 'test-table';

// ---- Stub the SDK before any handler loads ---------------------------------
//
// Hooked by REQUEST STRING (Module._load), not by resolved path, following
// tests/tenant-set-scoping.js: several @aws-sdk packages the admin bundle pulls
// in cannot be resolved from the repo root at all, and @aws-sdk/client-kms is
// only present at lambda-functions/node_modules.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const store = new Map();          // "PK|SK" -> Item
const k = (item) => `${item.PK}|${item.SK}`;
const put = (item) => store.set(k(item), item);
const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(`${inp.Key.PK}|${inp.Key.SK}`); return {}; }
    if (cmd.type === 'update') {
      const key = `${inp.Key.PK}|${inp.Key.SK}`;
      const item = store.get(key) || { ...inp.Key };
      const names = inp.ExpressionAttributeNames || {};
      const values = inp.ExpressionAttributeValues || {};
      for (const clause of String(inp.UpdateExpression || '').replace(/^SET /, '').split(',')) {
        const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(.+)$/);
        if (!m) continue;
        const attr = names[m[1]] || m[1];
        const raw = m[2].trim();
        if (raw.startsWith(':')) item[attr] = values[raw];
      }
      store.set(key, item);
      return { Attributes: item };
    }
    if (cmd.type === 'batchWrite') {
      for (const r of inp.RequestItems[TABLE] || []) {
        if (r.PutRequest) put(r.PutRequest.Item);
        if (r.DeleteRequest) store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'] ?? v[':PK'];
      const prefix = v[':sk'] ?? v[':questionPrefix'] ?? v[':prefix'] ?? '';
      const items = [...store.values()].filter(
        (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

/**
 * A KMS that behaves the way the real one will once the key policy lands: the
 * wrapped blob remembers which org it was minted for, and a Decrypt whose
 * encryption context disagrees — or supplies no orgId at all — is REFUSED.
 * Without that, an org-confusion bug in a call site would decrypt happily here
 * and only fail in production.
 */
const kmsCalls = { generate: 0, decrypt: 0 };
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, key) =>
  Buffer.from(JSON.stringify({ orgId, key: key.toString('base64') }), 'utf8');

stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        kmsCalls.generate++;
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const key = nodeCrypto.randomBytes(32);
        return { Plaintext: key, CiphertextBlob: wrap(orgId, key) };
      }
      if (command instanceof DecryptCommand) {
        kmsCalls.decrypt++;
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId && blob.orgId !== ctx) {
          throw new Error('InvalidCiphertextException: encryption context mismatch');
        }
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});
stub('@aws-sdk/client-s3', { S3Client: class {}, ListObjectsV2Command: class {}, PutObjectCommand: class {}, GetObjectCommand: class {} });
stub('@aws-sdk/s3-request-presigner', { getSignedUrl: async () => 'https://example.invalid/signed' });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = TABLE;
process.env.GAME_TABLE = TABLE;
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

// ---- the real handlers -----------------------------------------------------
const A = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f)).handler;
const G = (f) => require(path.join(REPO, 'lambda-functions', 'game', f)).handler;
const W = (f) => require(path.join(REPO, 'lambda-functions', 'websocket', f)).handler;

const uploadQuestions = A('upload-questions.js');
const adminListSets = A('get-question-sets.js');
const downloadSet = A('download-question-set.js');
const getQuestion = G('get-question.js');
const getAnswers = G('get-answers.js');
const wsMessage = W('message.js');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- callers, IN THIS API'S REAL SHAPE -------------------------------------
// `requestContext.authorizer.lambda`, groups comma-joined. See require-admin.js.
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
const ORG = 'org_acme';
const HOST = caller({
  userId: 'sub-ada', username: 'ada', groups: 'hosts', status: 'enabled',
  orgId: ORG, orgRole: 'admin', orgIds: ORG,
});
/** Engage staff, NO organisation — the only caller who writes platform content. */
const STAFF = caller({
  userId: 'sub-eve', username: 'eve', groups: 'admins', status: 'enabled',
});

const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };

/** Is this value the envelope shape tenant-crypto writes? */
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
const CSV = [
  HEADER,
  '"Leadership",1,"THE THING NOBODY SAID","A retro prompt.","School","Say it now.",',
  '"Leadership",2,"THE THING WE REPEATED","Another retro prompt.","School","Say it now.",',
].join('\n');

const GAME_ID = '4821';
const SET_ID = 'teamretro';
const ORG_SETS = `ORG#${ORG}#SETS`;
const ORG_CONTENT = `ORG#${ORG}#SET#${SET_ID}`;

/**
 * Mint the org exactly as create-org does: ONE GenerateDataKey, and the wrapped
 * blob onto ORG#<id>/METADATA. Every tenant-crypto copy's default loader reads
 * that row through the stubbed DynamoDB, so seeding it here serves the admin,
 * game and websocket bundles alike without any of them being told about it.
 */
async function mintOrg(orgId) {
  const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
  const blob = await C.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  // The plaintext key is now cached in the GAME copy only; the admin and
  // websocket copies are separate module instances with their own caches and
  // will each Decrypt the blob above once. That is the intended behaviour and
  // section 6 measures it.
  C.forgetOrg(orgId);
}

/** The session a participant joins: METADATA carries the org, nothing else does. */
function seedSession({ orgId }) {
  put({
    PK: `GAME#${GAME_ID}`, SK: 'METADATA', GameId: GAME_ID,
    ...(orgId ? { orgId } : {}),
    Title: 'Q3 Retro', GameType: 'call-and-answer',
    QuestionSetId: SET_ID, QuestionSetScope: orgId ? 'org' : 'platform',
    HostPreferences: { anonymousUntilReveal: false },
  });
  put({
    PK: `GAME#${GAME_ID}`, SK: 'STATE', State: 'ASK#001',
    LessonNumber: 1, CurrentQuestionId: 'QUESTION#c001#001',
  });
}

/** The REF row the host pinned when the round started — scope, org and all. */
function seedRef({ scope, orgId, sourceQuestionId }) {
  put({
    PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#REF',
    SourceQuestionId: sourceQuestionId,
    SetId: SET_ID,
    SetScope: scope,
    ...(orgId ? { SetOrgId: orgId } : {}),
    StartedAt: new Date(0).toISOString(),
  });
}

(async () => {
  say('\ntenant-crypto wiring — do the handlers actually encrypt?\n');

  // ── 1. An org's questions go into the table as ciphertext ─────────────────
  //
  // rejects: dropping the `encryptItem` call from upload-questions' question
  // batch, or gating it on something other than the set's scope.
  say('1. upload-questions writes an ORG set as ciphertext');
  store.clear();
  await mintOrg(ORG);

  const created = await uploadQuestions({
    ...HOST,
    body: JSON.stringify({
      fileName: 'retro.csv', fileContent: CSV,
      customTitle: 'Team Retro', customDescription: 'What we learned',
      customInstructions: 'Answer in one sentence.',
      engagementType: 'call-and-answer',
    }),
  });
  await check('the import succeeded', () =>
    assert.strictEqual(created.statusCode, 200, created.body));
  await check('…and produced the org-scoped set', () =>
    assert.strictEqual(parse(created).setId, SET_ID));

  const questionRows = rowsIn(ORG_CONTENT).filter((i) => String(i.SK).startsWith('QUESTION#'));
  await check('two question rows landed in the org partition', () =>
    assert.strictEqual(questionRows.length, 2, `got ${questionRows.length}`));

  await check('every question Title in the store is an ENVELOPE, not a sentence', () => {
    for (const row of questionRows) {
      assert.ok(isEnvelope(row.Title), `Title stored as ${JSON.stringify(row.Title)}`);
    }
  });
  await check('…and so are Detail and CustomInstructions', () => {
    for (const row of questionRows) {
      assert.ok(isEnvelope(row.Detail), `Detail stored as ${JSON.stringify(row.Detail)}`);
      assert.ok(isEnvelope(row.CustomInstructions),
        `CustomInstructions stored as ${JSON.stringify(row.CustomInstructions)}`);
    }
  });
  // The substring sweep is the assertion that catches the field nobody thought
  // to name — the same reasoning as the leak check in player-question-payload.
  await check('the question text appears NOWHERE in the raw org partition', () => {
    const raw = JSON.stringify(rowsIn(ORG_CONTENT));
    assert.ok(!raw.includes('THE THING NOBODY SAID'), 'a question title is readable at rest');
    assert.ok(!raw.includes('Say it now.'), 'a per-question instruction is readable at rest');
  });

  await check('the SETS metadata row is encrypted too (name, description, instruction)', () => {
    const meta = store.get(`${ORG_SETS}|SET#${SET_ID}`);
    assert.ok(meta, 'no metadata row was written');
    assert.ok(isEnvelope(meta.name), `name stored as ${JSON.stringify(meta.name)}`);
    assert.ok(isEnvelope(meta.description), `description stored as ${JSON.stringify(meta.description)}`);
    assert.ok(isEnvelope(meta.customInstruction),
      `customInstruction stored as ${JSON.stringify(meta.customInstruction)}`);
  });
  await check('but the identifiers, counts and flags stay readable — that is the promise', () => {
    const meta = store.get(`${ORG_SETS}|SET#${SET_ID}`);
    assert.strictEqual(meta.orgId, ORG);
    assert.strictEqual(meta.scope, 'org');
    assert.strictEqual(meta.questionCount, 2);
    assert.strictEqual(meta.active, true);
    assert.strictEqual(meta.engagementType, 'call-and-answer');
    assert.strictEqual(meta.createdBy, 'sub-ada');
  });
  await check('the CATEGORY row is deliberately untouched (the mask depends on its order)', () => {
    const cat = rowsIn(ORG_CONTENT).find((i) => String(i.SK).startsWith('CATEGORY#'));
    assert.ok(cat, 'no category row');
    assert.strictEqual(cat.Name, 'Leadership', `Name stored as ${JSON.stringify(cat.Name)}`);
  });

  // ── 2. …and come back as prose on the ANONYMOUS participant path ──────────
  //
  // rejects: get-question deriving the org from the caller instead of from the
  // pinned REF row. That is the mistake this whole wiring is most likely to
  // make, and it is invisible to a test that passes a signed-in event: a real
  // participant has NO authorizer context, `callerOrgId` returns '', and
  // tenant-crypto throws on a blank orgId rather than defaulting. So the event
  // below deliberately carries no identity at all.
  say('\n2. get-question serves plaintext to an anonymous participant');
  seedSession({ orgId: ORG });
  seedRef({ scope: 'org', orgId: ORG, sourceQuestionId: questionRows[0].SK });

  const anonEvent = {
    pathParameters: { gameId: GAME_ID },
    queryStringParameters: { role: 'player' },
    // NO requestContext.authorizer. This is what a phone actually sends.
  };
  const served = await getQuestion(anonEvent);
  await check('200, on a request with no identity whatsoever', () =>
    assert.strictEqual(served.statusCode, 200, served.body));
  await check('the player is shown the real title, not an envelope', () =>
    assert.strictEqual(parse(served).title, 'THE THING NOBODY SAID',
      `title was ${JSON.stringify(parse(served).title)}`));
  await check('…and the real detail and per-question instruction', () => {
    const body = parse(served);
    assert.strictEqual(body.detail, 'A retro prompt.');
    assert.strictEqual(body.customInstructions, 'Say it now.');
  });
  await check('the SET-level instruction riding on the payload is plaintext too', () =>
    assert.strictEqual(parse(served).setCustomInstruction, 'Answer in one sentence.',
      `setCustomInstruction was ${JSON.stringify(parse(served).setCustomInstruction)}`));
  await check('no envelope survives anywhere in the participant payload', () =>
    assert.ok(!/"iv":/.test(served.body) && !/"ct":/.test(served.body),
      `an envelope reached the player: ${served.body.slice(0, 200)}`));

  // The admin list and the CSV download are the other two readers of a set, and
  // an envelope in the download would be re-imported as the literal title.
  await check('the admin list shows the set name in the clear', async () => {
    const listed = parse(await adminListSets(HOST)).questionSets || [];
    const mine = listed.find((s) => s.id === SET_ID);
    assert.ok(mine, 'the set is not in the list');
    assert.strictEqual(mine.name, 'Team Retro', `name was ${JSON.stringify(mine.name)}`);
  });
  await check('the CSV export carries prose, not envelopes', async () => {
    const dl = await downloadSet({ ...HOST, pathParameters: { setId: SET_ID }, queryStringParameters: { format: 'csv' } });
    assert.strictEqual(dl.statusCode, 200, dl.body);
    assert.ok(dl.body.includes('THE THING NOBODY SAID'), 'the export lost the question title');
    assert.ok(!dl.body.includes('"iv"'), 'an envelope was exported into a CSV cell');
  });

  // ── 3. A participant's answer round-trips on the anonymous path ───────────
  //
  // rejects: message.js storing `Answer` in plaintext, or get-answers building
  // its payload before it decrypts (which would hand the voting screen
  // ciphertext to vote on).
  say('\n3. a participant answer: ciphertext at rest, prose to the room');
  const ANSWER = 'We never wrote the runbook down.';
  const stored = await wsMessage({
    requestContext: { connectionId: 'conn-1' },
    body: JSON.stringify({
      messageType: 'ANSWER#1', gameId: GAME_ID, playerName: 'ada', answer: ANSWER,
    }),
  });
  await check('the socket accepted the answer', () =>
    assert.strictEqual(stored.statusCode, 200, JSON.stringify(stored)));

  const answerRow = store.get(`GAME#${GAME_ID}|QUESTION#001#ANSWER#ada`);
  await check('an ANSWER row was written', () => assert.ok(answerRow, 'no answer row'));
  await check('`Answer` is an ENVELOPE at rest', () =>
    assert.ok(isEnvelope(answerRow.Answer), `Answer stored as ${JSON.stringify(answerRow.Answer)}`));
  await check('the sentence appears nowhere in the session partition', () => {
    const raw = JSON.stringify(rowsIn(`GAME#${GAME_ID}`));
    assert.ok(!raw.includes('runbook'), 'the answer is readable at rest');
  });
  await check('but the player NAME and timestamp stay readable — identifiers, not content', () => {
    assert.strictEqual(answerRow.PlayerName, 'ada');
    assert.ok(answerRow.SubmittedAt);
  });

  const board = await getAnswers({
    pathParameters: { gameId: GAME_ID },
    queryStringParameters: { role: 'host', question: '001' },
    // again: no authorizer context. `role` is a claim, not an identity.
  });
  await check('get-answers returns 200 with no identity', () =>
    assert.strictEqual(board.statusCode, 200, board.body));
  await check('…and the room reads the sentence, not the envelope', () => {
    const answers = parse(board).answers || [];
    assert.strictEqual(answers.length, 1, `got ${answers.length} answers`);
    assert.strictEqual(answers[0].answer, ANSWER, `answer was ${JSON.stringify(answers[0].answer)}`);
  });

  // ── 4. PLATFORM content is NOT encrypted, and must not be ─────────────────
  //
  // rejects: encrypting platform (or public) content. There is no organisation
  // to key it to, and it is the shared library EVERY org reads — an org key on
  // it would make the product's own content unreadable by everybody, including
  // the tenant that could not decrypt it either.
  say('\n4. a PLATFORM set is left in plaintext, on purpose');
  store.clear();
  await mintOrg(ORG);

  const platformCreated = await uploadQuestions({
    ...STAFF,
    body: JSON.stringify({
      fileName: 'house.csv', fileContent: CSV,
      customTitle: 'Team Retro', customDescription: 'House content',
      customInstructions: 'Answer in one sentence.',
      engagementType: 'call-and-answer',
    }),
  });
  await check('staff with no org wrote a platform set', () =>
    assert.strictEqual(platformCreated.statusCode, 200, platformCreated.body));
  await check('…at the legacy keys, byte for byte', () =>
    assert.ok(store.get(`SETS|SET#${SET_ID}`), 'no platform metadata row at PK=SETS'));
  await check('its questions are READABLE at rest', () => {
    const rows = rowsIn(`SET#${SET_ID}`).filter((i) => String(i.SK).startsWith('QUESTION#'));
    assert.strictEqual(rows.length, 2, `got ${rows.length}`);
    assert.strictEqual(rows[0].Title, 'THE THING NOBODY SAID',
      `a platform title was stored as ${JSON.stringify(rows[0].Title)}`);
  });
  await check('…and so is its metadata', () => {
    const meta = store.get(`SETS|SET#${SET_ID}`);
    assert.strictEqual(meta.name, 'Team Retro', `platform name stored as ${JSON.stringify(meta.name)}`);
    assert.strictEqual(meta.orgId, undefined, 'a platform row must carry no orgId');
    assert.strictEqual(meta.scope, undefined, 'platform is stamped as an ABSENCE');
  });
  await check('a participant can still play it with no org anywhere in sight', async () => {
    seedSession({ orgId: '' });
    const platformQuestion = rowsIn(`SET#${SET_ID}`)
      .filter((i) => String(i.SK).startsWith('QUESTION#'))
      .sort((a, b) => a.SK.localeCompare(b.SK))[0];
    seedRef({ scope: 'platform', orgId: '', sourceQuestionId: platformQuestion.SK });
    const res = await getQuestion(anonEvent);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).title, 'THE THING NOBODY SAID');
  });

  // ── 5. A row written BEFORE this change still reads ───────────────────────
  //
  // rejects: the passthrough rule breaking. There is no backfill and no
  // re-encrypt pass, so on deploy day every row in the estate is plaintext
  // sitting in a partition whose reader now calls decryptItem. A reader that
  // threw on plaintext would take the product down for every existing customer,
  // and it would do it at RUNTIME, not in a build.
  say('\n5. pre-migration plaintext still reads (there is no backfill)');
  store.clear();
  await mintOrg(ORG);
  // Hand-written the way yesterday's importer wrote it: an ORG partition, an
  // org that HAS a data key now, and not a single envelope on the row.
  put({
    PK: ORG_SETS, SK: `SET#${SET_ID}`, scope: 'org', orgId: ORG,
    name: 'Legacy Retro', description: 'Written before encryption',
    customInstruction: 'Answer in one sentence.',
    engagementType: 'call-and-answer', questionCount: 1, categoryCount: 1, active: true,
    createdAt: '2020-01-01T00:00:00.000Z', createdBy: 'sub-ada',
  });
  put({
    PK: ORG_CONTENT, SK: 'QUESTION#c001#001',
    Title: 'AN OLD QUESTION', Detail: 'Written before encryption.',
    Category: 'Leadership', CustomInstructions: 'Answer it.', Active: true,
  });
  put({
    PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#ANSWER#bo',
    PlayerName: 'bo', QuestionNumber: '001',
    Answer: 'An answer from before the change.', AnswerType: 'text',
    SubmittedAt: '2020-01-01T00:00:00.000Z',
  });
  seedSession({ orgId: ORG });
  seedRef({ scope: 'org', orgId: ORG, sourceQuestionId: 'QUESTION#c001#001' });

  await check('an old plaintext question is served, not rejected', async () => {
    const res = await getQuestion(anonEvent);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).title, 'AN OLD QUESTION');
    assert.strictEqual(parse(res).setCustomInstruction, 'Answer in one sentence.');
  });
  await check('an old plaintext answer is served, not rejected', async () => {
    const res = await getAnswers({
      pathParameters: { gameId: GAME_ID },
      queryStringParameters: { role: 'host', question: '001' },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual((parse(res).answers || [])[0].answer, 'An answer from before the change.');
  });
  await check('an old plaintext set name still lists', async () => {
    const listed = parse(await adminListSets(HOST)).questionSets || [];
    assert.strictEqual((listed.find((s) => s.id === SET_ID) || {}).name, 'Legacy Retro');
  });

  // ── 6. ONE KMS call per org per container, not one per item ───────────────
  //
  // rejects: a call site that reaches for the key per row. The counter is
  // measured across sections 1-5, which encrypted and decrypted dozens of
  // values across three separate bundle copies of tenant-crypto. Three copies
  // means three module caches, so the floor is one Decrypt per copy per org
  // per mint — not one, and certainly not one per field.
  say('\n6. the key is fetched per org, not per field');
  await check(`KMS was called ${kmsCalls.generate + kmsCalls.decrypt} times in total, which is small`, () => {
    // Bounded rather than pinned to an exact number — the point is the ORDER
    // OF MAGNITUDE, and the exact figure moves whenever a section is added.
    // The ceiling is CALIBRATED, not guessed: with the module's key cache
    // disabled this run makes 32 KMS calls, and with it 6. 12 sits between the
    // two, so the assertion genuinely fails if the cache stops working —
    // a bound of 40 would have passed either way, which is no assertion at all.
    assert.ok(kmsCalls.generate + kmsCalls.decrypt < 12,
      `KMS was called ${kmsCalls.generate}× generate + ${kmsCalls.decrypt}× decrypt`);
    assert.ok(kmsCalls.decrypt > 0, 'nothing was ever decrypted — is anything wired in at all?');
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('harness error: ' + (e && e.stack || e)); process.exit(2); });
