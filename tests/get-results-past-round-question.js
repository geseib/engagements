/**
 * AN EARLIER ROUND READ BACK CARRIES ITS LESSON (issue #47) —
 * game/get-results.js, the public read a phone makes when a participant goes
 * back to a finished round from the end screen ("Something to add?").
 *
 * Until this, that read carried `questionTitle` and nothing else of the
 * question, so the phone showed "Lesson 2", the title, and the responses, and
 * the lesson the room had answered was gone. It now carries `question`: the
 * question's PUBLIC fields, the ones get-question.js already sent this phone
 * live during ASK — title, detail (the lesson), category, the question's own
 * instruction, image, school.
 *
 * rejects: `question` missing from either read-back (a shown round's stored
 *          results; a round nobody answered); an org set's sealed Title,
 *          Detail or CustomInstructions reaching the phone as an envelope or
 *          decrypted with the session's org rather than the set's; the
 *          question's Background (Workie-only), AnswerDetails (the spoiler) or
 *          ClaudeNote in the response at all; `questionTitle` (issue #35's
 *          heading) dropped; a question that cannot be read failing the read
 *          rather than answering `question: null`; any write on the read.
 *
 * No existing public question read serves a COMPLETED round:
 * get-question.js answers only for the round the session is on
 * (STATE.LessonNumber) and 400s once it has ENDED. So the read-back the
 * historical path already makes is the one widened.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

let writes = 0;
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      default: writes++; return {};
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { writes++; return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('no Bedrock on a read-back'); } },
  InvokeModelCommand: class {},
});
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

installTestKeyLoader();
const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const tenant = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { setPartition } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const publicEvent = (gameId, questionNumber) => ({
  version: '2.0',
  routeKey: 'POST /games/get-results',
  rawPath: '/dev/games/get-results',
  requestContext: { routeKey: 'POST /games/get-results', http: { method: 'POST', path: '/dev/games/get-results' } },
  body: JSON.stringify({ gameId, questionNumber }),
});

const QUESTION = {
  Title: 'Form Follows Function',
  Detail: 'The handle of a hammer tells you where your hand goes.',
  Category: 'Design',
  CustomInstructions: 'Name a tool whose shape explains itself.',
  Image: 'https://img.example/hammer.jpg',
  School: 'Bauhaus',
  Background: 'WORKIE-ONLY: the facilitator wants the room to land on affordances.',
  AnswerDetails: 'SPOILER: the answer is Louis Sullivan.',
  ClaudeNote: 'NOTE-FOR-CLAUDE',
};

/**
 * One finished session, its rounds played from a set in `setScope`
 * (`setOrg` for an org set), the session itself in `sessionOrg`.
 */
async function seed(gameId, { sessionOrg = '', setScope = tenant.PLATFORM, setOrg = '' } = {}) {
  store.clear();
  writes = 0;
  const seal = async (orgId, entity, item) => (orgId ? crypto.encryptItem(orgId, entity, item) : item);
  put(await seal(sessionOrg, 'session', {
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Design week',
    ...(sessionOrg ? { orgId: sessionOrg } : {}),
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'ENDED', LessonNumber: 2, CurrentQuestionId: '002' });
  const pk = setPartition({ scope: setScope, orgId: setOrg, setId: 'design' });
  for (const n of ['001', '002']) {
    put({
      PK: `GAME#${gameId}`, SK: `QUESTION#${n}#REF`, SourceQuestionId: `QUESTION#Design#${n}`,
      SetId: 'design', SetScope: setScope, ...(setOrg ? { SetOrgId: setOrg } : {}),
      StartedAt: new Date(Date.now() - 60000).toISOString(),
    });
    put(await seal(setScope === tenant.ORG ? setOrg : '', 'question', {
      PK: pk, SK: `QUESTION#Design#${n}`, ...QUESTION, Title: `${QUESTION.Title} ${n}`,
    }));
  }
  // Round 1 was shown: its results are stored. Round 2 nobody answered.
  put(await seal(sessionOrg, 'results', {
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#RESULTS', GameId: gameId, QuestionId: '001',
    VoteTallies: { 0: { playerName: 'Ada', answerText: 'a door handle', totalScore: 3 } },
    MaxVotes: 3, TotalVotes: 1, CompletedAt: '2026-10-20T10:00:00.000Z',
  }));
}

const read = async (gameId, n) => {
  const res = await handler(publicEvent(gameId, n));
  assert.strictEqual(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
};

function assertPublicQuestion(body, n) {
  assert.ok(body.question && typeof body.question === 'object', `no question in ${JSON.stringify(body)}`);
  assert.deepStrictEqual(body.question, {
    title: `Form Follows Function ${n}`,
    detail: QUESTION.Detail,
    category: 'Design',
    customInstructions: QUESTION.CustomInstructions,
    image: QUESTION.Image,
    school: 'Bauhaus',
  });
  assert.strictEqual(body.questionTitle, `Form Follows Function ${n}`);
  const text = JSON.stringify(body);
  for (const secret of ['WORKIE-ONLY', 'SPOILER', 'NOTE-FOR-CLAUDE']) {
    assert.ok(!text.includes(secret), `${secret} reached the phone`);
  }
  assert.ok(!/"Background"|"background"|"answerDetails"|"AnswerDetails"/.test(text), 'a non-public field name is in the response');
}

(async () => {
  await seed('9471');
  const shown = await read('9471', '001');
  await check('platform set: a shown round reads back with its public question', () => {
    assert.strictEqual(shown.stored, true);
    assertPublicQuestion(shown, '001');
  });
  const empty = await read('9471', '002');
  await check('platform set: a round nobody answered reads back with its public question too', () => {
    assert.strictEqual(empty.noAnswers, true);
    assertPublicQuestion(empty, '002');
  });
  await check('neither read wrote or announced anything', () => assert.strictEqual(writes, 0));

  // An org's own set: Title, Detail, CustomInstructions and Background are
  // sealed under the SET's org. The session runs in the same org.
  await seed('9472', { sessionOrg: 'acme', setScope: tenant.ORG, setOrg: 'acme' });
  await check('the org fixture really is sealed', () => {
    const raw = [...store.values()].find((i) => String(i.PK).startsWith('ORG#acme#SET#'));
    assert.strictEqual(typeof raw.Title, 'object');
    assert.strictEqual(typeof raw.Detail, 'object');
    assert.strictEqual(typeof raw.CustomInstructions, 'object');
  });
  await check('org set: the sealed fields come back decrypted, Background still absent', async () => {
    assertPublicQuestion(await read('9472', '001'), '001');
    assertPublicQuestion(await read('9472', '002'), '002');
  });

  // A host in org A running a set of org B's? Not possible; but a host in an
  // org running a PLATFORM set is, and the question is then plaintext and must
  // not be "decrypted" with the session's org.
  await seed('9473', { sessionOrg: 'acme', setScope: tenant.PLATFORM });
  await check('org session on a platform set: read as stored, not opened with the session org', async () => {
    assertPublicQuestion(await read('9473', '001'), '001');
  });

  // The set row gone: the read still answers, with no question.
  await seed('9474');
  for (const k of [...store.keys()]) if (k.startsWith('SET#design|')) store.delete(k);
  const gone = await read('9474', '001');
  await check('a question that cannot be read: question null, title empty, results still there', () => {
    assert.strictEqual(gone.question, null);
    assert.strictEqual(gone.questionTitle, '');
    assert.ok(gone.voteTallies);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
