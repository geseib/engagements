#!/usr/bin/env node
/**
 * THE STORED REPORT, ONE ROW PER ROUND (lambda-functions/game/report-store.js).
 *
 * The owner, 15 Oct: "im worried about long sessions creating really long
 * reports and those not working." The single REPORT item is capped at 400 KB;
 * a 30-person session passed it at about nine rounds. This pins:
 *   - a long, crowded session (30 people, 20 rounds) fits: every row is far
 *     under 400 KB even after encryption's growth, while one row would not;
 *   - the whole report reads back exactly, in round order;
 *   - one round reads with one GetItem;
 *   - a report from before the split (one row) still reads, whole and by round;
 *   - a rewrite with fewer rounds removes the stale ones, and the cleanup never
 *     touches a row that is not a round row.
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const suiteFinished = require('./helpers/finish-guard');

// ── a table that honours PK + begins_with(SK, :sk), and counts the calls ──
const store = new Map();
const calls = { get: 0, put: 0, query: 0, delete: 0 };
const key = (pk, sk) => `${pk}\u0000${sk}`;
class Cmd { constructor(t) { return class { constructor(i) { this.input = i; this.type = t; } }; } }
const GetCommand = new Cmd('get'); const PutCommand = new Cmd('put');
const QueryCommand = new Cmd('query'); const DeleteCommand = new Cmd('delete');
const doc = {
  send: async (cmd) => {
    const i = cmd.input || {};
    calls[cmd.type] += 1;
    if (cmd.type === 'get') return { Item: store.get(key(i.Key.PK, i.Key.SK)) };
    if (cmd.type === 'put') { store.set(key(i.Item.PK, i.Item.SK), i.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(key(i.Key.PK, i.Key.SK)); return {}; }
    if (cmd.type === 'query') {
      const v = i.ExpressionAttributeValues;
      assert.ok(/begins_with\(SK, :sk\)/.test(i.KeyConditionExpression), 'the read must be a begins_with on SK');
      const items = [...store.values()].filter((r) => r.PK === v[':pk'] && String(r.SK).startsWith(v[':sk']))
        .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items };
    }
    throw new Error(`unexpected ${cmd.type}`);
  },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@aws-sdk/lib-dynamodb') return { GetCommand, PutCommand, QueryCommand, DeleteCommand };
  if (request === './tenant-crypto' && /report-store/.test(parent.filename)) {
    // Encryption's growth, modelled: every sealed field becomes base64 of its JSON, plus an envelope.
    const sealField = (v) => ({ v: 1, ct: Buffer.from(JSON.stringify(v)).toString('base64'), iv: 'x'.repeat(16), tag: 'y'.repeat(24) });
    const openField = (v) => JSON.parse(Buffer.from(v.ct, 'base64').toString());
    const FIELDS = { report: ['detailedQuestions', 'playerPerformance', 'gameTitle'], reportRound: ['Round'] };
    return {
      encryptItem: async (_org, entity, item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, FIELDS[entity].includes(k) ? sealField(v) : v])),
      decryptItem: async (_org, entity, item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, FIELDS[entity].includes(k) && v && v.ct ? openField(v) : v])),
    };
  }
  return realLoad.call(this, request, parent, isMain);
};
const S = require(path.join(REPO, 'lambda-functions/game/report-store.js'));
Module._load = realLoad;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${label}`); } catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

// A long, crowded session: 30 people, 20 rounds, a 200-character answer each,
// three votes each, a long read, comments and an Ideas question per round.
const words = (n, seed) => Array.from({ length: n }, (_, i) => `word${(i * 7 + seed) % 97}`).join(' ');
const people = Array.from({ length: 30 }, (_, i) => `Person ${i + 1}`);
const round = (n) => ({
  questionNumber: String(n).padStart(3, '0'),
  questionData: { title: `Round ${n}`, detail: words(80, n), customInstructions: words(20, n) },
  answers: people.map((p, j) => ({ playerName: p, answerText: words(30, n + j), totalScore: j, rank: j + 1, votes: [1, 2, 3] })),
  aiSummary: { markdownResponse: words(900, n) },
  comments: people.slice(0, 10).map((p, j) => ({ name: p, text: words(25, j), anchorExcerpt: words(20, j) })),
  followUps: [{ kind: 'ideas', question: words(15, n), ideas: people.map((_, j) => ({ text: words(20, j), shown: j < 3 })) }],
});
const LONG = {
  gameId: '9001', gameTitle: 'A long session', gameStats: { totalQuestions: 20, totalPlayers: 30 },
  playerPerformance: people.map((p, j) => ({ name: p, totalScore: j })),
  detailedQuestions: Array.from({ length: 20 }, (_, i) => round(i + 1)),
};
const TABLE = 'T';
const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
const LIMIT = 400 * 1024;

(async () => {
  console.log('\n1. A long, crowded session fits');
  await check('as ONE row, sealed, it would be over the 400 KB item limit (the failure being fixed)', async () => {
    const one = { PK: 'GAME#x', SK: 'REPORT', detailedQuestions: { ct: Buffer.from(JSON.stringify(LONG.detailedQuestions)).toString('base64') } };
    assert.ok(bytes(one) > LIMIT, `one row is only ${Math.round(bytes(one) / 1024)} KB`);
  });
  await check('written as a head and a row per round, every sealed row is far under 400 KB', async () => {
    await S.writeReport(doc, { table: TABLE, gameId: '9001', orgId: 'acme', report: LONG, ttl: 123 });
    const rows = [...store.values()].filter((r) => r.PK === 'GAME#9001');
    assert.strictEqual(rows.length, 21);
    const biggest = Math.max(...rows.map(bytes));
    assert.ok(biggest < LIMIT / 4, `the biggest row is ${Math.round(biggest / 1024)} KB`);
    assert.ok(rows.every((r) => r.ttl === 123), 'every row carries the ttl');
    assert.ok(rows.filter((r) => r.SK.startsWith('REPORT#R#')).every((r) => r.Round && r.Round.ct), 'a round row is in the clear');
  });

  console.log('\n2. Reading it back');
  await check('the whole report: one GetItem and one Query, every round, in order, exactly', async () => {
    const before = { ...calls };
    const r = await S.readReport(doc, { table: TABLE, gameId: '9001', orgId: 'acme' });
    assert.strictEqual(calls.get - before.get, 1);
    assert.strictEqual(calls.query - before.query, 1);
    assert.deepStrictEqual(r.detailedQuestions, LONG.detailedQuestions);
    assert.deepStrictEqual(r.playerPerformance, LONG.playerPerformance);
    assert.strictEqual(r.ReportLayout, undefined, 'the layout marker leaks into the report');
  });
  await check('one round: one GetItem', async () => {
    const before = { ...calls };
    const r = await S.readReportRound(doc, { table: TABLE, gameId: '9001', orgId: 'acme', questionNumber: '7' });
    assert.strictEqual(calls.get - before.get, 1);
    assert.strictEqual(calls.query - before.query, 0);
    assert.deepStrictEqual(r, LONG.detailedQuestions[6]);
  });
  await check('the head alone: one GetItem, no rounds', async () => {
    const h = await S.readReportHead(doc, { table: TABLE, gameId: '9001', orgId: 'acme' });
    assert.strictEqual(h.gameTitle, 'A long session');
    assert.strictEqual(h.detailedQuestions, undefined);
  });

  console.log('\n3. A report from before the split still reads');
  await check('a single REPORT row reads whole, and by round', async () => {
    store.set(key('GAME#7000', 'REPORT'), { PK: 'GAME#7000', SK: 'REPORT', gameTitle: 'Old', detailedQuestions: [round(1), round(2)] });
    const r = await S.readReport(doc, { table: TABLE, gameId: '7000' });
    assert.strictEqual(r.detailedQuestions.length, 2);
    const one = await S.readReportRound(doc, { table: TABLE, gameId: '7000', questionNumber: '002' });
    assert.strictEqual(one.questionNumber, '002');
  });
  await check('no report at all is null', async () => {
    assert.strictEqual(await S.readReport(doc, { table: TABLE, gameId: '1' }), null);
    assert.strictEqual(await S.readReportRound(doc, { table: TABLE, gameId: '1', questionNumber: '1' }), null);
  });

  console.log('\n4. Rewrites');
  await check('a rewrite with fewer rounds removes the stale round rows, and only round rows', async () => {
    store.set(key('GAME#9001', 'QUESTION#001#ANSWER#Person 1'), { PK: 'GAME#9001', SK: 'QUESTION#001#ANSWER#Person 1' });
    store.set(key('GAME#9001', 'REPORTED'), { PK: 'GAME#9001', SK: 'REPORTED' });
    await S.writeReport(doc, { table: TABLE, gameId: '9001', report: { ...LONG, detailedQuestions: LONG.detailedQuestions.slice(0, 3) }, ttl: 1 });
    const rounds = [...store.values()].filter((r) => r.PK === 'GAME#9001' && r.SK.startsWith('REPORT#R#'));
    assert.deepStrictEqual(rounds.map((r) => r.SK).sort(), ['REPORT#R#001', 'REPORT#R#002', 'REPORT#R#003']);
    assert.ok(store.has(key('GAME#9001', 'QUESTION#001#ANSWER#Person 1')), 'an answer row was deleted');
    assert.ok(store.has(key('GAME#9001', 'REPORTED')), 'a non-round row was deleted');
    const r = await S.readReport(doc, { table: TABLE, gameId: '9001' });
    assert.strictEqual(r.detailedQuestions.length, 3);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
