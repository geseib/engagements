#!/usr/bin/env node
/**
 * LATE ANSWERS ARE KEPT, NOT LOST (session flow v3 §4.4; owner, 14-15 Oct).
 *
 * An answer that reaches the server after its round moved on used to be
 * dropped while the phone showed a receipt. Now:
 *   - it is kept as QUESTION#nnn#LATE#<player>, sealed like an answer, 30 days;
 *   - it is never an ANSWER row: not in the vote, the score, Workie's read, or
 *     the host's live "answered" count;
 *   - the phone is told (answerReceived, late: true); the host hears only that
 *     one was kept (lateAnswerKept), with no name and no words;
 *   - someone who answered on time keeps that answer; one late answer each;
 *   - nothing is kept once the session has ENDED (Q4), or while an event is
 *     paused, or for a round that has not started.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');
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
const { answerTiming } = require(path.join(REPO, 'lambda-functions/websocket/late-answer.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));
const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';
const ORG = 'org_acme';
const HOST = 'host-1';
const PHONE = 'phone-1';
const GAME = '5501';
const PK = `GAME#${GAME}`;

function seed(state, extra = {}) {
  table.store.clear(); sent.length = 0; frames.length = 0;
  kmsStubs.forgetAllOrgs();
  put({ PK, SK: 'METADATA', GameType: 'call-and-answer', Started: true, orgId: ORG, HostPreferences: { anonymousUntilReveal: false } });
  put({ PK, SK: 'STATE', State: state, LessonNumber: 1, CurrentQuestionId: '001', ...extra });
  put({ PK, SK: `CONNECTION#${HOST}`, ConnectionId: HOST, ConnectionType: 'HOST', GameId: GAME });
  put({ PK, SK: `CONNECTION#${PHONE}`, ConnectionId: PHONE, ConnectionType: 'PLAYER', GameId: GAME, PlayerName: 'Ada' });
}

const answer = (text, round = '001') => wsMessage({
  requestContext: { connectionId: PHONE, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({ messageType: `ANSWER#${round}`, gameId: GAME, playerName: 'Ada', answer: text, answerType: 'text' }),
});
const toPhone = () => frames.filter((f) => f.connectionId === PHONE).map((f) => f.message);
const toHost = () => frames.filter((f) => f.connectionId === HOST).map((f) => f.message);
const late = () => get(PK, 'QUESTION#001#LATE#Ada');
const onTime = () => get(PK, 'QUESTION#001#ANSWER#Ada');

(async () => {
  console.log('\nlate-answers: kept apart, labelled, and the phone is told\n');

  await check('the rule: on time at ASK#n; late at VOTE#n, RESULTS#n or a later round; refused otherwise', () => {
    assert.strictEqual(answerTiming('ASK#001', 1), 'on-time');
    assert.strictEqual(answerTiming('VOTE#001', 1), 'late');
    assert.strictEqual(answerTiming('RESULTS#001', 1), 'late');
    assert.strictEqual(answerTiming('ASK#002', 1), 'late');
    for (const s of ['ENDED', 'CREATED', 'STARTED', 'ASK#001', 'SURVEY#OPEN', '']) {
      if (s === 'ASK#001') continue;
      assert.strictEqual(answerTiming(s, 1), 'refused', s);
    }
    assert.strictEqual(answerTiming('VOTE#001', 2), 'refused', 'a round that has not started');
  });

  await check('an answer during voting is kept as a LATE row, sealed, and is not an ANSWER row', async () => {
    seed('VOTE#001');
    await answer('Retire the paper sheet');
    const row = late();
    assert.ok(row, 'no LATE row');
    assert.ok(isEnvelope(row.Answer), 'the late answer is in the clear');
    assert.strictEqual(row.ArrivedDuring, 'VOTE#001');
    assert.ok(row.ttl > Date.now() / 1000 + 29 * 86400, 'not kept for 30 days');
    assert.strictEqual(onTime(), undefined, 'it became an ANSWER row');
  });

  await check('the phone is told it was kept late; the host hears only that one was kept', async () => {
    const phone = toPhone().find((m) => m.type === 'answerReceived');
    assert.deepStrictEqual({ late: phone.late, kept: phone.kept, q: phone.questionNumber }, { late: true, kept: true, q: '001' });
    const host = toHost();
    assert.ok(host.some((m) => m.type === 'lateAnswerKept'), 'the host was not told');
    assert.ok(!host.some((m) => m.type === 'playerAnswered'), 'the host count heard of a late answer');
    assert.ok(!JSON.stringify(host).includes('Ada') && !JSON.stringify(host).includes('paper'), 'a name or the words reached the host');
  });

  await check('a later round still keeps it, labelled with when it arrived', async () => {
    seed('ASK#002', { LessonNumber: 2, CurrentQuestionId: '002' });
    await answer('Late from round one');
    assert.strictEqual(late().ArrivedDuring, 'ASK#002');
  });

  await check('someone who answered on time keeps that one; a second is refused', async () => {
    seed('VOTE#001');
    put({ PK, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'on time' });
    await answer('a change after the fact');
    assert.strictEqual(late(), undefined);
    const phone = toPhone().find((m) => m.type === 'answerReceived');
    assert.deepStrictEqual({ kept: phone.kept, late: phone.late }, { kept: false, late: false });
  });

  await check('one late answer each: a second late one does not replace the first', async () => {
    seed('RESULTS#001');
    await answer('first late');
    const first = JSON.stringify(late().Answer);
    await answer('second late');
    assert.strictEqual(JSON.stringify(late().Answer), first);
  });

  await check('nothing is kept once the session has ended, or while an event is paused', async () => {
    seed('ENDED');
    await answer('too late');
    assert.strictEqual(late(), undefined);
    seed('VOTE#001', { EventPaused: true });
    await answer('paused');
    assert.strictEqual(late(), undefined);
  });

  await check('on time is unchanged: an ANSWER row, the receipt says not late, the host is told', async () => {
    seed('ASK#001');
    await answer('right on time');
    assert.ok(onTime(), 'no ANSWER row');
    assert.strictEqual(late(), undefined);
    assert.strictEqual(toPhone().find((m) => m.type === 'answerReceived').late, false);
    assert.ok(toHost().some((m) => m.type === 'playerAnswered'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
