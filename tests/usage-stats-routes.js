/**
 * WHO SEES THE USAGE STATS — GET /orgs/{orgId}/stats and GET /platform/stats
 * (docs/design/usage-stats/SPEC.md §9, §11).
 *
 *   §1  the team route: an owner and an admin are answered; a member is
 *       refused; a stale context with no MEMBER row is refused; another
 *       organisation's id is refused
 *   §2  what the team sees: months by type, the plan's numbers for months
 *       before counting began, members' numbers for THIS team only, its sets
 *   §3  the staff route: staff only; opening a team or an account writes the
 *       audit entry BEFORE any stats row is read, and a failed entry refuses
 *       with nothing shown; a team set is shown by ref, never by id
 *   §4  neither handler can decrypt: no tenant-crypto in the stats modules'
 *       require graph (the audit log's own sealing aside)
 *   §5  the template: exactly two new route events, on the two named
 *       functions, each behind the Cognito authorizer
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const { createPagedTable } = require('./helpers/paged-table');
const { dynamoModules } = require('./helpers/ddb-module-stub');
const { routesFromTemplate, assertScannerWorks } = require('./helpers/template-routes');

const table = createPagedTable({ pageSize: 3 });
const mods = dynamoModules(table);
const stubs = new Map([['@aws-sdk/lib-dynamodb', mods.lib], ['@aws-sdk/client-dynamodb', mods.client]]);
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
process.env.TABLE_NAME = 'test-table';

const getUsage = require(path.join(REPO, 'lambda-functions/admin/get-usage.js')).handler;
const platformOrgs = require(path.join(REPO, 'lambda-functions/admin/orgs/platform-orgs.js')).handler;
const V = require(path.join(REPO, 'lambda-functions/admin/shared/usage-stats-view.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const NW = 'org_NorthwindAAAAAAAAAAAAAA'.slice(0, 26);
const HL = 'org_HarbourBBBBBBBBBBBBBBBB'.slice(0, 26);
const THIS = new Date().toISOString().slice(0, 7);
const LAST = V.addMonths(THIS, -1);

function seed() {
  table.store.clear();
  table.log.length = 0;
  for (const [org, name] of [[NW, 'Northwind'], [HL, 'Halcyon']]) {
    table.put({ PK: `ORG#${org}`, SK: 'METADATA', orgId: org, name, type: 'team', plan: 'team', status: 'active' });
    table.put({ PK: 'ORGS', SK: `ORG#${org}`, orgId: org, name, type: 'team', plan: 'team' });
  }
  table.put({ PK: `ORG#${NW}`, SK: 'MEMBER#u-ana', userId: 'u-ana', role: 'owner', displayName: 'Ana Ruiz', email: 'ana@nw.example' });
  table.put({ PK: `ORG#${NW}`, SK: 'MEMBER#u-ben', userId: 'u-ben', role: 'admin', displayName: 'Ben Okafor', email: 'ben@nw.example' });
  table.put({ PK: `ORG#${NW}`, SK: 'MEMBER#u-cy', userId: 'u-cy', role: 'member', displayName: 'Chloe Park', email: 'cy@nw.example' });
  // This month, recorded: two types and an event row, and a gauge.
  table.put({ PK: `ORG#${NW}`, SK: `STATS#${THIS}#TYPE#trivia`, created: 5, started: 4, counted: 4, questions: 52, participants: 88, firstRecordedAt: `${THIS}-02T09:00:00.000Z` });
  table.put({ PK: `ORG#${NW}`, SK: `STATS#${THIS}#TYPE#build`, created: 1, started: 1, questions: 11, participants: 6, decisions: 7, tasks: 4 });
  table.put({ PK: `ORG#${NW}`, SK: `STATS#${THIS}#TYPE#event`, created: 2, started: 1, participants: 46 });
  table.put({ PK: `ORG#${NW}`, SK: `STATS#${THIS}#GAUGE`, existing: { trivia: 2, build: 1 }, setsHeld: 12, snapshotAt: `${THIS}-11T00:05:00.000Z` });
  // Last month, before counting began: only the plan meter.
  table.put({ PK: `ORG#${NW}`, SK: `USAGE#${LAST}`, sessionsRun: 19, setsPeak: 11 });
  // Ana's numbers in Northwind AND in another team: the team sees Northwind's only.
  table.put({ PK: 'USER#u-ana', SK: `STATS#${THIS}#TYPE#trivia#ORG#${NW}`, orgId: NW, created: 3, counted: 2, questions: 30, participants: 50 });
  table.put({ PK: 'USER#u-ana', SK: `STATS#${THIS}#TYPE#poll#ORG#${HL}`, orgId: HL, created: 9, counted: 9, questions: 99, participants: 99 });
  table.put({ PK: 'USER#u-ana', SK: `STATS#${THIS}#GAUGE#ORG#${NW}`, orgId: NW, existing: { trivia: 1 }, setsHeld: 5 });
  // The team's set, two versions.
  table.put({ PK: `ORG#${NW}#SETSTATS`, SK: 'SET#q3retro#V#2', sessions: 4, questions: 33, downloads: 1, lastAt: `${THIS}-09T10:00:00.000Z` });
  table.put({ PK: `ORG#${NW}#SETSTATS`, SK: 'SET#q3retro#V#1', sessions: 1, questions: 8 });
}

const asOrg = (orgId, role, userId) => ({
  requestContext: { http: { method: 'GET' }, authorizer: { lambda: { userId, groups: 'hosts', orgId, orgIds: orgId, orgRole: role } } },
});
const teamGet = (orgId, who, query) => getUsage({
  ...who, rawPath: `/dev/orgs/${orgId}/stats`, pathParameters: { orgId }, queryStringParameters: query,
});
const STAFF = { requestContext: { http: { method: 'GET' }, authorizer: { lambda: { userId: 'u-staff', email: 'dai@engage.example', groups: 'admins', orgId: '' } } } };
const staffGet = (query, who = STAFF) => platformOrgs({ ...who, rawPath: '/dev/platform/stats', queryStringParameters: query });
const body = (res) => JSON.parse(res.body);

(async () => {
  say('\nusage stats: the routes\n');

  say('§1 the team route');
  seed();
  // rejects: a member (not owner/admin) reading the team's numbers.
  await check('a member is refused 403', async () => {
    const res = await teamGet(NW, asOrg(NW, 'member', 'u-cy'));
    assert.strictEqual(res.statusCode, 403, res.body);
  });
  await check('an owner and an admin are answered', async () => {
    assert.strictEqual((await teamGet(NW, asOrg(NW, 'owner', 'u-ana'))).statusCode, 200);
    assert.strictEqual((await teamGet(NW, asOrg(NW, 'admin', 'u-ben'))).statusCode, 200);
  });
  // rejects: trusting the token's role alone — a person demoted or removed
  // still carries the old context for minutes.
  await check('a stale admin context with no MEMBER row is refused', async () => {
    const res = await teamGet(NW, asOrg(NW, 'admin', 'u-gone'));
    assert.strictEqual(res.statusCode, 403);
  });
  // rejects: an admin of Northwind reading Halcyon by editing the URL.
  await check('another organisation\'s id is refused', async () => {
    const res = await teamGet(HL, asOrg(NW, 'owner', 'u-ana'));
    assert.strictEqual(res.statusCode, 403);
  });
  await check('a bad range is a 400', async () => {
    assert.strictEqual((await teamGet(NW, asOrg(NW, 'owner', 'u-ana'), { to: 'October' })).statusCode, 400);
    assert.strictEqual((await teamGet(NW, asOrg(NW, 'owner', 'u-ana'), { from: '2020-01', to: THIS })).statusCode, 400);
  });

  say('\n§2 what the team sees');
  const team = body(await teamGet(NW, asOrg(NW, 'owner', 'u-ana')));
  await check('this month by type, the total leaving events out, the gauge', () => {
    const m = team.months[0];
    assert.strictEqual(m.period, THIS);
    assert.strictEqual(m.byType.trivia.questions, 52);
    assert.strictEqual(m.totals.questions, 63);
    assert.strictEqual(m.totals.created, 6);
    assert.strictEqual(m.events.participants, 46);
    assert.strictEqual(m.gauge.kept, 3);
    assert.strictEqual(m.gauge.setsHeld, 12);
    assert.strictEqual(team.countingSince, `${THIS}-02T09:00:00.000Z`);
  });
  // rejects: a month before counting showing zeros instead of the plan's number.
  await check('last month is unrecorded and carries the plan\'s counted sessions', () => {
    const m = team.months[1];
    assert.strictEqual(m.period, LAST);
    assert.strictEqual(m.recorded, false);
    assert.strictEqual(m.plan.sessionsRun, 19);
  });
  // rejects: a member's work in another team leaking into this team's view.
  await check('members: their numbers for THIS team only', () => {
    const ana = team.members.find((m) => m.userId === 'u-ana');
    assert.strictEqual(ana.displayName, 'Ana Ruiz');
    assert.strictEqual(ana.months[THIS].totals.created, 3);
    assert.strictEqual(ana.months[THIS].setsHeld, 5);
    assert.ok(!JSON.stringify(team).includes('99'), 'Halcyon numbers leaked');
    assert.strictEqual(team.members.length, 3);
  });
  await check('the team\'s own sets, by id, every version and the total', () => {
    const [set] = team.sets;
    assert.strictEqual(set.setId, 'q3retro');
    assert.deepStrictEqual(set.versions.map((v) => v.version), [2, 1]);
    assert.strictEqual(set.total.sessions, 5);
    assert.strictEqual(set.total.questions, 41);
  });

  say('\n§3 the staff route');
  // rejects: a team owner (hosts, not admins) reaching the staff route.
  await check('a host who is not staff is refused 403', async () => {
    const res = await staffGet({ org: NW }, asOrg(NW, 'owner', 'u-ana'));
    assert.strictEqual(res.statusCode, 403);
  });
  // rejects: reading first and logging after — or not logging at all.
  await check('opening a team writes the audit entry before any stats row is read', async () => {
    seed();
    const res = await staffGet({ org: NW });
    assert.strictEqual(res.statusCode, 200, res.body);
    const firstWrite = table.log.findIndex((e) => e.kind === 'put' && /AUDIT/.test(String(e.input.Item.PK)) && e.input.Item.Action === 'stats.viewed');
    const firstStats = table.log.findIndex((e) => e.kind === 'query' && /^STATS#|SETSTATS$|^MEMBER#/.test(`${e.input.ExpressionAttributeValues[':sk']}|${e.input.ExpressionAttributeValues[':pk']}`.split('|').find((x) => /STATS|MEMBER/.test(x)) || ''));
    assert.ok(firstWrite !== -1, 'no stats.viewed audit entry');
    assert.ok(firstStats === -1 || firstWrite < firstStats, `audit at ${firstWrite}, first read at ${firstStats}`);
    const entry = table.log[firstWrite].input.Item;
    assert.strictEqual(entry.Actor.Role, 'platform-admin');
    assert.deepStrictEqual(entry.Target, { Type: 'org', Id: NW });
  });
  // rejects: answering when the audit could not be written.
  await check('a failed audit entry refuses with 503 and shows nothing', async () => {
    seed();
    table.failPutsTo = (item) => /AUDIT/.test(String(item.PK));
    const res = await staffGet({ org: NW });
    table.failPutsTo = null;
    assert.strictEqual(res.statusCode, 503);
    assert.ok(!res.body.includes('q3retro') && !res.body.includes('52'));
    assert.ok(!table.log.some((e) => e.kind === 'query' && /STATS/.test(String(e.input.ExpressionAttributeValues[':sk'] || '') + String(e.input.ExpressionAttributeValues[':pk']))), 'stats were read');
  });
  // rejects: a team set's id (its slug, which can echo a sealed title) shown to staff.
  await check('staff see a team set by ref, never by id', async () => {
    seed();
    const res = body(await staffGet({ org: NW }));
    assert.ok(!JSON.stringify(res.sets).includes('q3retro'));
    assert.strictEqual(res.sets[0].ref, V.staffSetRef(NW, 'q3retro'));
    assert.strictEqual(res.org.name, 'Northwind');
    const one = await staffGet({ set: `org:${NW}:${res.sets[0].ref}` });
    assert.strictEqual(one.statusCode, 200, one.body);
    assert.ok(!one.body.includes('q3retro'));
    assert.strictEqual(body(one).set.total.questions, 41);
  });
  await check('opening an account is logged against the account, and spans its teams', async () => {
    seed();
    const res = await staffGet({ user: 'u-ana' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const audit = table.log.find((e) => e.kind === 'put' && e.input.Item.Action === 'stats.viewed');
    assert.deepStrictEqual(audit.input.Item.Target, { Type: 'user', Id: 'u-ana' });
    const b = body(res);
    assert.strictEqual(b.account.displayName, 'Ana Ruiz');
    const now = b.months[0];
    assert.deepStrictEqual(now.teams.map((t) => t.orgId).sort(), [HL, NW].sort());
  });
  await check('a library\'s sets are not logged and carry their plaintext names', async () => {
    seed();
    table.put({ PK: 'SETS', SK: 'SET#icebreakers', name: 'Quick icebreakers' });
    table.put({ PK: 'SETSTATS', SK: 'SET#icebreakers#V#3', sessions: 22, questions: 190 });
    const res = await staffGet({ library: 'platform' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).sets[0].name, 'Quick icebreakers');
    assert.ok(!table.log.some((e) => e.kind === 'put'), 'a library view wrote something');
  });

  say('\n§4 nothing here can decrypt');
  // rejects: a stats module reaching for tenant-crypto — the handlers would
  // need, and then hold, a kms:Decrypt they have no business with.
  await check('no tenant-crypto in the stats modules\' require graph', () => {
    const seen = new Set();
    const walk = (file, skip) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      assert.ok(!/decryptItem|decryptValue/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), `${path.relative(REPO, file)} calls decrypt`);
      for (const m of src.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        const next = require.resolve(path.resolve(path.dirname(file), m[1]));
        if (skip.some((s) => next.endsWith(s))) continue;
        assert.ok(!/tenant-crypto/.test(next), `${path.relative(REPO, file)} requires ${m[1]}`);
        walk(next, skip);
      }
    };
    walk(path.join(REPO, 'lambda-functions/admin/shared/usage-stats-view.js'), []);
    // The audit log seals its own Title/Reason (none is passed here): it is
    // the one crypto user, and it is not a stats module.
    walk(path.join(REPO, 'lambda-functions/admin/orgs/platform-stats.js'), ['audit-log.js']);
    const usageSrc = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/get-usage.js'), 'utf8');
    assert.ok(!/tenant-crypto|decrypt/.test(usageSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'get-usage.js reaches for crypto');
  });

  say('\n§5 the template');
  const routes = routesFromTemplate();
  assertScannerWorks(routes);
  // rejects: a route left open, or the stats served from a new function (the
  // stack is near its 500-resource cap: two route events, nothing else).
  await check('GET /orgs/{orgId}/stats and GET /platform/stats exist behind Cognito', () => {
    for (const p of ['/orgs/{orgId}/stats', '/platform/stats']) {
      const r = routes.find((x) => x.path === p && x.method === 'GET');
      assert.ok(r, `${p} missing`);
      assert.strictEqual(r.authorizer, 'CognitoAuthorizer', `${p} is open`);
    }
  });
  await check('they ride GetUsageFunction and PlatformOrgsFunction', () => {
    const tpl = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    // A resource block runs from its two-space key to the next one.
    const block = (name) => {
      const start = tpl.indexOf(`\n  ${name}:\n`);
      assert.ok(start !== -1, `${name} missing`);
      const next = /\n {2}[A-Za-z0-9]+:\n/g;
      next.lastIndex = start + name.length + 4;
      const m = next.exec(tpl);
      return tpl.slice(start, m ? m.index : tpl.length);
    };
    assert.ok(/Path: \/orgs\/\{orgId\}\/stats/.test(block('GetUsageFunction')));
    assert.ok(/Path: \/platform\/stats/.test(block('PlatformOrgsFunction')));
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e.stack); process.exit(1); });
