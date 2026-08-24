/**
 * THE GATE IS ON CREATING A SESSION. IT IS NOWHERE ELSE.
 *
 * A personal organisation includes five sessions and five stored question sets
 * and then MUST UPGRADE — it does not accrue overage, because a free account
 * has no payment method to meter against. A Team organisation is metered at
 * $0.25 a unit and is never refused anything.
 *
 * THE FAILURE THIS FILE EXISTS TO MAKE IMPOSSIBLE is the refusal moving one
 * step later. `docs/design/tenancy-redesign/RATIONALE.md` §3 — "Nothing is ever
 * blocked" — was written because the single moment a hard limit would fire is
 * the moment somebody is standing in front of a room. Creating a sixth session
 * is refused while nobody is waiting; a session that already exists runs to its
 * end whatever the meter says, and joining, answering, voting and results are
 * never gated. A "tidy-up" that moves this check into join-game.js or
 * start-game.js stops a room mid-round, and §3 below is what catches it.
 *
 * The other four things it pins:
 *
 *   - the arithmetic. `allowanceState` decides who is refused, so its boundary
 *     (the FIFTH session is fine, the sixth is not) is asserted directly.
 *   - the SHAPE of the refusal. A bare 403 with a sentence in it is a dead end;
 *     the console has to be able to draw an upgrade button without string-
 *     matching prose that a copy edit will change.
 *   - a team is NEVER gated, at any usage.
 *   - the three bundle copies of pricing.js and usage.js not drifting, because
 *     three Lambdas now decide the same question in three directories.
 *
 * Every check carries a `// rejects:` line naming the change it catches, and
 * every one was watched failing against a deliberately broken implementation.
 *
 * ── WHY THERE IS A KMS STUB IN A BILLING TEST ──────────────────────────────
 *
 * `schema-compliant-manager.js` encrypts a session's fields with a per-org data
 * key (tenant-crypto.js), so a create that gets PAST the gate cannot complete
 * without one. The stub is lifted from tests/tenant-crypto.js: real AES, fake
 * KMS. Without it "the create succeeded" and "the create failed for an
 * unrelated reason" would look the same from here.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- KMS, intercepted by request string ------------------------------------
// @aws-sdk/client-kms is not installed anywhere this file can resolve it from,
// so it cannot go through require.cache like the DynamoDB stubs below — the
// same interception tests/tenant-crypto.js uses.
const Module = require('module');
const moduleStubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (moduleStubs.has(request)) return moduleStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrapKey = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
moduleStubs.set('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrapKey(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

// ---- The fake table --------------------------------------------------------
const store = new Map();
const log = [];
const key = (pk, sk) => `${pk}|${sk}`;
/** "PK|SK" values whose next Put should blow up — for the rollback checks. */
let failPutOn = new Set();

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class BatchGetCommand { constructor(i) { this.input = i; this.type = 'batchGet'; } }

function conditionFailed(message) {
  const err = new Error(message);
  err.name = 'ConditionalCheckFailedException';
  return err;
}

/**
 * A SET-only UpdateExpression applier. Enough for start-game and update-game,
 * which is the point: the tests below assert on the ROW that changed, not on
 * the command that was issued, so a handler that writes the right expression
 * to the wrong partition is caught.
 */
function applyUpdate(item, inp) {
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const setClause = /SET\s+(.*?)(\s+REMOVE\s+|$)/is.exec(inp.UpdateExpression || '');
  if (setClause) {
    for (const pair of setClause[1].split(',')) {
      const [lhs, rhs] = pair.split('=').map((s) => s.trim());
      if (!lhs || !rhs) continue;
      const attr = names[lhs] || lhs;
      // Nested paths (HostPreferences.anonymousUntilReveal) — one level is enough.
      const parts = attr.split('.').map((p) => names[p] || p);
      let target = item;
      while (parts.length > 1) {
        const head = parts.shift();
        target[head] = target[head] || {};
        target = target[head];
      }
      target[parts[0]] = values[rhs];
    }
  }
  const removeClause = /REMOVE\s+(.*)$/is.exec(inp.UpdateExpression || '');
  if (removeClause) {
    for (const raw of removeClause[1].split(',')) {
      const attr = names[raw.trim()] || raw.trim();
      delete item[attr];
    }
  }
  return item;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });
    switch (cmd.type) {
      case 'put': {
        const k = key(inp.Item.PK, inp.Item.SK);
        if (failPutOn.has(k)) {
          failPutOn.delete(k);
          throw new Error(`injected write failure on ${k}`);
        }
        // The uniqueness lock, honoured for real — §8 and §9 depend on it.
        if (/attribute_not_exists\(PK\)/.test(inp.ConditionExpression || '') && store.has(k)) {
          throw conditionFailed(`row ${k} already exists`);
        }
        store.set(k, inp.Item);
        return {};
      }
      case 'get': {
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        return { Item: item ? { ...item } : undefined };
      }
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const existing = store.get(k);
        if (/attribute_exists\(PK\)/.test(inp.ConditionExpression || '') && !existing) {
          throw conditionFailed(`row ${k} does not exist`);
        }
        const item = existing || { PK: inp.Key.PK, SK: inp.Key.SK };
        store.set(k, applyUpdate({ ...item }, inp));
        return {};
      }
      case 'batchWrite': {
        for (const [, requests] of Object.entries(inp.RequestItems || {})) {
          for (const r of requests) {
            if (r.PutRequest) store.set(key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
            if (r.DeleteRequest) store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'batchGet': {
        const out = {};
        for (const [table, req] of Object.entries(inp.RequestItems || {})) {
          out[table] = (req.Keys || [])
            .map((kk) => store.get(key(kk.PK, kk.SK)))
            .filter(Boolean)
            .map((i) => ({ ...i }));
        }
        return { Responses: out };
      }
      case 'scan':
        return { Items: [...store.values()].map((i) => ({ ...i })) };
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] !== undefined ? v[':pk'] : v[':setpk'];
        const prefix = v[':sk'] !== undefined ? v[':sk'] : (v[':prefix'] || '');
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .map((i) => ({ ...i }));
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

// Each lambda-functions/<group>/ may carry its own node_modules, and Node
// resolves from the requiring file's directory upward — so stub every copy or
// the real SDK loads and the test dies on credentials instead of assertions.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
  path.join(REPO, 'lambda-functions', 'game'),
  path.join(REPO, 'lambda-functions', 'websocket'),
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
  if (!seen.size) throw new Error(`stub(): could not resolve ${name} from any of ${STUB_PATHS.join(', ')}`);
}

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
  ScanCommand, BatchWriteCommand, BatchGetCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.GAME_TABLE = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.DELETE_RETRY_BASE_MS = '1';


const createGameHandler = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;
const getAnswers = require(path.join(REPO, 'lambda-functions/game/get-answers.js')).handler;
const submitVote = require(path.join(REPO, 'lambda-functions/game/submit-vote.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;

const pricing = require(path.join(REPO, 'lambda-functions/game/pricing.js'));
const { PERSONAL_PLAN, TEAM_PLAN, allowanceState, upgradeRequired, planFor } = pricing;
const gameUsage = require(path.join(REPO, 'lambda-functions/game/usage.js'));

// Each bundle carries its own tenant-crypto with its own key cache, so all
// three are pointed at the same fake blob store — otherwise a session written
// by websocket/ cannot be read by game/.
const cryptos = ['websocket', 'game', 'admin/shared']
  .map((d) => require(path.join(REPO, 'lambda-functions', d, 'tenant-crypto.js')));
const blobs = new Map();
for (const c of cryptos) c.setCiphertextLoader(async (orgId) => blobs.get(orgId) || '');
async function mintKey(orgId) {
  if (!blobs.has(orgId)) blobs.set(orgId, await cryptos[0].createOrgDataKey(orgId));
  for (const c of cryptos) c.forgetOrg(orgId);
}

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

/** Keys whose next Get should blow up, so "the meter could not be read" can be
 *  provoked rather than argued about. Wrapped around the harness's own send so
 *  the fake table stays the shared one every module already holds. */
const failGetOn = new Set();
const passThrough = fakeDoc.send;
fakeDoc.send = async (cmd) => {
  if (cmd.type === 'get') {
    const k = key(cmd.input.Key.PK, cmd.input.Key.SK);
    if (failGetOn.has(k)) throw new Error(`injected read failure on ${k}`);
  }
  return passThrough(cmd);
};

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass++; }
  catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

// ---- Fixtures --------------------------------------------------------------
const SOLO = 'org_solo';           // a personal organisation, on the free plan
const TEAM = 'org_team';           // a Team organisation, metered
const PERIOD = gameUsage.periodOf(new Date());

const asHost = (orgId, extra = {}) => ({
  requestContext: {
    authorizer: {
      lambda: {
        userId: `user-${orgId}`, username: 'host', email: 'host@x.example',
        orgId, orgRole: 'admin', groups: 'hosts',
      },
    },
    http: { method: 'POST' },
  },
  ...extra,
});
const asParticipant = (extra = {}) => ({ ...extra });
const parse = (res) => JSON.parse(res.body || '{}');

/** An organisation row of the given type/plan, plus its data key. */
async function seedOrg(orgId, { type = 'personal', plan = 'free' } = {}) {
  store.set(key(`ORG#${orgId}`, 'METADATA'), {
    PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name: orgId, type, plan, status: 'active',
  });
  await mintKey(orgId);
}

/** The counters for the current period, written straight in — the meter itself
 *  is tests/usage-metering.js's subject, not this file's. */
function seedUsage(orgId, { sessionsRun = 0, setsCurrent = 0, setsPeak = null } = {}) {
  store.set(key(`ORG#${orgId}`, `USAGE#${PERIOD}`), {
    PK: `ORG#${orgId}`, SK: `USAGE#${PERIOD}`, orgId, period: PERIOD,
    sessionsRun, setsCurrent, setsPeak: setsPeak === null ? setsCurrent : setsPeak,
  });
}

async function createFor(orgId, body = {}) {
  return createGameHandler(asHost(orgId, {
    body: JSON.stringify({ eventTitle: 'Session', gameType: 'call-and-answer', ...body }),
  }));
}

function reset() { store.clear(); log.length = 0; failPutOn = new Set(); }

const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
const CSV = [HEADER, '"Renaissance",1,"THE SMILE","A portrait.","Leonardo","Invent a title.",""'].join('\n');

const uploadAs = (orgId, body) => upload({
  requestContext: {
    authorizer: {
      lambda: {
        userId: `user-${orgId}`, username: 'host', groups: 'hosts',
        orgId, orgRole: 'member', status: 'enabled',
      },
    },
    http: { method: 'POST' },
  },
  body: JSON.stringify({ fileName: 'x.csv', fileContent: CSV, ...body }),
});

(async () => {
  say('\nplan gating: a personal org is capped, a team is metered, a running room is neither\n');

  // ── 1. The arithmetic ────────────────────────────────────────────────────
  say('1. allowanceState — who is refused, and exactly when');

  await check('a fresh personal org has five of each', () => {
    const s = allowanceState(PERSONAL_PLAN, {});
    assert.strictEqual(s.sessionsLeft, 5);
    assert.strictEqual(s.setsLeft, 5);
    assert.strictEqual(s.mustUpgrade, false);
  });

  await check('the FIFTH session is included and the SIXTH is refused', () => {
    // rejects: an off-by-one that either charges for the fifth or gives away a
    // sixth. The allowance is 5 USED, so the gate closes at 5, not at 6.
    assert.strictEqual(allowanceState(PERSONAL_PLAN, { sessionsRun: 4 }).mustUpgradeForSession, false);
    assert.strictEqual(allowanceState(PERSONAL_PLAN, { sessionsRun: 5 }).mustUpgradeForSession, true);
  });

  await check('sets are gated on what is HELD, not on the peak the invoice bills', () => {
    // rejects: gating on setsPeak. 04-billing.html bills the peak on purpose
    // ("a set you created and deleted still counted"), but gating on it would
    // make deletion pointless and turn a storage allowance into a lifetime
    // quota of creations — somebody holding two sets could create nothing.
    const s = allowanceState(PERSONAL_PLAN, { setsCurrent: 2, setsPeak: 9 });
    assert.strictEqual(s.mustUpgradeForSet, false);
    assert.strictEqual(s.setsLeft, 3);
  });

  await check('a TEAM is never gated, at any usage', () => {
    const s = allowanceState(TEAM_PLAN, { sessionsRun: 5000, setsCurrent: 900 });
    assert.strictEqual(s.mustUpgrade, false);
    // rejects: reporting `0` left for a metered plan. Zero is a number a
    // consumer will compare against; "no limit" is not.
    assert.strictEqual(s.sessionsLeft, null);
    assert.strictEqual(s.setsLeft, null);
  });

  await check('an unreadable plan is PERSONAL, never Team', () => {
    // rejects: defaulting an unknown plan string to the metered one, which
    // hands unlimited billable usage to every row with a typo in it and
    // nobody to invoice.
    for (const plan of [undefined, '', 'FREE', 'gold', 'Team ', null]) {
      const expected = String(plan).trim().toLowerCase() === 'team' ? 'team' : 'personal';
      assert.strictEqual(planFor({ plan }).id, expected, `plan ${JSON.stringify(plan)}`);
    }
    assert.strictEqual(planFor(null).id, 'personal');
  });

  await check('the refusal names the limit, the plan and the price, in cents', () => {
    const body = upgradeRequired('sessions', allowanceState(PERSONAL_PLAN, { sessionsRun: 5 }));
    assert.strictEqual(body.code, 'upgrade_required');
    assert.deepStrictEqual(body.limit, { kind: 'sessions', planId: 'personal', used: 5, included: 5 });
    assert.strictEqual(body.upgrade.priceCents, 500);
    assert.strictEqual(body.upgrade.priceDisplay, '$5.00');
    // rejects: an amount that is a float or a string with a currency sign.
    assert.ok(Number.isInteger(body.upgrade.priceCents));
    assert.ok(Number.isInteger(body.upgrade.overageCents));
    // rejects: dropping `error`. Every client in this repo renders body.error;
    // a refusal without it draws "undefined" however good the payload is.
    assert.ok(/upgrade/i.test(body.error), body.error);
  });

  // ── 2. Creating a session ────────────────────────────────────────────────
  say('\n2. the sixth session is refused before anything is drawn');

  await check('a personal org inside its allowance creates a session', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { sessionsRun: 4 });
    const res = await createFor(SOLO);
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  await check('at the allowance it is refused — with 402, not 403', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { sessionsRun: 5 });
    const res = await createFor(SOLO);
    // rejects: answering 403. A 403 is drawn as a permission error with nothing
    // to click; this is "not yet, and here is the button", which is a different
    // screen. The status is how the console tells them apart without matching
    // on prose.
    assert.strictEqual(res.statusCode, 402, res.body);
    assert.strictEqual(parse(res).code, 'upgrade_required');
    assert.strictEqual(parse(res).limit.kind, 'sessions');
  });

  await check('and NOTHING is written — no code reserved, no brief, no metadata', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { sessionsRun: 5 });
    await createFor(SOLO);
    // rejects: checking the allowance AFTER createGame(). A refusal over a
    // session that already exists burns a four-digit code and leaves a brief
    // the host can see but not use.
    const written = [...store.values()].filter((i) => String(i.SK).startsWith('GAME#')
      || i.SK === 'METADATA' && String(i.PK).startsWith('GAME#'));
    assert.strictEqual(written.length, 0, `the refusal still wrote ${JSON.stringify(written)}`);
  });

  await check('a TEAM org at 500 sessions is not refused', async () => {
    reset();
    await seedOrg(TEAM, { type: 'team', plan: 'team' });
    seedUsage(TEAM, { sessionsRun: 500 });
    const res = await createFor(TEAM);
    // rejects: gating on the allowance without consulting `metersOverage`,
    // which would cap the paying customers too.
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  await check('an org with no METADATA row at all is not refused', async () => {
    reset();
    await mintKey(SOLO);
    seedUsage(SOLO, { sessionsRun: 99 });
    const res = await createFor(SOLO);
    // rejects: failing CLOSED on a missing plan. A half-deleted tenant or a row
    // that predates organisations is not a free-tier customer who has had their
    // five, and refusing it refuses somebody we cannot even name.
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  await check('an unreadable counter does not stop a session either', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { sessionsRun: 5 });
    failGetOn.add(key(`ORG#${SOLO}`, `USAGE#${PERIOD}`));
    const res = await createFor(SOLO);
    // rejects: letting a DynamoDB blip become "the product stopped working".
    // This is a commercial limit, not an authorisation boundary; the worst case
    // of failing open is a few unbilled sessions the ledger still records.
    assert.strictEqual(res.statusCode, 201, res.body);
    failGetOn.clear();
  });

  // ── 3. THE RUNNING ROOM ──────────────────────────────────────────────────
  say('\n3. a session that already exists runs to its end, whatever the meter says');

  await check('join, answers, vote and results all work while the org is far over', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { sessionsRun: 4 });
    const created = parse(await createFor(SOLO, { eventTitle: 'Live Room' }));
    const gameId = created.gameId;
    assert.ok(gameId, JSON.stringify(created));
    await startGame(asHost(SOLO, { pathParameters: { gameId } }));

    // The room is now live. The org blows past its allowance mid-session —
    // exactly what the meter does on the first join of the fifth and sixth
    // sessions of a busy afternoon.
    seedUsage(SOLO, { sessionsRun: 99, setsCurrent: 99 });

    // rejects: moving the allowance check into join-game.js. A participant
    // carries no token and no organisation; refusing them empties a room that
    // is already in front of somebody.
    const joined = await joinGame(asParticipant({
      pathParameters: { gameId },
      body: JSON.stringify({ playerName: 'Ada', clientId: 'browser-1' }),
    }));
    assert.strictEqual(joined.statusCode, 200, `join was gated: ${joined.body}`);

    // ANSWERS. rejects: gating the answer read, which blanks the host's screen
    // mid-round.
    store.set(key(`GAME#${gameId}`, 'QUESTION#001#ANSWER#Ada'), {
      PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada',
      PlayerName: 'Ada', QuestionNumber: '001', Answer: 'A thought',
    });
    const answers = await getAnswers(asParticipant({
      pathParameters: { gameId }, queryStringParameters: { role: 'host', questionId: '001' },
    }));
    assert.strictEqual(answers.statusCode, 200, `answers were gated: ${answers.body}`);

    // VOTE. rejects: gating the vote, which is the one moment a room is all
    // looking at the same screen.
    const state = store.get(key(`GAME#${gameId}`, 'STATE')) || { PK: `GAME#${gameId}`, SK: 'STATE' };
    store.set(key(`GAME#${gameId}`, 'STATE'), { ...state, State: 'VOTE#001' });
    const voted = await submitVote(asParticipant({
      pathParameters: { gameId },
      body: JSON.stringify({ playerName: 'Ada', questionNumber: 1, votes: { 0: 1 } }),
    }));
    assert.strictEqual(voted.statusCode, 200, `the vote was gated: ${voted.body}`);

    // RESULTS. rejects: gating the reveal, which is the payoff the whole
    // session exists for.
    // The room moves on to the reveal — the state a player's results fetch
    // waits for (get-results.js: "READ FREELY, CLOSE ONLY AS THE HOST").
    const voting = store.get(key(`GAME#${gameId}`, 'STATE'));
    store.set(key(`GAME#${gameId}`, 'STATE'), { ...voting, State: 'RESULTS#001' });
    const results = await getResults(asParticipant({
      pathParameters: { gameId },
      body: JSON.stringify({ questionNumber: '001' }),
    }));
    assert.ok(results.statusCode < 400, `results were gated: ${results.body}`);
  });

  await check('no handler in the participant journey so much as mentions the gate', () => {
    // rejects: a well-meaning "check the allowance here too" appearing in any
    // of these. A source scan, because the behavioural check above can only
    // catch the paths it walks, and this catches the ones it does not.
    const fs = require('fs');
    const journey = ['join-game.js', 'get-answers.js', 'submit-vote.js', 'get-results.js',
      'start-game.js', 'get-game.js', 'get-question.js', 'next-question.js'];
    for (const file of journey) {
      const p = path.join(REPO, 'lambda-functions/game', file);
      if (!fs.existsSync(p)) continue;
      const body = fs.readFileSync(p, 'utf8');
      assert.ok(!/readAllowance|mustUpgrade|upgradeRequired|UPGRADE_REQUIRED/.test(body),
        `${file} consults the allowance — a running session must never be gated`);
    }
  });

  // ── 4. Storing a question set ────────────────────────────────────────────
  say('\n4. the sixth stored set is refused, and editing the five is not');

  await check('a personal org inside its allowance creates a set', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { setsCurrent: 4 });
    const res = await uploadAs(SOLO, { customTitle: 'Retro One' });
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  await check('at the allowance a NEW set is refused with the same 402 shape', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { setsCurrent: 5 });
    const res = await uploadAs(SOLO, { customTitle: 'Retro Six' });
    assert.strictEqual(res.statusCode, 402, res.body);
    assert.strictEqual(parse(res).code, 'upgrade_required');
    assert.strictEqual(parse(res).limit.kind, 'sets');
    // rejects: writing the metadata row and then refusing.
    assert.strictEqual(store.get(key(`ORG#${SOLO}#SETS`, 'SET#retrosix')), undefined);
  });

  await check('but REPLACING an existing set still works at the limit', async () => {
    reset();
    await seedOrg(SOLO);
    seedUsage(SOLO, { setsCurrent: 4 });
    const first = await uploadAs(SOLO, { customTitle: 'Retro One' });
    assert.strictEqual(first.statusCode, 200, first.body);
    seedUsage(SOLO, { setsCurrent: 5 });
    const again = await uploadAs(SOLO, { customTitle: 'Retro One', replaceSetId: 'retroone' });
    // rejects: putting the gate outside the `!isReplace` branch. A replace adds
    // no set — it writes a new version of one already counted — and gating it
    // would stop somebody at their limit from FIXING what they have.
    assert.strictEqual(again.statusCode, 200, `a replace was gated: ${again.body}`);
  });

  await check('a TEAM org with 99 sets is not refused', async () => {
    reset();
    await seedOrg(TEAM, { type: 'team', plan: 'team' });
    seedUsage(TEAM, { setsCurrent: 99 });
    const res = await uploadAs(TEAM, { customTitle: 'Retro One' });
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  // ── 5. Three bundles, one answer ─────────────────────────────────────────
  say('\n5. three copies, byte for byte');

  await check('pricing.js is identical in game/, admin/shared/ and websocket/', () => {
    const fs = require('fs');
    const read = (d) => fs.readFileSync(path.join(REPO, 'lambda-functions', d, 'pricing.js'), 'utf8');
    // rejects: fixing an allowance in one bundle. websocket/ gates sessions and
    // admin/ gates sets; two copies that disagree refuse two different people.
    assert.strictEqual(read('game'), read('admin/shared'));
    assert.strictEqual(read('game'), read('websocket'));
  });

  await check('usage.js is identical in all three too', () => {
    const fs = require('fs');
    const read = (d) => fs.readFileSync(path.join(REPO, 'lambda-functions', d, 'usage.js'), 'utf8');
    assert.strictEqual(read('game'), read('admin/shared'));
    assert.strictEqual(read('game'), read('websocket'));
  });

  await check('and no ttl has crept onto a usage or ledger row', () => {
    const fs = require('fs');
    for (const d of ['game', 'admin/shared', 'websocket']) {
      const body = fs.readFileSync(path.join(REPO, 'lambda-functions', d, 'usage.js'), 'utf8');
      assert.ok(!/\bttl\b\s*:/.test(body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
        `${d}/usage.js stamps a ttl on a financial record`);
    }
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
