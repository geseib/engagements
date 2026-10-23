/**
 * THE SET CHOOSER'S SERVER FIELDS (issue #41, 23 Oct 2026).
 *
 * The host's chooser (src/src/components/SetChooser.jsx) tells Yours from the
 * team's, filters by date, and lists "Used by you lately". So:
 *   - game/get-question-sets.js carries `mine` (the caller made it: both ids
 *     non-empty and equal, the console's isSetOwner rule), `createdAt`, `updatedAt`;
 *   - game/get-games-list.js carries `questionSetScope` and `byMe` (the caller
 *     made the session).
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

let rows = {};
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
const fakeDoc = {
  async send(cmd) {
    if (cmd.type === 'query') {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      const sk = cmd.input.ExpressionAttributeValues[':sk'] || '';
      return { Items: (rows[pk] || []).filter((r) => String(r.SK).startsWith(sk)) };
    }
    return {};
  },
};
const stub = (name, exports) => {
  for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game')]) {
    let p; try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, QueryCommand, GetCommand, PutCommand: class {}, UpdateCommand: class {}, DeleteCommand: class {}, BatchGetCommand: class {} });
stub('@aws-sdk/client-kms', { KMSClient: class { async send() { throw new Error('no KMS in this suite'); } }, GenerateDataKeyCommand: class {}, DecryptCommand: class {} });
process.env.TABLE_NAME = 'test-table';

const sets = require(path.join(REPO, 'lambda-functions/game/get-question-sets.js'));
const games = require(path.join(REPO, 'lambda-functions/game/get-games-list.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}
const asUser = (userId) => ({
  requestContext: { http: { method: 'GET' }, authorizer: { lambda: { userId, username: 'amara', groups: 'hosts', status: 'enabled' } } },
  pathParameters: {},
});

(async () => {
  console.log('\nthe set chooser\'s server fields\n');
  rows = {
    SETS: [
      { PK: 'SETS', SK: 'SET#mine', name: 'Mine', engagementType: 'poll', createdBy: 'u-1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', active: true },
      { PK: 'SETS', SK: 'SET#theirs', name: 'Theirs', engagementType: 'poll', createdBy: 'u-2', createdAt: '2026-08-01T00:00:00Z', active: true },
      { PK: 'SETS', SK: 'SET#legacy', name: 'Legacy', engagementType: 'poll', active: true },
    ],
  };
  await check('a set says whether this caller made it, and when it was made and changed', async () => {
    const res = await sets.handler(asUser('u-1'));
    assert.strictEqual(res.statusCode, 200, res.body);
    const list = JSON.parse(res.body);
    const by = (id) => list.sets.find((s) => s.id === id);
    assert.deepStrictEqual([by('mine').mine, by('theirs').mine, by('legacy').mine], [true, false, false]);
    assert.deepStrictEqual([by('mine').createdAt, by('mine').updatedAt], ['2026-09-01T00:00:00Z', '2026-10-20T00:00:00Z']);
    assert.strictEqual(by('theirs').updatedAt, '2026-08-01T00:00:00Z', 'never changed: updated is when it was made');
  });
  await check('an anonymous caller owns nothing, even a set with no recorded owner', async () => {
    const res = await sets.handler(asUser(''));
    const list = JSON.parse(res.body);
    assert.strictEqual(list.sets.length, 3);
    assert.ok(list.sets.every((s) => s.mine === false));
  });

  const src = require('fs').readFileSync(path.join(REPO, 'lambda-functions/game/get-games-list.js'), 'utf8');
  await check('the session list carries the pinned set\'s library and whether this caller made it', async () => {
    assert.ok(/questionSetScope: game\.QuestionSetScope \|\| null/.test(src));
    assert.ok(/byMe: Boolean\(me && game\.CreatedBy === me\)/.test(src));
    assert.ok(/const me = callerUserId\(event\)/.test(src));
    assert.strictEqual(typeof games.handler, 'function');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
