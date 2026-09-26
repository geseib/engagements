/**
 * THE EVENT SUITES' TABLE, SDK AND KMS — installed once, before any handler
 * loads (roadmap M1, docs/superpowers/plans/2026-09-26-events-m1-event-and-builder.md).
 *
 * Every event suite drives real handlers against player-table.js's fake, which
 * EVALUATES ConditionExpressions and applies TransactWrites all-or-nothing, as
 * DynamoDB does. That matters more here than anywhere: the agenda's caps are
 * held by a transaction condition, and a fake that accepted every write would
 * pass a builder that lets two hosts add a ninth engagement. It also pages a
 * Query when `table.pageSize` is set, which is how a suite proves a handler
 * follows LastEvaluatedKey (the same model as paged-table.js; the event suites
 * need transactions, which only player-table.js models).
 *
 * THE SDK IS INTERCEPTED BY REQUEST STRING (Module._load), not by resolved
 * path. The websocket and admin bundles each carry their own node_modules, and
 * a path stub quietly misses one of them — the suite then dies on credentials
 * instead of on an assertion.
 *
 * KMS is tenant-crypto-stub.js's: it refuses a Decrypt with a missing or
 * mismatched encryption context, and `installTestKeyLoader` gives every bundle
 * copy a data key per org, different per org, so a cross-tenant decrypt still
 * fails here as it would in production.
 */
const path = require('path');
const Module = require('module');
const {
  createTable,
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchGetCommand, TransactWriteCommand,
} = require('./player-table');
const kmsStubs = require('./tenant-crypto-stub');

const REPO = path.join(__dirname, '..', '..');

/**
 * @param {{eventsEnabled?: string|null}} [opts] the EVENTS_ENABLED value to
 *   start with; null leaves it unset.
 * @returns {{table, sent, REPO, load: (rel: string) => any}}
 */
function installEventHarness({ eventsEnabled = 'on' } = {}) {
  const table = createTable();
  const sent = [];
  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => table.doc },
      GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
      BatchGetCommand, TransactWriteCommand,
    }],
    ['@aws-sdk/client-kms', kmsStubs.makeKmsStub().exports],
    ['@aws-sdk/client-apigatewaymanagementapi', {
      ApiGatewayManagementApiClient: class {
        async send(command) { sent.push(command.input); return {}; }
      },
      PostToConnectionCommand: class { constructor(input) { this.input = input; } },
    }],
  ]);
  const realLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return realLoad.call(this, request, parent, isMain);
  };

  process.env.TABLE_NAME = 'test-table';
  process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
  process.env.AWS_REGION = 'us-east-1';
  process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
  if (eventsEnabled === null) delete process.env.EVENTS_ENABLED;
  else process.env.EVENTS_ENABLED = eventsEnabled;

  kmsStubs.installTestKeyLoader();
  return { table, sent, REPO, load: (rel) => require(path.join(REPO, rel)) };
}

/** The authorizer's context for a signed-in host acting for `orgId`. */
function asHost(orgId, { groups = 'hosts', orgIds = orgId, userId = 'u_host', orgRole = 'member' } = {}) {
  return { authorizer: { lambda: { userId, groups, orgId, orgIds, orgRole } } };
}

/** An HTTP API (payload 2.0) request, as a handler receives it. */
function request({ method = 'GET', path: routePath = '/', pathParameters = {}, body, requestContext = null } = {}) {
  return {
    pathParameters,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    requestContext: { ...(requestContext || {}), http: { method, path: routePath } },
  };
}

/** An organisation's METADATA row: its plan decides the Team-plan gate. */
function seedOrg(table, orgId, { plan = 'team', type = 'team', name = orgId } = {}) {
  table.put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, plan, type, name });
}

/** `YYYY-MM-DDTHH:MM`, `days` from now (UTC date), for a start the rules accept. */
function startsIn(days, clockTime = '09:00') {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${clockTime}`;
}

/** A forced draw: offer these codes in order, then fail loudly. */
function drawing(...codes) {
  const queue = codes.map(String);
  return () => {
    if (!queue.length) throw new Error('the draw asked for more codes than the test offered');
    return queue.shift();
  };
}

/** Make `Math.random` offer these four-digit codes to drawCode(), in order. */
function offerCodes(...codes) {
  const queue = codes.slice();
  const real = Math.random;
  Math.random = () => {
    if (!queue.length) throw new Error('Math.random was asked for more codes than the test offered');
    return (Number(queue.shift()) - 1000 + 0.5) / 9000;
  };
  return () => { Math.random = real; };
}

const bodyOf = (res) => JSON.parse(res.body);

module.exports = {
  installEventHarness, asHost, request, seedOrg, startsIn, drawing, offerCodes, bodyOf, REPO,
};
