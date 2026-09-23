/**
 * A trivia answer is scored against the set THE SESSION WAS PINNED TO.
 *
 * websocket/message.js is the only place a trivia verdict is decided — it
 * writes IsCorrect and PointsEarned onto the ANSWER row and game/get-results.js
 * accumulates PointsEarned from there (tests/trivia-scoring-slots.js has the
 * long version). It looked the question up with the BARE id off the REF row:
 *
 *     resolveSetPartition(db, table, questionRef.Item.SetId, SetVersion)
 *
 * and set-version.js reads a bare id as PLATFORM. next-question.js writes
 * `SetScope` / `SetOrgId` onto the REF row precisely so a reader can ask
 * `refSetRef` for the pinned pair; every other game-side reader does
 * (tests/org-set-runtime.js). This one never did, so for a session played from
 * an organisation's own set, or from a public-library copy, the question read
 * missed, the scoring block was skipped without a sound, and the ANSWER row
 * was stored with no IsCorrect and no PointsEarned at all — a whole room on 0.
 *
 * THE SECOND HALF only shows once the first is fixed. An org's question rows
 * are encrypted at rest and optionA..optionF are in ENCRYPTED_FIELDS.question.
 * `correctAnswer` is not, so the mandated `OptionB` spelling scores straight
 * off an undecrypted row — but a set that records the answer as the option's
 * TEXT, which config/setupPanel.js says is as common, compares 'Jupiter' to an
 * envelope and scores nobody.
 *
 * rejects: message.js handing resolveSetPartition a bare id; message.js
 * scoring an org question without decrypting it.
 *
 * FIXTURES ARE PRODUCED, NOT WRITTEN: the ANSWER row asserted on is whatever
 * the real handler stores, and the encrypted question row is whatever the real
 * encryptItem makes of it.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked, and registered before any handler loads.
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const C = require(path.join(REPO, 'lambda-functions/websocket/tenant-crypto.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
};
const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);

const QUESTION = {
  optionA: 'Mercury',
  optionB: 'Jupiter',
  optionC: 'Neptune',
  optionD: 'Saturn',
  points: 10,
};

/**
 * A trivia session on ASK#001, with the REF row exactly as next-question.js
 * writes it — `SetScope`, and `SetOrgId` only when there is one — and the
 * question in the partition that pair addresses.
 */
async function seed({ gameId, sessionOrgId, scope, setOrgId, setId, metaPk, contentPk, correctAnswer, encrypt }) {
  table.store.clear(); sent.length = 0;
  kmsStubs.forgetAllOrgs();
  const PK = `GAME#${gameId}`;
  put({
    PK, SK: 'METADATA', GameType: 'trivia', Started: true,
    QuestionSetId: setId, QuestionSetScope: scope, QuestionSetVersion: 1,
    ...(sessionOrgId ? { orgId: sessionOrgId } : {}),
  });
  put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  put({
    PK, SK: 'QUESTION#001#REF',
    SourceQuestionId: 'QUESTION#c001#001',
    SetId: setId,
    SetVersion: 1,
    SetScope: scope,
    ...(setOrgId ? { SetOrgId: setOrgId } : {}),
    StartedAt: new Date().toISOString(),
  });
  put({ PK: metaPk, SK: `SET#${setId}`, activeVersion: 1, versions: [{ version: 1 }] });
  const row = { PK: contentPk, SK: 'QUESTION#c001#001', ...QUESTION, correctAnswer };
  put(encrypt ? await C.encryptItem(setOrgId, 'question', row) : row);
}

async function scoreAnswer(gameId, playerName, submitted) {
  await wsMessage({
    requestContext: { connectionId: 'player-1' },
    body: JSON.stringify({
      messageType: 'ANSWER#001', gameId, playerName,
      answer: submitted, answerType: 'trivia',
    }),
  });
  return table.store.get(table.keyOf(`GAME#${gameId}`, `QUESTION#001#ANSWER#${playerName}`));
}

const ORG = 'org_acme';
const CASES = [
  { label: 'platform (control)', gameId: '7300', sessionOrgId: ORG, scope: 'platform', setId: 'shared-set', metaPk: 'SETS', contentPk: 'SET#shared-set#v1' },
  { label: "the org's own set", gameId: '7301', sessionOrgId: ORG, scope: 'org', setOrgId: ORG, setId: 'name-that-thing', metaPk: `ORG#${ORG}#SETS`, contentPk: `ORG#${ORG}#SET#name-that-thing#v1`, encrypt: true },
  { label: "another org's public copy", gameId: '7302', sessionOrgId: 'org_other', scope: 'public', setId: 'orgacme-name-that-thing', metaPk: 'PUBLIC#SETS', contentPk: 'PUBLIC#SET#orgacme-name-that-thing#v1' },
];

(async () => {
  console.log('\ntrivia-scoring-set-scope: an answer is scored against the set the session was pinned to\n');

  for (const c of CASES) {
    await seed({ ...c, correctAnswer: 'OptionB' });
    const right = await scoreAnswer(c.gameId, 'Ada', 'B');
    await check(`${c.label}: the right answer is scored CORRECT`, () => {
      assert.ok(right, 'no answer row was written at all');
      assert.strictEqual(right.IsCorrect, true,
        `IsCorrect was ${right.IsCorrect}: the question was never found, so nobody in the room was scored`);
    });
    await check(`${c.label}: …and is paid for it`, () =>
      assert.ok(right.PointsEarned >= 10, `PointsEarned was ${right.PointsEarned}`));

    await seed({ ...c, correctAnswer: 'OptionB' });
    const wrong = await scoreAnswer(c.gameId, 'Bob', 'C');
    await check(`${c.label}: a wrong answer is scored WRONG, not left unscored`, () => {
      assert.strictEqual(wrong.IsCorrect, false, `IsCorrect was ${wrong.IsCorrect}`);
      assert.strictEqual(wrong.PointsEarned, 0, `PointsEarned was ${wrong.PointsEarned}`);
    });
  }

  console.log("\n2. an org set's options are encrypted at rest and the scorer still reads them");
  const enc = CASES[1];
  await seed({ ...enc, correctAnswer: 'Jupiter' });
  const stored = table.store.get(table.keyOf(enc.contentPk, 'QUESTION#c001#001'));
  await check('the seeded option is an envelope, not plaintext', () =>
    assert.ok(stored && typeof stored.optionB === 'object', `stored optionB: ${JSON.stringify(stored && stored.optionB)}`));
  const byText = await scoreAnswer(enc.gameId, 'Ada', 'B');
  await check("an answer recorded as the option's TEXT scores the player who picked it", () =>
    assert.strictEqual(byText.IsCorrect, true,
      `IsCorrect was ${byText.IsCorrect}: 'Jupiter' was compared to ciphertext`));
  await seed({ ...enc, correctAnswer: 'Jupiter' });
  const byTextWrong = await scoreAnswer(enc.gameId, 'Bob', 'C');
  await check('…and nobody else', () => assert.strictEqual(byTextWrong.IsCorrect, false, `IsCorrect was ${byTextWrong.IsCorrect}`));

  console.log('\n3. a REF row written before tenancy carries no scope and still reads as platform');
  await seed({ ...CASES[0], gameId: '7303', correctAnswer: 'OptionB' });
  const ref = table.store.get(table.keyOf('GAME#7303', 'QUESTION#001#REF'));
  delete ref.SetScope;
  const legacy = await scoreAnswer('7303', 'Ada', 'B');
  await check('the legacy REF row scores as it always has', () => assert.strictEqual(legacy.IsCorrect, true, `IsCorrect was ${legacy.IsCorrect}`));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  if (fail) process.exit(1);
})();
