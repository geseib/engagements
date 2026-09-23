/**
 * WHAT A PLAYER SAID NEVER REACHES THE LOGS.
 *
 * ── THE LEAK ───────────────────────────────────────────────────────────────
 *
 * `lambda-functions/websocket/message.js` stores the ANSWER row encrypted —
 * `encryptItem(orgId, 'answer', …)`, under a comment calling it "THE MOST
 * SENSITIVE ROW IN THE TABLE" — and then wrote the very same words to
 * CloudWatch in plaintext on every submission:
 *
 *   - the arrival log, which dumped the whole frame body, `answer` included
 *   - `🎯 DEBUG TRIVIA ANSWER: … answer=…`
 *   - the trivia check and scoring lines, which quoted the pick and the set's
 *     right answer — spelled as the option's TEXT on many sets, which is
 *     ciphertext at rest in an org's set
 *   - `🌊 Processing wavelength answer …` and `🌊 Processed … [words]`
 *   - `📝 STORING ANSWER RECORD:`, the full row JSON a line BEFORE encryption
 *   - `📤 Sending notification …`, which carries the answer to the host when
 *     the round is not anonymous
 *
 * and game/get-results.js, closing a trivia round, decrypted the room's
 * answers and printed every one of them.
 *
 * Encrypting a field and then logging it is not encrypting it: anyone who can
 * read the log group reads the answers, with no key and no audit trail.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * A log line says WHAT HAPPENED — message type, game, player, question number,
 * the answer's type and LENGTH, isCorrect, points. Never what was said.
 *
 * rejects: any answer text in any console.log / info / warn / error / debug
 *          output while a text, trivia or wavelength answer is submitted, or
 *          while a trivia round is closed; a fix that drops the answer on the
 *          floor (it must still be stored, encrypted, and still reach the host);
 *          a fix that silences the lines (they must still say what happened).
 *
 * FIXTURES ARE PRODUCED, NOT WRITTEN: every ANSWER row here is what the real
 * handler stores, encrypted by the real encryptItem, and the round is closed by
 * the real get-results.js reading those rows back.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
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
const frames = [];
installStubs({ table, sent, frames });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;
const C = require(path.join(REPO, 'lambda-functions/websocket/tenant-crypto.js'));
kmsStubs.installTestKeyLoader();

/* ---- Harness -------------------------------------------------------------- */

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

/**
 * Everything the console prints while `fn` runs, formatted the way the Lambda
 * runtime formats it for CloudWatch (util.format) — but with no depth, array
 * or string limit, so a marker nested three objects down or past the 10 000th
 * character still counts. Printing it is what leaks it; truncation in a
 * default inspect is luck, not redaction.
 */
const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of LEVELS) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

/** A string no fixture, id or log template could contain by accident. */
const marker = (tag) => `zq${tag}${crypto.randomBytes(4).toString('hex')}`;

/** Where in the logs `needle` shows, for a failure message that points at it. */
function leakAt(logs, needle) {
  const lower = logs.toLowerCase();
  const at = lower.indexOf(String(needle).toLowerCase());
  if (at < 0) return null;
  const lineStart = logs.lastIndexOf('\n', at) + 1;
  const lineEnd = logs.indexOf('\n', at);
  return logs.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).slice(0, 300);
}

/** Case-insensitive: wavelength lower-cases what it stores and logs. */
function assertNotLogged(logs, needle, what) {
  const line = leakAt(logs, needle);
  assert.ok(line === null, `${what} reached the logs:\n         ${line}`);
}

const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));
const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';

const ORG = 'org_acme';
const HOST = 'host-1';
const PHONE = 'phone-1';

/**
 * One live room on ASK#001 in an organisation, so its ANSWER rows are
 * encrypted at rest, with a host screen and a phone attached. A text round is
 * NOT anonymous, so the host is sent the answer itself — the notification path
 * that carries it.
 */
async function seedRoom({ gameId, gameType, correctAnswer = 'OptionB', setScope = 'platform', options = {} }) {
  table.store.clear(); sent.length = 0; frames.length = 0;
  kmsStubs.forgetAllOrgs();
  const PK = `GAME#${gameId}`;
  const setId = 'answers-set';
  put({
    PK, SK: 'METADATA', GameType: gameType, Started: true, orgId: ORG,
    QuestionSetId: setId, QuestionSetScope: setScope, QuestionSetVersion: 1,
    HostPreferences: { anonymousUntilReveal: false },
  });
  put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK, SK: `CONNECTION#${HOST}`, ConnectionId: HOST, ConnectionType: 'HOST', GameId: gameId });
  put({ PK, SK: `CONNECTION#${PHONE}`, ConnectionId: PHONE, ConnectionType: 'PLAYER', GameId: gameId, PlayerName: 'Ada' });

  if (gameType !== 'trivia') return;
  // The REF row as next-question.js writes it, and the question where that
  // pinned pair addresses it — an org set's options encrypted, as they are.
  const org = setScope === 'org';
  const metaPk = org ? `ORG#${ORG}#SETS` : 'SETS';
  const contentPk = org ? `ORG#${ORG}#SET#${setId}#v1` : `SET#${setId}#v1`;
  put({
    PK, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: setId, SetVersion: 1, SetScope: setScope, ...(org ? { SetOrgId: ORG } : {}),
    StartedAt: new Date().toISOString(),
  });
  put({ PK: metaPk, SK: `SET#${setId}`, activeVersion: 1, versions: [{ version: 1 }] });
  const row = {
    PK: contentPk, SK: 'QUESTION#c001#001', Title: 'Largest planet',
    optionA: 'Mercury', optionB: 'Jupiter', optionC: 'Neptune', optionD: 'Saturn',
    points: 10, correctAnswer, ...options,
  };
  put(org ? await C.encryptItem(ORG, 'question', row) : row);
}

/** A phone's ANSWER# frame, exactly as PlayerPage sends it. */
const answerFrame = (gameId, answer, answerType) => wsMessage({
  requestContext: { connectionId: PHONE, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({
    messageType: 'ANSWER#001', gameId, playerName: 'Ada', answer, answerType,
    timestamp: '2026-09-23T10:05:00.000Z',
  }),
});

const answerRow = (gameId) => get(`GAME#${gameId}`, 'QUESTION#001#ANSWER#Ada');
const toHost = () => frames.filter((f) => f.connectionId === HOST).map((f) => f.message);

(async () => {
  console.log('\nanswer-content-not-logged: what a player said never reaches the logs\n');

  /* ======================================================================== */
  console.log('1. a text answer');
  {
    const gameId = '5101';
    const secret = marker('text');
    const text = `Honestly the ${secret} launch slipped because nobody owned it`;
    await seedRoom({ gameId, gameType: 'call-and-answer' });
    const { out, logs } = await captureLogs(() => answerFrame(gameId, text, 'text'));

    await check('the frame is accepted', () =>
      assert.strictEqual(out.statusCode, 200, `answered ${out.statusCode}: ${out.body}`));
    await check('the answer is stored, and encrypted at rest', () => {
      const row = answerRow(gameId);
      assert.ok(row, 'no ANSWER row was written');
      assert.ok(isEnvelope(row.Answer), `Answer is stored as ${JSON.stringify(row.Answer)}`);
      assert.strictEqual(kmsStubs.plainRow(ORG, row).Answer, text);
    });
    await check('the host is still sent the answer (the round is not anonymous)', () => {
      const [frame] = toHost();
      assert.ok(frame, 'the host was told nothing');
      assert.strictEqual(frame.type, 'playerAnswered');
      assert.strictEqual(frame.answer, text);
    });
    await check('the answer text is in no log line', () => assertNotLogged(logs, secret, 'the text answer'));
    await check('…and the logs still say what happened', () => {
      for (const fact of ['ANSWER#001', gameId, 'Ada', `${text.length} chars`]) {
        assert.ok(logs.includes(fact), `no log line mentions ${JSON.stringify(fact)}:\n${logs}`);
      }
    });
  }

  /* ======================================================================== */
  console.log('\n2. a trivia answer');
  {
    const gameId = '5102';
    const secret = marker('pick');
    await seedRoom({ gameId, gameType: 'trivia' });
    const { out, logs } = await captureLogs(() => answerFrame(gameId, secret, 'trivia'));

    await check('the frame is accepted', () =>
      assert.strictEqual(out.statusCode, 200, `answered ${out.statusCode}: ${out.body}`));
    await check('the answer is stored encrypted, and scored (wrong: it names no option)', () => {
      const row = answerRow(gameId);
      assert.ok(row, 'no ANSWER row was written');
      assert.ok(isEnvelope(row.Answer), `Answer is stored as ${JSON.stringify(row.Answer)}`);
      assert.strictEqual(kmsStubs.plainRow(ORG, row).Answer, secret);
      assert.strictEqual(row.IsCorrect, false);
      assert.strictEqual(row.PointsEarned, 0);
    });
    await check('the host is still sent the answer', () => {
      const [frame] = toHost();
      assert.ok(frame, 'the host was told nothing');
      assert.strictEqual(frame.answer, secret);
    });
    await check('the submitted answer is in no log line', () => assertNotLogged(logs, secret, 'the trivia answer'));
  }

  {
    // The set's right answer spelled as the option's TEXT — which
    // trivia-answer.js reads, and which an org set holds as ciphertext in
    // optionB. The scoring lines quoted it back in the clear.
    const gameId = '5103';
    const secret = marker('opt');
    const optionText = `Jupiter ${secret}`;
    await seedRoom({ gameId, gameType: 'trivia', setScope: 'org', correctAnswer: optionText, options: { optionB: optionText } });
    const { logs } = await captureLogs(() => answerFrame(gameId, 'B', 'trivia'));

    await check('a right answer is still scored right, and paid', () => {
      const row = answerRow(gameId);
      assert.ok(row, 'no ANSWER row was written');
      assert.strictEqual(row.IsCorrect, true, `IsCorrect was ${row.IsCorrect}`);
      assert.ok(row.PointsEarned >= 10, `PointsEarned was ${row.PointsEarned}`);
    });
    await check("the option's text is in no log line", () => assertNotLogged(logs, secret, "the right option's text"));
    await check('…and the logs still give the verdict and the points', () => {
      assert.ok(/isCorrect[:=]\s*true/.test(logs), `no log line gives isCorrect: true:\n${logs}`);
      assert.ok(/points[:=]\s*1\d\b/.test(logs), `no log line gives the points earned:\n${logs}`);
    });
  }

  /* ======================================================================== */
  console.log('\n3. a wavelength answer');
  {
    const gameId = '5104';
    const words = [marker('wa'), marker('wb'), marker('wc')];
    const submitted = ` ${words[0].toUpperCase()}, ${words[1]},, ${words[2]} `;
    await seedRoom({ gameId, gameType: 'wavelength' });
    const { out, logs } = await captureLogs(() => answerFrame(gameId, submitted, 'wavelength'));

    await check('the frame is accepted', () =>
      assert.strictEqual(out.statusCode, 200, `answered ${out.statusCode}: ${out.body}`));
    await check('the words are normalised, stored and encrypted', () => {
      const row = answerRow(gameId);
      assert.ok(row, 'no ANSWER row was written');
      assert.ok(isEnvelope(row.Answer), `Answer is stored as ${JSON.stringify(row.Answer)}`);
      assert.strictEqual(kmsStubs.plainRow(ORG, row).Answer, words.join(','));
      assert.strictEqual(row.WordCount, 3);
    });
    await check('the host is still sent the answer', () => {
      const [frame] = toHost();
      assert.ok(frame, 'the host was told nothing');
      assert.strictEqual(frame.answer, submitted);
    });
    await check('no word is in any log line', () => {
      for (const word of words) assertNotLogged(logs, word, `the wavelength word ${word}`);
    });
    await check('…and the logs still count the words', () =>
      assert.ok(/\b3 words\b/.test(logs), `no log line counts the 3 words:\n${logs}`));
  }

  /* ======================================================================== */
  console.log('\n4. closing a trivia round reads every answer back');
  {
    const gameId = '5105';
    const secret = marker('close');
    await seedRoom({ gameId, gameType: 'trivia' });
    await captureLogs(() => answerFrame(gameId, secret, 'trivia'));
    await check('(the answer row the phone wrote is there to be read)', () => assert.ok(answerRow(gameId)));

    const { out, logs } = await captureLogs(() => getResults({
      requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
      pathParameters: { gameId },
      body: JSON.stringify({ questionNumber: 1 }),
    }));
    await check('the round closes', () => {
      assert.strictEqual(out.statusCode, 200, `answered ${out.statusCode}: ${out.body}`);
      assert.strictEqual(get(`GAME#${gameId}`, 'STATE').State, 'RESULTS#001');
    });
    await check('the decrypted answers are in no log line', () => assertNotLogged(logs, secret, 'a decrypted trivia answer'));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
