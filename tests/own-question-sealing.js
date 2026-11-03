/**
 * A HOST-WRITTEN QUESTION IS SEALED LIKE A SET QUESTION, AND ITS NOTE NEVER
 * REACHES A PARTICIPANT (docs/design/impromptu-ask README §5.1, §7, F5).
 *
 * The OWNQ# row is written with the existing `question` entity under the
 * SESSION's org (ENCRYPTED_FIELDS.question covers Title, Detail, Background,
 * CustomInstructions), so no tenant-crypto change was needed and none is made.
 *
 *   §1 an org session: add-own leaves envelopes at rest; the host's listing
 *      opens them; edit-own re-seals; the phone reads the question in the clear.
 *   §2 an orgless session: the row stays plaintext, as every orgless row does.
 *   §3 the public reads — get-question (player and host role, which is a
 *      client-supplied flag), the public /state, get-results' read-back —
 *      never carry the note or a Background field. The host door carries it
 *      as the host's notes.
 *
 * Drives the REAL handlers against the condition-evaluating fake and a KMS
 * that enforces the key policy (an orgId encryption context on every call).
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];
installStubs({ table, sent });

class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
const kms = {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext && command.input.EncryptionContext.orgId;
        if (!orgId) throw new Error('AccessDeniedException: no orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrap(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext && command.input.EncryptionContext.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException');
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
};
const noopClient = class { async send() { return {}; } };
for (const [name, exports] of [
  ['@aws-sdk/client-kms', kms],
  ['@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} }],
  ['@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} }],
  ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: class { async send() { throw new Error('no Bedrock'); } }, InvokeModelCommand: class {} }],
]) {
  for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
}

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const queueHandler = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js'));
const { handler: getQuestion } = require(path.join(REPO, 'lambda-functions/game/get-question.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';
const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const ORG = 'org_acme';
const SET = 'set-s';
const NOTE = `Private steer ${nodeCrypto.randomBytes(3).toString('hex')}`;
const TITLE = 'What would have to be true for March?';

async function seed(gameId, orgId) {
  store.clear();
  if (orgId) {
    const blob = await crypto.createOrgDataKey(orgId);
    put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
    crypto.forgetOrg(orgId);
  }
  const meta = {
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Sealed', QuestionSetId: SET, QuestionSetVersion: 1,
    ...(orgId ? { orgId } : {}), Started: true, Visibility: 'public',
  };
  put(orgId ? await crypto.encryptItem(orgId, 'session', meta) : meta);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: 'SETS', SK: `SET#${SET}`, activeVersion: 1, versions: [{ version: 1 }] });
  put({ PK: `GAME#${gameId}`, SK: 'STATE#CATS', 'AvailMask1-8': '00000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000', 'HostMask1-8': '00000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' });
}

const hostEvent = (orgId) => ({ authorizer: { lambda: { userId: 'host-1', groups: 'hosts', ...(orgId ? { orgId } : {}) } } });

(async () => {
  for (const orgId of [ORG, '']) {
    const gameId = orgId ? '6301' : '6302';
    const label = orgId ? 'an org session' : 'an orgless session';
    console.log(`\n${orgId ? 1 : 2}. ${label}`);
    await seed(gameId, orgId);

    const added = await queueHandler.handler({
      requestContext: { http: { method: 'POST' }, ...hostEvent(orgId) },
      pathParameters: { gameId },
      body: JSON.stringify({ op: 'add-own', place: 'next', question: { title: TITLE, detail: 'Line for the room', note: NOTE } }),
    });
    const key = JSON.parse(added.body).key;
    const row = store.get(table.keyOf(`GAME#${gameId}`, `OWNQ#${String(key).slice(4)}`));

    // eslint-disable-next-line no-await-in-loop
    await check(`${label}: add-own answers 200`, () => assert.strictEqual(added.statusCode, 200, added.body));
    if (orgId) {
      // eslint-disable-next-line no-await-in-loop
      await check('at rest the words, the note and the task are envelopes (the `question` entity)', () => {
        for (const f of ['Title', 'Detail', 'Background', 'CustomInstructions']) {
          assert.ok(isEnvelope(row[f]), `${f} is not sealed: ${JSON.stringify(row[f])}`);
        }
        assert.ok(!JSON.stringify(row).includes(NOTE), 'the note is in the clear at rest');
        assert.strictEqual(row.OrgId, ORG, 'the row names the org it is sealed under');
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await check('an orgless row stays plaintext', () => {
        assert.strictEqual(row.Title, TITLE);
        assert.strictEqual(row.Background, NOTE);
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await check('the host\'s listing opens it, note included', () => {
      const own = JSON.parse(added.body).ownQuestions.find((o) => o.key === key);
      assert.strictEqual(own.title, TITLE);
      assert.strictEqual(own.note, NOTE);
    });

    const edited = await queueHandler.handler({
      requestContext: { http: { method: 'POST' }, ...hostEvent(orgId) },
      pathParameters: { gameId },
      body: JSON.stringify({ op: 'edit-own', questionKey: key, question: { title: TITLE, detail: 'Line for the room', note: `${NOTE} (edited)` } }),
    });
    const editedRow = store.get(table.keyOf(`GAME#${gameId}`, `OWNQ#${String(key).slice(4)}`));
    // eslint-disable-next-line no-await-in-loop
    await check('edit-own re-seals what it writes', () => {
      assert.strictEqual(JSON.parse(edited.body).changed, true, edited.body);
      if (orgId) assert.ok(isEnvelope(editedRow.Background) && isEnvelope(editedRow.Title));
      else assert.strictEqual(editedRow.Background, `${NOTE} (edited)`);
    });

    const served = await nextQuestion.handler({ requestContext: hostEvent(orgId), pathParameters: { gameId }, body: '{}' });
    // eslint-disable-next-line no-await-in-loop
    await check('Next round serves it', () => assert.strictEqual(served.statusCode, 200, served.body));

    for (const role of ['player', 'host']) {
      const q = await getQuestion({ pathParameters: { gameId }, queryStringParameters: { role } });
      // eslint-disable-next-line no-await-in-loop
      await check(`get-question role=${role}: the question in the clear, never the note`, () => {
        assert.strictEqual(q.statusCode, 200, q.body);
        assert.strictEqual(JSON.parse(q.body).title, TITLE);
        assert.ok(!q.body.includes(NOTE), 'the note reached get-question');
        assert.ok(!/Background|"note"/.test(q.body), 'a note field reached get-question');
      });
    }
    const pub = await getState({ pathParameters: { gameId }, requestContext: { http: { method: 'GET' } } });
    // eslint-disable-next-line no-await-in-loop
    await check('the public /state: the question, never the note', () => {
      assert.ok(pub.body.includes(TITLE), pub.body.slice(0, 200));
      assert.ok(!pub.body.includes(NOTE));
    });
    const hostDoor = await getState({
      routeKey: 'GET /games/{gameId}/host-state',
      requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/host-state', ...hostEvent(orgId) },
      pathParameters: { gameId },
    });
    // eslint-disable-next-line no-await-in-loop
    await check('the host door carries the note as the host\'s notes', () =>
      assert.strictEqual(JSON.parse(hostDoor.body).hostNotes.background, `${NOTE} (edited)`));

    put({ ...store.get(table.keyOf(`GAME#${gameId}`, 'STATE')), State: 'ENDED' });
    put({ PK: `GAME#${gameId}`, SK: 'QUESTION#002#RESULTS', VoteTallies: { 0: { answerText: 'a', totalScore: 1 } }, TotalVotes: 1, MaxVotes: 1 });
    const rb = await getResults({ body: JSON.stringify({ gameId, questionNumber: 2 }) });
    // eslint-disable-next-line no-await-in-loop
    await check('get-results\' public read-back: the question, never the note', () => {
      assert.strictEqual(JSON.parse(rb.body).questionTitle, TITLE, rb.body.slice(0, 300));
      assert.ok(!rb.body.includes(NOTE));
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
