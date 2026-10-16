/**
 * THE PHONE CAN TELL WHETHER COMMENTS ARE STILL OPEN (review of test
 * a76fda95, issue #34 P2). After the end, the player's closing screen offers
 * "Something to add?" only while a round can still take comments, so
 * GET /games/{id}/state carries `commentsOpen`, by the same rule the write
 * gate applies (game/late-window.js).
 *
 * rejects: a closing screen that offers comments the server would refuse
 * (closed by the host, or past 24 hours); a running session read as closed;
 * anything but a boolean on the public door.
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
process.env.TABLE_NAME = 'engage-test';
process.env.AWS_REGION = 'us-east-1';
const { createPagedTable, commands } = require('./helpers/paged-table');
const table = createPagedTable({ pageSize: 3 });
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table }, ...commands });
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); } catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

const HOUR = 60 * 60 * 1000;
function seed(gameId, { state, endedAgoMs = null, closed = false }) {
  const PK = `GAME#${gameId}`;
  table.put({
    PK, SK: 'METADATA', Title: 'Comments', HostName: 'Host', GameType: 'call-and-answer',
    CreatedAt: '2026-10-16T09:00:00.000Z', Started: true,
    ...(closed ? { CommentsClosedAt: new Date().toISOString() } : {}),
  });
  table.put({
    PK, SK: 'STATE', State: state, LessonNumber: 6,
    ...(endedAgoMs !== null ? { EndedAt: new Date(Date.now() - endedAgoMs).toISOString() } : {}),
  });
}
const read = async (gameId) => {
  const res = await getState({
    version: '2.0', routeKey: 'GET /games/{gameId}/state', rawPath: `/games/${gameId}/state`,
    pathParameters: { gameId }, requestContext: { routeKey: 'GET /games/{gameId}/state', http: { method: 'GET' } },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

(async () => {
  say('\nstate-comments-open\n');
  for (const [id, opts, want, label] of [
    ['8101', { state: 'RESULTS#006' }, true, 'running: open'],
    ['8102', { state: 'ENDED', endedAgoMs: HOUR }, true, 'ended an hour ago: open'],
    ['8103', { state: 'ENDED', endedAgoMs: 25 * HOUR }, false, 'ended 25 hours ago: closed'],
    ['8104', { state: 'ENDED', endedAgoMs: HOUR, closed: true }, false, 'the host pressed Close comments: closed'],
  ]) {
    seed(id, opts);
    const r = await read(id);
    await check(label, () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.commentsOpen, want);
    });
  }
  await check('the last round is on the same read, for the closing screen\'s list', async () => {
    const r = await read('8102');
    assert.strictEqual(r.body.currentQuestion, 6);
  });
  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
