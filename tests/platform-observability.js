/**
 * THE PLATFORM CONSOLE'S OBSERVABILITY ROUTE — admin/orgs/platform-observability.js.
 *
 * GET /platform/observability answers "how is Engage being used?" for Engage
 * staff, in numbers. It is the one staff route that reaches into every
 * organisation's partitions at once, which is exactly why this suite spends
 * most of its length on what must NOT come back:
 *
 *   §1  only the Cognito `admins` group is answered — an org owner is not staff
 *   §2  the numbers are right: accounts, organisations, sets by library,
 *       stored reports, the plan meter per month, and the recorded counters
 *   §3  TENANCY: no organisation's name, id, set title, category name, report
 *       title, answer or member reaches the response; tenant partitions are
 *       COUNTED (Select: COUNT) and never read; no session partition is touched
 *   §4  one unreadable source costs its own tile, not the page
 *   §5  the route is closed in the template AND in the authorizer, reads the
 *       table and nothing more, and holds no key to decrypt anything
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const {
  createTable, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
} = require('./helpers/player-table');
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

const table = createTable();
const store = table.store;

/* ---- stubs: every copy of each SDK a handler under admin/ could resolve --- */
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
  path.join(REPO, 'lambda-functions', 'admin', 'orgs'),
  path.join(REPO, 'lambda-functions', 'admin', 'shared'),
];
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

/** A Cognito pool of `n` users, served 60 to a page as the real API does. */
const cognito = { users: 0, fail: null, calls: [] };
class ListUsersCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send(command) {
      cognito.calls.push(command.input);
      if (cognito.fail) throw cognito.fail;
      const start = Number(command.input.PaginationToken || 0);
      const end = Math.min(start + (command.input.Limit || 60), cognito.users);
      const Users = [];
      for (let i = start; i < end; i += 1) {
        Users.push({ Username: `user-${i}`, Attributes: [{ Name: 'sub', Value: `sub-${i}` }, { Name: 'email', Value: `person${i}@acme.example` }] });
      }
      return { Users, ...(end < cognito.users ? { PaginationToken: String(end) } : {}) };
    }
  },
  ListUsersCommand,
});
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => table.doc },
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.USER_POOL_ID = 'us-east-1_TESTPOOL';

const handler = require(path.join(REPO, 'lambda-functions/admin/orgs/platform-observability.js')).handler;
const M = require(path.join(REPO, 'lambda-functions/admin/shared/platform-metrics.js'));
const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

/* ---- the estate ----------------------------------------------------------- */

const TEAM = 'org_1111111111111111111111';
const HOME = 'org_2222222222222222222222';

/** Every string that belongs to a customer. None may appear in a response. */
const SECRETS = [
  TEAM, HOME,
  'Acme Restructure Team', 'Jane Doe',
  'Board Offsite Retro', 'Layoffs and Morale', 'What worries you most?',
  'Acme Board Review', 'honestly the new VP', 'person0@acme.example', 'sub-0',
];

function seed() {
  table.clear();
  cognito.users = 65; cognito.fail = null; cognito.calls.length = 0;
  const put = table.put;

  // The ORGS index, as create-org.js and personal-org.js write it.
  put({ PK: 'ORGS', SK: `ORG#${TEAM}`, orgId: TEAM, name: 'Acme Restructure Team', type: 'team', plan: 'team', status: 'active' });
  put({ PK: 'ORGS', SK: `ORG#${HOME}`, orgId: HOME, name: 'Jane Doe', type: 'personal', plan: 'free', status: 'active' });

  // Question sets: 3 Engage, 1 public, 2 + 1 in teams' own libraries.
  for (const id of ['icebreakers', 'retro', 'trivia-night']) put({ PK: 'SETS', SK: `SET#${id}`, name: id });
  put({ PK: 'PUBLIC#SETS', SK: 'SET#orgx-party', name: 'Party games' });
  put({ PK: `ORG#${TEAM}#SETS`, SK: 'SET#board', name: 'Board Offsite Retro' });
  put({ PK: `ORG#${TEAM}#SETS`, SK: 'SET#morale', name: 'Layoffs and Morale' });
  put({ PK: `ORG#${HOME}#SETS`, SK: 'SET#mine', name: 'My set' });
  put({ PK: `ORG#${TEAM}#SET#board#v1`, SK: 'CATEGORY#c001', Name: 'Layoffs and Morale' });
  put({ PK: `ORG#${TEAM}#SET#board#v1`, SK: 'QUESTION#c001#001', Title: 'What worries you most?', Category: 'Layoffs and Morale' });

  // Stored reports: 2 in the team, 1 orgless in the platform partition.
  put({ PK: `ORG#${TEAM}#REPORTS`, SK: 'REPORT#1234#2026-09-01T00:00:00Z#aaaaaa', Title: 'Acme Board Review', permanent: false });
  put({ PK: `ORG#${TEAM}#REPORTS`, SK: 'REPORT#1235#2026-09-02T00:00:00Z#bbbbbb', Title: 'Acme Board Review', permanent: true });
  put({ PK: 'REPORTS', SK: 'REPORT#9999#2026-09-03T00:00:00Z#cccccc', Title: 'Demo' });

  // The plan meter: 4 + 1 in September; a meter row with nothing counted in August.
  put({ PK: `ORG#${TEAM}`, SK: 'USAGE#2026-09', orgId: TEAM, period: '2026-09', sessionsRun: 4, setsCurrent: 2 });
  put({ PK: `ORG#${HOME}`, SK: 'USAGE#2026-09', orgId: HOME, period: '2026-09', sessionsRun: 1, setsCurrent: 1 });
  put({ PK: `ORG#${TEAM}`, SK: 'USAGE#2026-08', orgId: TEAM, period: '2026-08', sessionsRun: 0, setsCurrent: 2 });
  put({ PK: `ORG#${TEAM}`, SK: 'LEDGER#2026-09#SESSION#1234', orgId: TEAM, gameId: '1234' });
  put({ PK: `ORG#${TEAM}`, SK: 'MEMBER#abc', email: 'person0@acme.example' });

  // A live session and an answer: nothing here may be read at all.
  put({ PK: 'GAME#1234', SK: 'METADATA', orgId: TEAM, Title: 'Board Offsite Retro' });
  put({ PK: 'GAME#1234', SK: 'QUESTION#001#ANSWER#Ada', Answer: 'honestly the new VP' });

  // The recorded counters, as platform-metrics.js writes them.
  put({ PK: M.METRICS_PK, SK: M.monthSk('2026-09'), sessionsCreated: 9, sessionsStarted: 6, roundsServed: 30, sessionsServed: 5, answersStored: 140, firstRecordedAt: '2026-09-23T10:00:00.000Z' });
  put({ PK: M.METRICS_PK, SK: M.categorySk('2026-09', 'platform#leadership'), label: 'Leadership', library: 'platform', rounds: 12, answers: 80 });
  put({ PK: M.METRICS_PK, SK: M.categorySk('2026-09', 'public#party games'), label: 'Party games', library: 'public', rounds: 3, answers: 10 });
  put({ PK: M.METRICS_PK, SK: M.categorySk('2026-09', 'org'), label: M.TEAM_SETS_LABEL, library: 'org', rounds: 15, answers: 50 });
}

const event = (lambda, method = 'GET') => ({
  requestContext: { http: { method }, authorizer: lambda ? { lambda } : {} },
});
const STAFF = { userId: 'staff-1', groups: 'admins', orgId: '' };
const STAFF_IN_AN_ORG = { userId: 'staff-1', groups: 'admins,hosts', orgId: TEAM, orgRole: 'owner' };
const TEAM_OWNER = { userId: 'owner-1', groups: 'hosts', orgId: TEAM, orgRole: 'owner' };

const body = (res) => JSON.parse(res.body);
const tenantReads = () => table.log.filter((e) => e.type === 'query' && /^ORG#/.test(e.input.ExpressionAttributeValues[':pk']));

(async () => {
  say('\nplatform-observability: how Engage is used, in numbers, for staff only\n');

  /* ----------------------------------------------------------------------- */
  say('§1 who is answered');
  seed();
  // rejects: a route that trusts the nav, or the authorizer alone.
  await check('no identity at all is refused', async () => {
    assert.strictEqual((await handler(event(null))).statusCode, 403);
  });
  // rejects: gating on an org ROLE. Owning an organisation is not working on Engage.
  await check('a team owner who is not Engage staff is refused', async () => {
    const res = await handler(event(TEAM_OWNER));
    assert.strictEqual(res.statusCode, 403);
    assert.ok(!res.body.includes('sessions'), 'a refusal must carry no numbers');
  });
  await check('Engage staff are answered', async () => {
    assert.strictEqual((await handler(event(STAFF))).statusCode, 200);
  });
  // platform-orgs.js makes the same choice: the GROUP decides, the mode is a view.
  await check('…whichever library the switcher is standing in', async () => {
    assert.strictEqual((await handler(event(STAFF_IN_AN_ORG))).statusCode, 200);
  });
  await check('a preflight is answered and anything but GET is not a route', async () => {
    assert.ok([200, 204].includes((await handler(event(null, 'OPTIONS'))).statusCode));
    assert.strictEqual((await handler(event(STAFF, 'POST'))).statusCode, 404);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§2 the numbers');
  seed();
  const res = await handler(event(STAFF));
  const out = body(res);
  await check('accounts are counted across every page of the pool', () => {
    assert.deepStrictEqual(out.now.accounts, { count: 65, capped: false });
    assert.strictEqual(cognito.calls.length, 2);
  });
  // rejects: asking Cognito for every attribute of every person to count them.
  await check('…asking for no more than each account’s sub', () => {
    for (const c of cognito.calls) {
      assert.deepStrictEqual(c.AttributesToGet, ['sub']);
      assert.strictEqual(c.UserPoolId, 'us-east-1_TESTPOOL');
    }
  });
  await check('organisations split into teams and personal spaces', () => {
    assert.deepStrictEqual(out.now.organisations, { teams: 1, personal: 1 });
  });
  await check('question sets are counted per library', () => {
    assert.deepStrictEqual(out.now.questionSets, { platform: 3, public: 1, org: 3, total: 7 });
  });
  await check('stored reports count every team’s index and the platform’s', () => {
    assert.strictEqual(out.now.storedReports, 3);
  });
  await check('the plan meter is summed across organisations per month', () => {
    const sept = out.months.find((m) => m.period === '2026-09');
    assert.strictEqual(sept.counted, 5);
  });
  // rejects: listing a month in which the meter counted nothing and nothing
  // was recorded — before the meter was wired every month reads 0.
  await check('a month with nothing counted and nothing recorded is not listed', () => {
    assert.deepStrictEqual(out.months.map((m) => m.period), ['2026-09']);
  });
  await check('the recorded counters come back with their average', () => {
    const sept = out.months.find((m) => m.period === '2026-09');
    assert.deepStrictEqual(sept.recorded, {
      sessionsCreated: 9, sessionsStarted: 6, roundsServed: 30, sessionsServed: 5, answersStored: 140, averageRounds: 6,
    });
    assert.strictEqual(out.countingSince, '2026-09-23T10:00:00.000Z');
  });
  await check('categories: named for Engage and public sets, one unnamed bucket last', () => {
    assert.deepStrictEqual(out.categories.map((c) => [c.label, c.library, c.rounds, c.answers]), [
      ['Leadership', 'platform', 12, 80],
      ['Party games', 'public', 3, 10],
      [M.TEAM_SETS_LABEL, 'org', 15, 50],
    ]);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§3 tenancy: aggregates only');
  // rejects: any customer string reaching the staff screen — an org name from
  // the index, a set title, an org category, a report title, an answer, an email.
  await check('no customer string is anywhere in the response', () => {
    for (const s of SECRETS) assert.ok(!res.body.includes(s), `the response contains ${JSON.stringify(s)}`);
  });
  // rejects: reading a tenant's rows to count them. Select: COUNT returns a
  // number and no items, so no org's set or report row enters this Lambda.
  await check('every tenant SETS and REPORTS partition is counted, never read', () => {
    const reads = tenantReads().filter((e) => /#(SETS|REPORTS)$/.test(e.input.ExpressionAttributeValues[':pk']));
    assert.ok(reads.length >= 3, `only ${reads.length} tenant partitions were counted`);
    for (const e of reads) assert.strictEqual(e.input.Select, 'COUNT', `${e.input.ExpressionAttributeValues[':pk']} was read, not counted`);
  });
  // rejects: querying ORG#<id> without a prefix, which returns members,
  // invites and ledger rows along with the counters.
  await check('an organisation’s own partition is read only for its USAGE# counters', () => {
    const own = tenantReads().filter((e) => /^ORG#[^#]+$/.test(e.input.ExpressionAttributeValues[':pk']));
    assert.ok(own.length >= 2);
    for (const e of own) {
      assert.strictEqual(e.input.ExpressionAttributeValues[':sk'], 'USAGE#');
      assert.ok(e.input.ProjectionExpression, 'the counter read carries no projection');
    }
  });
  // rejects: reaching into a session or a set's content.
  await check('no session partition and no set content partition is touched', () => {
    const touched = table.log.map((e) => (e.input.Key && e.input.Key.PK) || (e.input.ExpressionAttributeValues || {})[':pk']);
    assert.deepStrictEqual(touched.filter((pk) => /^GAME#|#SET#|^SET#|^PUBLIC#SET#/.test(String(pk))), []);
  });
  await check('nothing is written', () => {
    assert.deepStrictEqual(table.log.filter((e) => ['put', 'update', 'delete'].includes(e.type)), []);
  });
  // rejects: trusting a stored label for the teams' bucket.
  await check('a metrics row that claims a name for the teams’ bucket is not believed', async () => {
    store.get(table.keyOf(M.METRICS_PK, M.categorySk('2026-09', 'org'))).label = 'Layoffs and Morale';
    const again = await handler(event(STAFF));
    assert.ok(!again.body.includes('Layoffs and Morale'));
  });

  /* ----------------------------------------------------------------------- */
  say('\n§4 one failure costs one tile');
  seed();
  cognito.fail = Object.assign(new Error('User: arn:aws:sts::1:assumed-role/x is not authorized'), { name: 'AccessDeniedException' });
  const noPool = body(await handler(event(STAFF)));
  // rejects: a Cognito error taking the whole page down with it.
  await check('an unreadable user pool nulls Accounts and says so, the rest stands', () => {
    assert.strictEqual(noPool.now.accounts, null);
    assert.ok(noPool.unavailable.some((u) => u.part === 'accounts'), JSON.stringify(noPool.unavailable));
    assert.strictEqual(noPool.now.storedReports, 3);
    assert.strictEqual(noPool.months.length, 1);
  });

  seed();
  cognito.users = 60 * 120;
  await check('a pool too large to page through is reported as at least that many', async () => {
    const big = body(await handler(event(STAFF)));
    assert.strictEqual(big.now.accounts.capped, true);
    assert.ok(big.now.accounts.count >= 6000);
  });

  seed();
  const realSend = table.doc.send;
  table.doc.send = async (command) => {
    if (command.type === 'query' && command.input.ExpressionAttributeValues[':pk'] === 'ORGS') throw new Error('throttled');
    return realSend(command);
  };
  const noIndex = body(await handler(event(STAFF)));
  table.doc.send = realSend;
  await check('an unreadable organisation index nulls what depends on it, not the recorded counters', () => {
    assert.strictEqual(noIndex.now.organisations, null);
    assert.strictEqual(noIndex.now.questionSets, null);
    assert.strictEqual(noIndex.now.storedReports, null);
    assert.ok(noIndex.unavailable.some((u) => u.part === 'organisations'));
    assert.strictEqual(noIndex.months[0].recorded.roundsServed, 30);
    assert.strictEqual(noIndex.months[0].counted, null);
    assert.strictEqual(noIndex.now.accounts.count, 65);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§5 closed, read-only, keyless');
  const routes = routesFromTemplate();
  await check('the template scanner is working', () => assertScannerWorks(routes));
  // rejects: shipping the route without the authorizer — the handler check
  // would then be the only thing between the internet and the numbers.
  await check('GET /platform/observability is behind CognitoAuthorizer', () => {
    const r = findRoute(routes, 'GET', '/platform/observability');
    assert.ok(r, 'the route is not in template-clean.yaml');
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer');
  });
  // rejects: letting it fall through to the trailing ['hosts','admins'] default.
  await check('the authorizer names it staff-only, by template and by concrete path', () => {
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'platform/observability'), ['admins']);
  });

  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const start = template.indexOf('Handler: orgs/platform-observability.handler');
  const fnStart = template.lastIndexOf('\n  PlatformObservabilityFunction:', start);
  const fnEnd = template.indexOf('\n  # ', start);
  const block = fnStart >= 0 && start >= 0 ? template.slice(fnStart, fnEnd > 0 ? fnEnd : undefined) : '';
  await check('its function reads the table, and cannot write it', () => {
    assert.ok(block, 'no PlatformObservabilityFunction block');
    assert.match(block, /DynamoDBReadPolicy:/);
    assert.doesNotMatch(block, /DynamoDBCrudPolicy|DynamoDBWritePolicy/);
  });
  // rejects: widening the Cognito grant past the one call it makes.
  await check('its only Cognito power is ListUsers on this stack’s pool', () => {
    const actions = [...block.matchAll(/cognito-idp:(\w+)/g)].map((m) => m[1]);
    assert.deepStrictEqual(actions, ['ListUsers']);
    assert.match(block, /Resource: !GetAtt UserPoolV2\.Arn/);
    assert.match(block, /USER_POOL_ID: !Ref UserPoolV2/);
  });
  // rejects: a decrypt grant on the one staff route that sees every tenant.
  await check('it holds no KMS grant and requires no crypto', () => {
    assert.doesNotMatch(block, /kms:/);
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/orgs/platform-observability.js'), 'utf8');
    const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    assert.ok(requires.length >= 4, `found only ${requires.length} requires — the scan has rotted`);
    assert.deepStrictEqual(requires.filter((r) => /crypto/.test(r)), []);
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})().catch((e) => { say(e.stack); process.exit(1); });
