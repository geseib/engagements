/**
 * THE BUILD ROOM SESSION KEY — auth/authorizer.js agentKeyContext.
 *
 * The host's Claude Code calls the API with `Bearer eng_<gameId>_<secret>`.
 * That key must open exactly one session's two `build/{proxy+}` routes and
 * nothing else: not another session, not another route of its own session,
 * not after it is revoked, and never by falling through to the JWT branch.
 * And a signed-in human reaching the same routes must be a host — the generic
 * "GET + games is public" rule would otherwise admit a `pending` account.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const AUTH = path.join(REPO, 'lambda-functions', 'auth');

const rows = new Map();
let reads = 0;
class GetCommand { constructor(i) { this.input = i; } }
class QueryCommand { constructor(i) { this.input = i; } }
function stub(name, exports) {
  const p = require.resolve(name, { paths: [AUTH] });
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => ({ send: async (cmd) => { reads += 1; return { Item: rows.get(`${cmd.input.Key.PK}|${cmd.input.Key.SK}`) }; } }) },
  GetCommand, QueryCommand,
});
stub('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class { async send() { throw new Error('no Cognito call expected for a session key'); } },
  AdminListGroupsForUserCommand: class {},
});
process.env.TABLE_NAME = 'test-table';

const { handler, requiredGroupsForRoute } = require(path.join(AUTH, 'authorizer.js'));

let pass = 0; let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; }
}

const KEY = `eng_4821_${'a'.repeat(43)}`;
const HASH = crypto.createHash('sha256').update(KEY).digest('hex');
function seed({ revoked = false, gameType = 'build' } = {}) {
  rows.clear();
  rows.set(`GAME#4821|BUILD#KEY#${HASH}`, { KeyId: HASH.slice(0, 12), MintedBy: 'user-1', ...(revoked ? { RevokedAt: '2026-10-02T00:00:00Z' } : {}) });
  rows.set('GAME#4821|METADATA', { orgId: 'org_A', GameType: gameType });
}
const call = (token, routeKey, gameId = '4821') => handler({
  identitySource: [`Bearer ${token}`],
  routeKey,
  pathParameters: { gameId, proxy: 'state' },
  headers: {},
});

(async () => {
  console.log('\nauthorizer: the Build Room session key\n');
  seed();
  await check('opens GET and POST build/* of its own session, with the session\'s org and no groups', async () => {
    for (const m of ['GET', 'POST']) {
      const r = await call(KEY, `${m} /games/{gameId}/build/{proxy+}`);
      assert.strictEqual(r.isAuthorized, true);
      assert.deepStrictEqual(
        { agent: r.context.agent, game: r.context.agentGameId, hash: r.context.agentKeyHash, org: r.context.orgId, groups: r.context.groups },
        { agent: 'build', game: '4821', hash: HASH, org: 'org_A', groups: '' },
      );
    }
  });
  await check('a builder\'s key carries its role and name; the host\'s says host', async () => {
    const r = await call(KEY, 'GET /games/{gameId}/build/{proxy+}');
    assert.deepStrictEqual([r.context.agentRole, r.context.builderName], ['host', '']);
    rows.set(`GAME#4821|BUILD#KEY#${HASH}`, { KeyId: 'k', Role: 'builder', PlayerName: 'Priya' });
    const b = await call(KEY, 'POST /games/{gameId}/build/{proxy+}');
    assert.deepStrictEqual([b.isAuthorized, b.context.agentRole, b.context.builderName], [true, 'builder', 'Priya']);
    seed();
  });
  await check('another session\'s build routes: denied without a table read', async () => {
    reads = 0;
    const r = await call(KEY, 'GET /games/{gameId}/build/{proxy+}', '1234');
    assert.strictEqual(r.isAuthorized, false);
    assert.strictEqual(reads, 0);
  });
  await check('any other route of its own session: denied', async () => {
    for (const rk of ['POST /games/{gameId}/end', 'GET /games/{gameId}/answers/host', 'GET /games/{gameId}/build-play/{proxy+}', 'POST /games', 'GET /admin/users']) {
      assert.strictEqual((await call(KEY, rk)).isAuthorized, false, rk);
    }
  });
  await check('revoked, unknown, or a session that is not a Build Room: denied', async () => {
    seed({ revoked: true });
    assert.strictEqual((await call(KEY, 'GET /games/{gameId}/build/{proxy+}')).isAuthorized, false);
    seed();
    assert.strictEqual((await call(`eng_4821_${'b'.repeat(43)}`, 'GET /games/{gameId}/build/{proxy+}')).isAuthorized, false);
    seed({ gameType: 'call-and-answer' });
    assert.strictEqual((await call(KEY, 'GET /games/{gameId}/build/{proxy+}')).isAuthorized, false);
  });
  await check('a malformed eng_ token is denied, never tried as a JWT', async () => {
    seed();
    assert.strictEqual((await call('eng_4821_short', 'GET /games/{gameId}/build/{proxy+}')).isAuthorized, false);
  });
  await check('a signed-in human on the build routes must be a host or admin', () => {
    for (const m of ['GET', 'POST']) assert.deepStrictEqual(requiredGroupsForRoute(m, 'games/{gameId}/build/{proxy+}'), ['hosts', 'admins']);
  });
  await check('the player routes are not behind the authorizer at all — but GET /games/{id} stays public', () => {
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}'), []);
  });
  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
