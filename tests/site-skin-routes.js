/**
 * THE SITE SKIN'S ROUTES (docs/design/themes/SPEC.md §5.2).
 *
 *   1. GET / POST /platform/settings/site-skin — through the real platform
 *      function (admin/orgs/platform-orgs.js → platform-settings.js):
 *      staff only (a host is 403 and nothing is written), no row is Classic,
 *      an unknown skin is 400, a change is audited FIRST (`platform.site-skin`,
 *      detail from/to, the reason) and then the row, refused with 503 and
 *      nothing changed when the audit entry cannot be written; the staff view
 *      never says who changed it; an unknown setting name is 404; claude-models
 *      still answers on the same {name} route.
 *   2. GET /site — through the real public function (websocket/events/
 *      resolve-code.js): `{ skin, updatedAt }` and NOTHING else, the public
 *      cache header, Classic for no row and for a row naming an unknown skin,
 *      a 503 with no-store when the read fails (never a guessed Classic), no
 *      write, and a join code still resolves as before.
 *
 * No network: DynamoDB and KMS are fakes.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const LF = path.join(REPO, 'lambda-functions');

const STUB_PATHS = [REPO, LF, path.join(LF, 'admin'), path.join(LF, 'admin', 'orgs'), path.join(LF, 'websocket'), path.join(LF, 'websocket', 'events')];
function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const writes = [];
const reads = [];
const control = { failAuditPut: false, failGet: false };
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transactWrite'; } }
const fakeDoc = {
  async send(cmd) {
    const i = cmd.input;
    if (cmd.type === 'get') {
      reads.push({ PK: i.Key.PK, SK: i.Key.SK });
      if (control.failGet) { const e = new Error('ProvisionedThroughputExceededException'); e.name = e.message; throw e; }
      return { Item: store.get(key(i.Key.PK, i.Key.SK)) };
    }
    if (cmd.type === 'put') {
      if (control.failAuditPut && String(i.Item.PK).includes('AUDIT')) {
        const e = new Error('ProvisionedThroughputExceededException'); e.name = e.message; throw e;
      }
      store.set(key(i.Item.PK, i.Item.SK), i.Item);
      writes.push({ PK: i.Item.PK, SK: i.Item.SK });
      return {};
    }
    if (cmd.type === 'update') { writes.push({ update: i.Key }); return {}; }
    if (cmd.type === 'query') return { Items: [] };
    throw new Error('test harness: unsupported ' + cmd.type);
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand, TransactWriteCommand,
});
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.AWS_REGION = 'us-east-1';

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e}`); fail += 1; }
}
const say = (s) => console.log(s);
const bodyOf = (r) => JSON.parse(r.body || '{}');
const reset = () => { store.clear(); writes.length = 0; reads.length = 0; control.failAuditPut = false; control.failGet = false; };

const ROW = key('PLATFORM#SETTINGS', 'SITE_SKIN');

(async () => {
  const platformOrgs = require(path.join(LF, 'admin/orgs/platform-orgs.js')).handler;
  const resolve = require(path.join(LF, 'websocket/events/resolve-code.js')).handler;

  const staff = ({ method = 'GET', name = 'site-skin', sub = 'u_staff', groups = 'admins,hosts', body } = {}) => ({
    rawPath: `/dev/platform/settings/${name}`,
    routeKey: `${method} /platform/settings/{name}`,
    pathParameters: { name },
    requestContext: { http: { method }, authorizer: { lambda: { userId: sub, email: `${sub}@x.test`, name: sub, groups } } },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const site = () => ({
    rawPath: '/dev/site',
    routeKey: 'GET /site',
    requestContext: { http: { method: 'GET', path: '/dev/site' } },
  });

  say('\n1. the staff route: GET / POST /platform/settings/site-skin');
  reset();
  await check('a host who is not staff: 403 on GET and POST, nothing written', async () => {
    assert.strictEqual((await platformOrgs(staff({ sub: 'u_host', groups: 'hosts' }))).statusCode, 403);
    assert.strictEqual((await platformOrgs(staff({ method: 'POST', sub: 'u_host', groups: 'hosts', body: { skin: 'present' } }))).statusCode, 403);
    assert.strictEqual(writes.length, 0);
  });
  await check('staff, no row: Classic, the default, the registry, never changed', async () => {
    const r = await platformOrgs(staff());
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(bodyOf(r), { setting: 'site-skin', skin: 'classic', isDefault: true, skins: ['classic', 'present'], updatedAt: null });
  });
  await check('a skin the registry does not have, or no body: 400, nothing written', async () => {
    assert.strictEqual((await platformOrgs(staff({ method: 'POST', body: { skin: 'neon' } }))).statusCode, 400);
    assert.strictEqual((await platformOrgs(staff({ method: 'POST', body: {} }))).statusCode, 400);
    const notJson = staff({ method: 'POST' }); notJson.body = '{nope';
    assert.strictEqual((await platformOrgs(notJson)).statusCode, 400);
    assert.strictEqual(writes.length, 0);
  });
  await check('staff turns Present on: the audit entry FIRST, then the row', async () => {
    const r = await platformOrgs(staff({ method: 'POST', body: { skin: 'present', reason: 'walked on test' } }));
    assert.strictEqual(r.statusCode, 200, r.body);
    const v = bodyOf(r);
    assert.strictEqual(v.skin, 'present');
    assert.strictEqual(v.isDefault, false);
    assert.ok(v.updatedAt);
    assert.strictEqual(writes.length, 2, JSON.stringify(writes));
    assert.strictEqual(writes[0].PK, 'PLATFORM#AUDIT');
    assert.deepStrictEqual(writes[1], { PK: 'PLATFORM#SETTINGS', SK: 'SITE_SKIN' });
    const audit = store.get(key(writes[0].PK, writes[0].SK));
    assert.strictEqual(audit.Action, 'platform.site-skin');
    assert.strictEqual(audit.Actor.Sub, 'u_staff');
    assert.strictEqual(audit.Actor.Role, 'platform-admin');
    assert.deepStrictEqual(audit.Detail, { from: 'classic', to: 'present' });
    const row = store.get(ROW);
    assert.strictEqual(row.RecordType, 'PLATFORM_SETTING');
    assert.strictEqual(row.Skin, 'present');
    assert.strictEqual(row.UpdatedBy, 'u_staff');
    assert.strictEqual(row.ttl, undefined, 'a configuration row carries no ttl');
  });
  await check('the staff view never says who changed it', async () => {
    const r = await platformOrgs(staff());
    assert.strictEqual(bodyOf(r).skin, 'present');
    assert.ok(!r.body.includes('u_staff'), r.body);
  });
  await check('the audit entry cannot be written: 503 and the row is unchanged', async () => {
    control.failAuditPut = true;
    const before = writes.length;
    const r = await platformOrgs(staff({ method: 'POST', body: { skin: 'classic' } }));
    assert.strictEqual(r.statusCode, 503);
    assert.match(bodyOf(r).error, /Nothing was changed/);
    assert.strictEqual(store.get(ROW).Skin, 'present');
    assert.strictEqual(writes.length, before);
    control.failAuditPut = false;
  });
  await check('an unknown setting name: 404; claude-models still answers on {name}', async () => {
    assert.strictEqual((await platformOrgs(staff({ name: 'colour-scheme' }))).statusCode, 404);
    const cm = await platformOrgs(staff({ name: 'claude-models' }));
    assert.strictEqual(cm.statusCode, 200, cm.body);
    assert.strictEqual(bodyOf(cm).setting, 'claude-models');
  });
  await check('the rawPath fallback (no pathParameters) dispatches on the last segment', async () => {
    const e = staff(); delete e.pathParameters;
    assert.strictEqual(bodyOf(await platformOrgs(e)).setting, 'site-skin');
  });

  say('\n2. the public read: GET /site');
  await check('answers { skin, updatedAt } and nothing else, with the public cache header', async () => {
    const r = await resolve(site());
    assert.strictEqual(r.statusCode, 200, r.body);
    const v = bodyOf(r);
    assert.deepStrictEqual(Object.keys(v).sort(), ['skin', 'updatedAt']);
    assert.strictEqual(v.skin, 'present');
    assert.strictEqual(v.updatedAt, store.get(ROW).UpdatedAt);
    assert.ok(!r.body.includes('u_staff'));
    assert.strictEqual(r.headers['Cache-Control'], 'public, max-age=60, stale-while-revalidate=600');
    assert.strictEqual(r.headers['Access-Control-Allow-Origin'], '*');
  });
  await check('one GetItem on the setting row, and no write', async () => {
    reads.length = 0; const w = writes.length;
    await resolve(site());
    assert.deepStrictEqual(reads, [{ PK: 'PLATFORM#SETTINGS', SK: 'SITE_SKIN' }]);
    assert.strictEqual(writes.length, w);
  });
  await check('no row: Classic, never changed', async () => {
    store.delete(ROW);
    assert.deepStrictEqual(bodyOf(await resolve(site())), { skin: 'classic', updatedAt: null });
  });
  await check('a row naming a skin this code does not know: Classic', async () => {
    store.set(ROW, { PK: 'PLATFORM#SETTINGS', SK: 'SITE_SKIN', Skin: 'neon', UpdatedAt: '2026-10-13T00:00:00.000Z' });
    assert.strictEqual(bodyOf(await resolve(site())).skin, 'classic');
  });
  await check('a failed read: 503 with no-store, never a guessed Classic', async () => {
    control.failGet = true;
    const r = await resolve(site());
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r.headers['Cache-Control'], 'no-store');
    assert.ok(!('skin' in bodyOf(r)));
    control.failGet = false;
  });
  await check('the rawPath alone (no routeKey) still reaches the skin', async () => {
    const e = site(); delete e.routeKey;
    assert.strictEqual((await resolve(e)).statusCode, 200);
  });
  await check('a join code still resolves as before, and is not mistaken for /site', async () => {
    reset();
    store.set(key('GAMES', 'GAME#4821'), { PK: 'GAMES', SK: 'GAME#4821' });
    const r = await resolve({ routeKey: 'GET /join/{code}', rawPath: '/dev/join/4821', pathParameters: { code: '4821' }, requestContext: { http: { method: 'GET' } } });
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(bodyOf(r), { code: '4821', kind: 'session' });
    assert.strictEqual((await resolve({ routeKey: 'GET /join/{code}', pathParameters: { code: 'site' }, requestContext: { http: { method: 'GET' } } })).statusCode, 400);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
