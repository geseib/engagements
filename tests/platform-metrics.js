/**
 * THE PLATFORM METRICS RECORDERS — lambda-functions/*\/platform-metrics.js.
 *
 * The owner asked for sessions per month, questions answered per category and
 * the average number of questions a session actually got through ("if i bring
 * up a session with 50 questions, but go through 10. it counts as 10"). None of
 * that survives in the table after the fact, so it is recorded as it happens.
 *
 * What this suite has to prove, because a counter that is wrong is worse than
 * no counter:
 *
 *   §1  the three copies are one module, byte for byte
 *   §2  each event counts ONCE — a retried start, a retried or racing round,
 *       an answer resubmitted by the same player, do not count again
 *   §3  an organisation's category is never NAMED and never even READ
 *   §4  a recorder cannot throw, whatever the table does
 *   §5  the rows carry numbers only and no ttl
 *   §6  reading it back: the average divides what it says it divides
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
installStubs({ table, sent: [] });
process.env.TABLE_NAME = 'test-table';

const M = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));

if (!process.env.DEBUG) { console.error = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

/* ---- fixtures ------------------------------------------------------------- */

const SEPT = new Date('2026-09-23T10:00:00Z');
const OCT = new Date('2026-10-02T09:00:00Z');
const opts = (now = SEPT) => ({ db: table.doc, tableName: 'test-table', now });
const row = (pk, sk) => store.get(table.keyOf(pk, sk));
const month = (period = '2026-09') => row(M.METRICS_PK, M.monthSk(period)) || {};
const category = (key, period = '2026-09') => row(M.METRICS_PK, M.categorySk(period, key));
const metricsRows = () => [...store.values()].filter((i) => i.PK === M.METRICS_PK);

const ORG = 'org_acme';
const SECRET_CATEGORY = 'Q3 Layoffs Retro';

function session(gameId, extra = {}) {
  table.put({ PK: `GAME#${gameId}`, SK: 'METADATA', orgId: ORG, Title: { v: 1, ct: 'x' }, ...extra });
}

/** Sets in all three libraries, each with one question in category c001. */
function seedSets() {
  table.put({ PK: 'SET#shared#v1', SK: 'QUESTION#c001#001', Category: 'Leadership', Title: 'Q' });
  table.put({ PK: 'PUBLIC#SET#pubset#v2', SK: 'QUESTION#c001#001', Category: 'Party games', Title: 'Q' });
  table.put({ PK: 'SET#legacy', SK: 'QUESTION#c002#004', Category: 'Retro', Title: 'Q' });
  table.put({ PK: `ORG#${ORG}#SET#ours#v1`, SK: 'QUESTION#c001#001', Category: SECRET_CATEGORY, Title: { v: 1, ct: 'x' } });
}

const PLATFORM_SET = { scope: 'platform', pk: 'SET#shared#v1' };
const PUBLIC_SET = { scope: 'public', pk: 'PUBLIC#SET#pubset#v2' };
const ORG_SET = { scope: 'org', orgId: ORG, pk: `ORG#${ORG}#SET#ours#v1` };

function ref(gameId, q, fields) {
  table.put({ PK: `GAME#${gameId}`, SK: `QUESTION#${q}#REF`, QuestionNumber: q, ...fields });
}

const readsOf = (pk) => table.log.filter((e) => e.type === 'get' && e.input.Key.PK === pk);

function reset() { table.clear(); seedSets(); }

/** A db whose every call fails, synchronously or not. */
const brokenDb = (mode) => ({
  send: mode === 'sync'
    ? () => { throw new Error('boom (sync)'); }
    : async () => { const e = new Error('ProvisionedThroughputExceededException'); e.name = 'ProvisionedThroughputExceededException'; throw e; },
});

(async () => {
  say('\nplatform-metrics: sessions, rounds and answers, counted once and never named\n');

  /* ----------------------------------------------------------------------- */
  say('§1 one module in three bundles');

  // rejects: editing one copy — a drift here means one bundle counts a thing
  // another bundle reads back differently.
  await check('game/, websocket/ and admin/shared/ carry identical copies', () => {
    const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
    const game = read('lambda-functions/game/platform-metrics.js');
    assert.strictEqual(read('lambda-functions/websocket/platform-metrics.js'), game, 'websocket/ copy differs');
    assert.strictEqual(read('lambda-functions/admin/shared/platform-metrics.js'), game, 'admin/shared/ copy differs');
  });

  // rejects: the module reaching for tenant-crypto — it has no business
  // decrypting anything, and tests/kms-grants-match-code.js would then hand
  // every function that records a count a kms:Decrypt grant.
  await check('it requires no crypto and nothing outside its own directory', () => {
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/platform-metrics.js'), 'utf8');
    const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    assert.deepStrictEqual(requires.filter((r) => r.startsWith('.')), ['./tenant']);
    assert.ok(!/tenant-crypto/.test(requires.join(' ')), requires.join(', '));
  });

  /* ----------------------------------------------------------------------- */
  say('\n§2 each event counts once');

  reset();
  await check('two creates are two sessions created', async () => {
    await M.recordSessionCreated({}, opts());
    await M.recordSessionCreated({}, opts(new Date('2026-09-24T08:00:00Z')));
    assert.strictEqual(month().sessionsCreated, 2);
  });
  // rejects: stamping firstRecordedAt on every write, which moves "Counting
  // since" forward every day.
  await check('firstRecordedAt keeps the FIRST moment, not the latest', () => {
    assert.strictEqual(month().firstRecordedAt, SEPT.toISOString());
  });

  reset();
  session('4001');
  await check('a start is counted, and a second start of the same session is not', async () => {
    const first = await M.recordSessionStarted({ gameId: '4001' }, opts());
    const second = await M.recordSessionStarted({ gameId: '4001' }, opts());
    assert.strictEqual(first.counted, true);
    // rejects: counting every call — start-game and next-question both reach
    // startSession, and two Start presses race.
    assert.strictEqual(second.counted, false);
    assert.strictEqual(month().sessionsStarted, 1);
  });
  // rejects: an UPDATE with no attribute_exists(PK), which upserts a phantom
  // METADATA row for a session that does not exist.
  await check('a session with no METADATA row is not counted and not conjured', async () => {
    const r = await M.recordSessionStarted({ gameId: '4999' }, opts());
    assert.strictEqual(r.counted, false);
    assert.strictEqual(row('GAME#4999', 'METADATA'), undefined);
    assert.strictEqual(month().sessionsStarted, 1);
  });

  reset();
  session('4100');
  await check('round 1 is a round served AND a session that served one', async () => {
    const r = await M.recordRoundServed({ gameId: '4100', round: 1, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(r.counted, true);
    assert.strictEqual(r.firstForSession, true);
    assert.strictEqual(month().roundsServed, 1);
    assert.strictEqual(month().sessionsServed, 1);
  });
  // rejects: counting by request rather than by round — a double-tapped or
  // racing next-question serves round 1 twice over the same REF row.
  await check('the same round again is not counted again', async () => {
    const r = await M.recordRoundServed({ gameId: '4100', round: 1, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(r.counted, false);
    assert.strictEqual(month().roundsServed, 1);
  });
  await check('round 2 adds a round and NOT another session', async () => {
    await M.recordRoundServed({ gameId: '4100', round: 2, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(month().roundsServed, 2);
    assert.strictEqual(month().sessionsServed, 1);
  });
  // rejects: a marker that is a SET of seen rounds rather than a ratchet — a
  // late retry of an earlier round must not count once the room has moved on.
  await check('a late retry of an earlier round is not counted', async () => {
    const r = await M.recordRoundServed({ gameId: '4100', round: 1, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(r.counted, false);
    assert.strictEqual(month().roundsServed, 2);
  });
  // rejects: the owner's example, stated as a test. A 50-question set gone
  // through for 3 rounds is 3.
  await check('a session is counted by the rounds it served, not the set it holds', async () => {
    session('4101', { QuestionCount: 50 });
    for (const n of [1, 2, 3]) {
      await M.recordRoundServed({ gameId: '4101', round: n, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    }
    assert.strictEqual(month().roundsServed, 5);       // 2 + 3
    assert.strictEqual(month().sessionsServed, 2);
  });
  await check('a session already mid-flight at deploy counts once, from the round it reached', async () => {
    session('4102');
    const r = await M.recordRoundServed({ gameId: '4102', round: 6, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(r.firstForSession, true);
    assert.strictEqual(month().sessionsServed, 3);
    assert.strictEqual(month().roundsServed, 6);
  });
  await check('a round for a session with no METADATA row is not counted', async () => {
    const r = await M.recordRoundServed({ gameId: '4998', round: 1, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(r.counted, false);
    assert.strictEqual(row('GAME#4998', 'METADATA'), undefined);
  });

  reset();
  session('4200');
  ref('4200', '001', { SourceQuestionId: 'QUESTION#c001#001', SetId: 'shared', SetScope: 'platform', SetVersion: 1 });
  await check('a new answer is counted', async () => {
    const r = await M.recordAnswerStored({ gameId: '4200', questionNumber: '001', previous: undefined }, opts());
    assert.strictEqual(r.counted, true);
    assert.strictEqual(month().answersStored, 1);
  });
  // rejects: counting on every Put. The answer row's key is the player and
  // the question, so a changed answer OVERWRITES — message.js hands over what
  // it overwrote, and that is a resubmission.
  await check('an answer that overwrote an earlier one is not counted again', async () => {
    const r = await M.recordAnswerStored({ gameId: '4200', questionNumber: '001', previous: { PK: 'GAME#4200', Answer: 'x' } }, opts());
    assert.strictEqual(r.counted, false);
    assert.strictEqual(r.reason, 'resubmitted');
    assert.strictEqual(month().answersStored, 1);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§3 whose category is named');

  reset();
  session('4300');
  await check('a question from Engage’s library counts under its category name', async () => {
    await M.recordRoundServed({ gameId: '4300', round: 1, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, opts());
    const c = category('platform#leadership');
    assert.ok(c, `no platform category row: ${JSON.stringify(metricsRows().map((r) => r.SK))}`);
    assert.strictEqual(c.label, 'Leadership');
    assert.strictEqual(c.library, 'platform');
    assert.strictEqual(c.rounds, 1);
  });
  await check('a question from the public library counts under its name, marked public', async () => {
    session('4301');
    await M.recordRoundServed({ gameId: '4301', round: 1, set: PUBLIC_SET, questionId: 'QUESTION#c001#001' }, opts());
    const c = category('public#party games');
    assert.ok(c);
    assert.strictEqual(c.library, 'public');
  });
  // rejects: reading or naming an organisation's category. Its Name is
  // plaintext only because the bitmask needs its order; it is still theirs.
  await check('a question from a team’s own set counts in ONE unnamed bucket', async () => {
    session('4302');
    await M.recordRoundServed({ gameId: '4302', round: 1, set: ORG_SET, questionId: 'QUESTION#c001#001' }, opts());
    const c = category('org');
    assert.ok(c, 'no teams bucket');
    assert.strictEqual(c.label, M.TEAM_SETS_LABEL);
    assert.strictEqual(c.library, 'org');
    assert.ok(!JSON.stringify(metricsRows()).includes(SECRET_CATEGORY), 'the team’s category name reached a metrics row');
  });
  await check('…and the team’s question row is never even read', () => {
    assert.deepStrictEqual(readsOf(ORG_SET.pk), []);
  });
  // rejects: defaulting an unrecognised scope to platform, which would read
  // and name whatever it points at.
  await check('a scope nobody recognises is the unnamed bucket too', async () => {
    session('4303');
    await M.recordRoundServed({ gameId: '4303', round: 1, set: { scope: 'weird', pk: ORG_SET.pk }, questionId: 'QUESTION#c001#001' }, opts());
    assert.strictEqual(category('org').rounds, 2);
    assert.deepStrictEqual(readsOf(ORG_SET.pk), []);
  });

  reset();
  session('4400');
  ref('4400', '001', { SourceQuestionId: 'QUESTION#c001#001', SetId: 'ours', SetScope: 'org', SetOrgId: ORG, SetVersion: 1 });
  ref('4400', '002', { SourceQuestionId: 'QUESTION#c001#001', SetId: 'pubset', SetScope: 'public', SetVersion: 2 });
  ref('4400', '003', { SourceQuestionId: 'QUESTION#c002#004', SetId: 'legacy' });   // pre-tenancy: no scope, no version
  await check('an answer to a team’s own question counts unnamed, without reading the set', async () => {
    await M.recordAnswerStored({ gameId: '4400', questionNumber: '001' }, opts());
    assert.strictEqual(category('org').answers, 1);
    assert.deepStrictEqual(readsOf(ORG_SET.pk), []);
  });
  await check('an answer to a public question counts under its name, from the version the round served', async () => {
    await M.recordAnswerStored({ gameId: '4400', questionNumber: '002' }, opts());
    assert.strictEqual(category('public#party games').answers, 1);
  });
  // rejects: a REF written before scope pinning read as anything but platform.
  await check('a REF with no scope and no version reads the legacy platform partition', async () => {
    await M.recordAnswerStored({ gameId: '4400', questionNumber: '003' }, opts());
    assert.strictEqual(category('platform#retro').answers, 1);
  });
  await check('a REF that names an org but no scope is still the unnamed bucket', async () => {
    ref('4400', '004', { SourceQuestionId: 'QUESTION#c001#001', SetId: 'ours', SetOrgId: ORG });
    await M.recordAnswerStored({ gameId: '4400', questionNumber: '004' }, opts());
    assert.strictEqual(category('org').answers, 2);
    assert.deepStrictEqual(readsOf(ORG_SET.pk), []);
  });
  await check('an answer whose REF row is gone still counts, unnamed', async () => {
    await M.recordAnswerStored({ gameId: '4400', questionNumber: '009' }, opts());
    assert.strictEqual(month().answersStored, 5);
    assert.strictEqual(category('org').answers, 3);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§4 a recorder cannot throw');

  for (const mode of ['async', 'sync']) {
    const bad = { db: brokenDb(mode), tableName: 't', now: SEPT };
    // rejects: any recorder that lets a table error escape into the create,
    // the start, the round or the answer it rides on.
    await check(`every recorder resolves, never rejects, on a ${mode} table failure`, async () => {
      const results = await Promise.all([
        M.recordSessionCreated({}, bad),
        M.recordSessionStarted({ gameId: '1' }, bad),
        M.recordRoundServed({ gameId: '1', round: 1, set: PLATFORM_SET, questionId: 'QUESTION#c001#001' }, bad),
        M.recordAnswerStored({ gameId: '1', questionNumber: '001' }, bad),
      ]);
      for (const r of results) assert.deepStrictEqual(r, { counted: false, reason: 'error' });
    });
  }
  await check('nonsense arguments are refused quietly, not thrown', async () => {
    assert.strictEqual((await M.recordSessionStarted(undefined, opts())).counted, false);
    assert.strictEqual((await M.recordRoundServed({ gameId: '1', round: 'x' }, opts())).counted, false);
    assert.strictEqual((await M.recordRoundServed({ gameId: '1', round: 0 }, opts())).counted, false);
    assert.strictEqual((await M.recordAnswerStored({}, opts())).counted, false);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§5 numbers only, kept forever');

  // rejects: a ttl on a counter row — the history would silently shorten.
  await check('no metrics row carries a ttl', () => {
    const rows = metricsRows();
    assert.ok(rows.length >= 3);
    assert.deepStrictEqual(rows.filter((r) => 'ttl' in r).map((r) => r.SK), []);
  });
  // rejects: a session id, an org id or a title riding along on a counter.
  await check('no metrics row names a session, an organisation or a title', () => {
    const text = JSON.stringify(metricsRows());
    for (const s of ['4400', '4200', ORG, 'GAME#', 'Title', 'orgId', 'gameId']) {
      assert.ok(!text.includes(s), `a metrics row contains ${s}`);
    }
  });

  /* ----------------------------------------------------------------------- */
  say('\n§6 reading it back');

  reset();
  for (const [id, rounds, when] of [['5001', 10, SEPT], ['5002', 2, SEPT], ['5003', 4, OCT]]) {
    session(id);
    for (let n = 1; n <= rounds; n += 1) {
      await M.recordRoundServed({ gameId: id, round: n, set: n % 2 ? PLATFORM_SET : ORG_SET, questionId: 'QUESTION#c001#001' }, opts(when));
    }
  }
  await M.recordSessionCreated({}, opts(OCT));
  await M.recordAnswerStored({ gameId: 'none', questionNumber: '001' }, opts(OCT));
  // A row that CLAIMS a name for the teams' bucket — the reader must not
  // believe a stored label over the rule.
  table.put({ PK: M.METRICS_PK, SK: M.categorySk('2026-10', 'org'), label: SECRET_CATEGORY, library: 'org', rounds: 1, answers: 0 });

  const read = await M.readRecordedMetrics(opts(OCT));
  await check('months come back newest first', () => {
    assert.deepStrictEqual(read.months.map((m) => m.period), ['2026-10', '2026-09']);
  });
  // rejects: dividing by sessions CREATED or STARTED, or by the set's size.
  await check('the average is rounds served ÷ sessions that served at least one, per month', () => {
    const sept = read.months.find((m) => m.period === '2026-09');
    assert.strictEqual(sept.roundsServed, 12);
    assert.strictEqual(sept.sessionsServed, 2);
    assert.strictEqual(sept.averageRounds, 6);
    const oct = read.months.find((m) => m.period === '2026-10');
    assert.strictEqual(oct.averageRounds, 4);
  });
  await check('a month that served nothing has no average, not 0', () => {
    assert.strictEqual(M.averageRounds(0, 0), null);
    assert.strictEqual(M.averageRounds(7, 3), 2.3);
  });
  await check('categories are summed across months, the teams’ bucket last', () => {
    const labels = read.categories.map((c) => c.label);
    assert.strictEqual(labels[labels.length - 1], M.TEAM_SETS_LABEL);
    const leadership = read.categories.find((c) => c.label === 'Leadership');
    assert.strictEqual(leadership.rounds, 5 + 1 + 2);   // odd rounds: 5 of 10, 1 of 2, 2 of 4
  });
  // rejects: trusting a stored label for the unnamed bucket.
  await check('the teams’ bucket is never labelled with what a row claims', () => {
    assert.ok(!JSON.stringify(read).includes(SECRET_CATEGORY));
  });
  await check('countingSince is the earliest first event', () => {
    assert.strictEqual(read.countingSince, SEPT.toISOString());
  });
  await check('months are cut in UTC', () => {
    assert.strictEqual(M.periodOf(new Date('2026-09-30T23:59:59Z')), '2026-09');
    assert.strictEqual(M.periodOf(new Date('2026-10-01T00:00:00Z')), '2026-10');
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})().catch((e) => { say(e.stack); process.exit(1); });
