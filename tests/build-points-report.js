/**
 * BUILD ROOM — the report's "Talking points and research" section (Task 6).
 * docs/superpowers/specs/2026-10-09-build-room-talking-points-design.md §6
 *
 * Runs the REAL create-report.js and get-report.js against a stubbed table
 * holding a fixture room: findings with sources, a vote from points, a run list
 * (one done with Claude's note, one skipped to Later), a shown point with
 * ideas sent about it, and a builder's points. Then the same room in a team
 * (org) room, where the rows are sealed and the saved REPORT row must be too.
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

class Cmd { constructor(t) { return class { constructor(i) { this.input = i; this.type = t; } }; } }
const GetCommand = new Cmd('get'); const PutCommand = new Cmd('put'); const DeleteCommand = new Cmd('delete');
const QueryCommand = new Cmd('query'); const ScanCommand = new Cmd('scan'); const UpdateCommand = new Cmd('update');
const BatchWriteCommand = new Cmd('batchWrite');

const store = new Map();
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(k(inp.Key.PK, inp.Key.SK)); return {}; }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const items = [...store.values()].filter((i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand, UpdateCommand, BatchWriteCommand });

/* A fake tenant-crypto that seals exactly the fields the REAL module declares,
   so a field the real list forgets stays visible here as plaintext. */
const REAL = require(path.join(REPO, 'lambda-functions', 'game', 'tenant-crypto.js'));
const SEALED = (v) => ({ __enc: JSON.stringify(v) });
const unwrap = (v) => {
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') {
    if (typeof v.__enc === 'string') return JSON.parse(v.__enc);
    return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, unwrap(b)]));
  }
  return v;
};
stubs.set('./tenant-crypto', {
  encryptItem: async (_o, entity, item) => {
    const out = { ...item };
    for (const f of REAL.ENCRYPTED_FIELDS[entity] || []) if (f in out) out[f] = SEALED(out[f]);
    return out;
  },
  decryptItem: async (_o, _e, item) => unwrap(item),
  decryptItems: async (_o, _e, items) => (items || []).map(unwrap),
  decryptValue: async (_o, v) => unwrap(v),
});
process.env.TABLE_NAME = 'test-table';
const createReport = require(path.join(REPO, 'lambda-functions', 'game', 'create-report.js')).handler;
const getReport = require(path.join(REPO, 'lambda-functions', 'game', 'get-report.js')).handler;
const S = require(path.join(REPO, 'lambda-functions', 'game', 'build-store.js'));
Module._load = realLoad;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4443';
const PK = `GAME#${GAME}`;

/** Seal a BUILD# row the way build-room.js's put() does, when the room is a team's. */
function seed(orgId, row) {
  const item = { PK, ...row };
  const entity = S.entityForSk(item.SK);
  const out = { ...item };
  if (orgId && entity) for (const f of REAL.ENCRYPTED_FIELDS[entity] || []) if (f in out) out[f] = SEALED(out[f]);
  put(out);
}

function seedRoom(orgId) {
  store.clear();
  put({ PK, SK: 'METADATA', GameId: GAME, Title: 'Slider build', GameType: 'build', HostName: 'Ada', CreatedAt: '2026-10-09T15:00:00.000Z', ...(orgId ? { orgId } : {}) });
  put({ PK, SK: 'STATE', State: 'LOBBY', StartedAt: '2026-10-09T15:01:00.000Z' });
  // Two research requests, one of which found nothing sourceable; one ideas request.
  seed(orgId, { SK: 'BUILD#PREQ#001', ReqId: 'r1', Kind: 'research', Subject: 'Accessible colour contrast', Status: 'done', Count: 2, CreatedAt: '2026-10-09T15:05:00.000Z' });
  seed(orgId, { SK: 'BUILD#PREQ#002', ReqId: 'r2', Kind: 'research', Subject: 'Salary by street', Status: 'done', Count: 1, CreatedAt: '2026-10-09T15:20:00.000Z' });
  seed(orgId, { SK: 'BUILD#PREQ#003', ReqId: 'r3', Kind: 'ideas', Subject: 'Header total', Status: 'done', Count: 1, CreatedAt: '2026-10-09T15:12:00.000Z' });
  const f = (n, over) => ({ PK, SK: `BUILD#POINT#${n}`, Kind: 'finding', By: 'claude', ByRole: 'agent', Status: 'new', CreatedAt: `2026-10-09T15:0${n}:00.000Z`, ...over });
  seed(orgId, f('001', { Text: 'Body text needs a contrast ratio of at least 4.5:1.', Sources: [{ title: 'WCAG 2.2, Understanding 1.4.3', url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum' }], RequestId: '001' }));
  seed(orgId, f('002', { Text: 'Mid oranges on white come out near 2:1.', Sources: [{ title: 'Contrast checker', url: 'https://webaim.org/resources/contrastchecker' }], RequestId: '001', Status: 'voting', Outcome: 'voted 6, run item 3, done', VoteCount: 6, ShownAt: '2026-10-09T15:08:00.000Z' }));
  seed(orgId, f('003', { Text: 'Nothing sourceable on salary by street; nearest is median income by tract.', Sources: [{ title: 'Census', url: 'https://www.census.gov/' }], RequestId: '002' }));
  seed(orgId, f('004', { Kind: 'talk', Text: 'Add keyboard support so the slider works without a mouse.', Status: 'sent', Outcome: 'voted 9, run item 1, done', VoteCount: 9 }));
  seed(orgId, f('005', { Kind: 'talk', Text: 'Colour each lot by how long it takes to earn its value.', By: 'Priya', ByRole: 'builder', Status: 'later', Outcome: 'voted 5, saved for later', VoteCount: 5 }));
  seed(orgId, f('006', { Kind: 'talk', Text: 'A point nobody touched.', Status: 'new' }));
  seed(orgId, f('007', { Kind: 'talk', Text: 'The header shows the total in dollars.', Status: 'new', ShownAt: '2026-10-09T15:14:00.000Z' }));
  seed(orgId, f('008', { Kind: 'idea', Text: 'A removed idea.', Status: 'removed' }));
  // Ideas the room sent while point 007 was up: counts only, no names.
  seed(orgId, { SK: 'BUILD#IDEA#001', IdeaId: 'i1', PlayerName: 'Zed Participant', Text: 'hours not dollars', Status: 'new', AboutPoint: '007', CreatedAt: '2026-10-09T15:15:00.000Z' });
  seed(orgId, { SK: 'BUILD#IDEA#002', IdeaId: 'i2', PlayerName: 'Quinn Participant', Text: 'wage view', Status: 'new', AboutPoint: '007', CreatedAt: '2026-10-09T15:15:30.000Z' });
  // The vote from points: voters are named on the answer rows and must not leak.
  seed(orgId, {
    SK: 'BUILD#ASK#001', AskId: 'a1', Kind: 'choice', Status: 'decided', Prompt: 'Which should Claude take on next?', MaxPicks: 3, FromPoints: ['004', '002', '005'], Source: 'host',
    Options: [
      { label: 'A', title: 'Add keyboard support so the slider works without a mouse.', pointId: '004' },
      { label: 'B', title: 'Mid oranges on white come out near 2:1.', pointId: '002' },
      { label: 'C', title: 'Colour each lot by how long it takes to earn its value.', pointId: '005' },
    ],
  });
  const ans = (n, name, choice) => seed(orgId, { SK: `BUILD#ANS#a1#${n}`, AskId: 'a1', PlayerName: name, Choice: choice, CreatedAt: '2026-10-09T15:30:00.000Z' });
  ans('1', 'Zed Participant', ['A', 'B']); ans('2', 'Quinn Participant', ['A', 'C']); ans('3', 'Rae Participant', ['A']);
  // The run list: item 1 done with Claude's note, item 2 skipped to Later.
  seed(orgId, {
    SK: 'BUILD#RUN', RunId: 'run1', Status: 'finished', Cur: 1, StartedAt: '2026-10-09T15:35:00.000Z', FinishedAt: '2026-10-09T15:40:00.000Z',
    Marks: ['done', 'skipped'], SentAt: ['2026-10-09T15:35:00.000Z', ''], DoneAt: ['2026-10-09T15:38:00.000Z', ''],
    Items: [
      { pointId: '004', text: 'Add keyboard support so the slider works without a mouse.', kind: 'talk', site: '', note: 'Arrow keys now move the slider by one step.' },
      { pointId: '005', text: 'Colour each lot by how long it takes to earn its value.', kind: 'talk', site: '', byBuilder: 'Priya' },
    ],
  });
}

const build = () => createReport({ pathParameters: { gameId: GAME }, requestContext: { authorizer: { jwt: { claims: { sub: 'u' } } } } });
const parse = (r) => JSON.parse(r.body);

function assertSection(tp) {
  const text = JSON.stringify(tp);
  check('a section exists for a build room', () => assert.ok(tp));
  const research = tp.requests.filter((q) => q.kind === 'research');
  check('research requests are listed with their subjects, in the order asked', () =>
    assert.deepStrictEqual(research.map((q) => q.subject), ['Accessible colour contrast', 'Salary by street']));
  const first = research[0];
  check('findings carry their source title, link and site', () => {
    assert.strictEqual(first.findings.length, 2);
    assert.deepStrictEqual(first.findings[0].sources[0], { title: 'WCAG 2.2, Understanding 1.4.3', url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum', site: 'w3.org' });
  });
  check('a finding shown to the room says when', () => assert.strictEqual(first.findings[1].shownAt, '2026-10-09T15:08:00.000Z'));
  check('the vote shows its prompt, how many voted and the picks', () => {
    assert.strictEqual(tp.votes.length, 1);
    assert.strictEqual(tp.votes[0].prompt, 'Which should Claude take on next?');
    assert.strictEqual(tp.votes[0].voted, 3);
    assert.strictEqual(tp.votes[0].picks, 5);
    assert.strictEqual(tp.votes[0].maxPicks, 3);
  });
  check('options are ranked by votes, with who posted them and what moved forward', () => {
    const o = tp.votes[0].options;
    assert.deepStrictEqual(o.map((x) => [x.label, x.votes]), [['A', 3], ['B', 1], ['C', 1]]);
    assert.strictEqual(o[0].by, 'Claude');
    assert.strictEqual(o[0].movedForward, true);
    assert.strictEqual(o[0].outcome, 'run item 1, done');
    const c = o.find((x) => x.label === 'C');
    assert.strictEqual(c.by, "Priya's Claude");
    assert.strictEqual(c.movedForward, false);
    assert.strictEqual(c.outcome, 'saved for later');
  });
  check('the run list: done with Claude\'s note, skipped to Later', () => {
    assert.strictEqual(tp.run.items.length, 2);
    assert.deepStrictEqual([tp.run.items[0].state, tp.run.items[0].note, tp.run.items[0].doneAt], ['done', 'Arrow keys now move the slider by one step.', '2026-10-09T15:38:00.000Z']);
    assert.strictEqual(tp.run.items[1].state, 'skipped');
    assert.strictEqual(tp.run.items[1].by, "Priya's Claude");
  });
  check('points shown to the room, with how many ideas were sent about each', () => {
    const texts = tp.shown.map((s) => [s.text, s.ideasSent]);
    assert.deepStrictEqual(texts, [['Mid oranges on white come out near 2:1.', 0], ['The header shows the total in dollars.', 2]]);
  });
  check('a point nobody shown, voted, sent or ran is left out; so is a removed one', () => {
    assert.ok(!text.includes('A point nobody touched'));
    assert.ok(!text.includes('A removed idea'));
  });
  check("builders are named on their own points; the counts say whose", () => {
    assert.deepStrictEqual(tp.counts.fromBuilders, [{ name: "Priya's Claude", n: 1 }]);
    assert.strictEqual(tp.counts.researchRequests, 2);
    assert.strictEqual(tp.counts.ideaRequests, 1);
    assert.strictEqual(tp.counts.votes, 1);
    assert.strictEqual(tp.counts.runs, 1);
  });
  check('no participant name appears anywhere in the section', () => {
    for (const n of ['Zed', 'Quinn', 'Rae', 'Participant']) assert.ok(!text.includes(n), `leaked ${n}`);
  });
}

(async () => {
  say('\n1. A plain room');
  seedRoom('');
  let res = await build();
  check('create-report returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  let report = parse(res).report;
  assertSection(report.talkingPoints);
  check('the saved REPORT row carries the section', () => assert.ok(store.get(k(PK, 'REPORT')).talkingPoints));

  say('\n2. A team room: rows sealed at rest, report decrypts them and re-seals');
  seedRoom('org-1');
  const sealedPoint = store.get(k(PK, 'BUILD#POINT#001'));
  check('fixture really is sealed (Text, Sources)', () => { assert.ok(sealedPoint.Text.__enc); assert.ok(sealedPoint.Sources.__enc); });
  res = await build();
  check('create-report returns 200 for a team room', () => assert.strictEqual(res.statusCode, 200, res.body));
  report = parse(res).report;
  assertSection(report.talkingPoints);
  const saved = store.get(k(PK, 'REPORT'));
  check('the saved REPORT row keeps the section sealed, never plaintext', () => {
    assert.ok(saved.talkingPoints && saved.talkingPoints.__enc, 'talkingPoints is not sealed');
  });
  check('the real report field list names talkingPoints', () => assert.ok(REAL.ENCRYPTED_FIELDS.report.includes('talkingPoints')));

  say('\n3. After the room rows expire, a rebuild keeps the stored section');
  for (const key of [...store.keys()]) if (key.includes('|BUILD#')) store.delete(key);
  res = await build();
  report = parse(res).report;
  check('the stored section survives a rebuild with no live rows', () => assert.ok(report.talkingPoints && report.talkingPoints.votes.length === 1));

  say('\n4. get-report passes the section through to the host');
  const got = await getReport({
    pathParameters: { gameId: GAME },
    requestContext: { authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId: 'org-1', orgIds: 'org-1' } } },
    queryStringParameters: { role: 'host' },
  });
  check('get-report answers and carries talkingPoints', () => {
    assert.strictEqual(got.statusCode, 200, got.body);
    assert.ok(parse(got).talkingPoints);
  });

  say('\n5. A build room that never used points, and another game type');
  seedRoom('');
  for (const key of [...store.keys()]) if (/\|BUILD#(POINT|PREQ|ASK|ANS|IDEA|RUN)/.test(key)) store.delete(key);
  res = await build();
  check('no section (null) when the room used no points', () => assert.strictEqual(parse(res).report.talkingPoints, null));
  seedRoom('');
  store.get(k(PK, 'METADATA')).GameType = 'trivia';
  res = await build();
  check('another game type never gets the section', () => assert.strictEqual(parse(res).report.talkingPoints, null));

  say(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  suiteFinished();
})().catch((e) => { console.error(e); process.exit(1); });
