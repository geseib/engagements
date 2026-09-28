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
 * S3 is createMediaBucket's (above), so no suite that loads items.js can
 * reach a real bucket, and a presentation's slides are driven end to end.
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
  BatchGetCommand, TransactWriteCommand, BatchWriteCommand,
} = require('./player-table');
const kmsStubs = require('./tenant-crypto-stub');

const REPO = path.join(__dirname, '..', '..');

/**
 * THE MEDIA BUCKET, IN MEMORY — for a presentation's slides
 * (lambda-functions/websocket/events/deck-store.js). It keeps objects by key
 * and answers the five commands deck-store sends as S3 does where it matters:
 * a ranged GET returns only those bytes, with `Content-Range: bytes a-b/total`
 * (the handler reads the total from it); an empty object's range is a 416
 * `InvalidRange`; a missing key is `NoSuchKey`; CopyObject reads
 * `CopySource` as `bucket/key`. `put(key, bytes, {size})` stands in for the
 * browser's presigned PUT — `size` lets a suite claim 60 MB without holding it.
 * The presigner signs nothing: its URL names the command, the key, the expiry
 * and the content type, so a suite can read back exactly what was signed.
 */
function createMediaBucket() {
  const objects = new Map();
  const calls = [];
  const fail = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  class Command { constructor(input) { this.input = input; } }
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class CopyObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class S3Client {
    async send(command) {
      const { input } = command;
      calls.push({ name: command.constructor.name, input });
      if (command instanceof GetObjectCommand) {
        const obj = objects.get(input.Key);
        if (!obj) throw fail('NoSuchKey', 404);
        const total = obj.size;
        const m = /^bytes=(\d+)-(\d+)$/.exec(input.Range || '');
        if (m && !total) throw fail('InvalidRange', 416);
        const start = m ? Number(m[1]) : 0;
        const end = m ? Math.min(Number(m[2]), total - 1) : total - 1;
        const bytes = obj.body.subarray(start, end + 1);
        return {
          Body: { transformToByteArray: async () => new Uint8Array(bytes) },
          ContentLength: end - start + 1,
          ContentType: obj.contentType,
          ...(m ? { ContentRange: `bytes ${start}-${end}/${total}` } : {}),
        };
      }
      if (command instanceof CopyObjectCommand) {
        const source = String(input.CopySource).split('/').slice(1).join('/');
        const obj = objects.get(source);
        if (!obj) throw fail('NoSuchKey', 404);
        objects.set(input.Key, { ...obj, contentType: input.ContentType || obj.contentType });
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(input.Key);
        return {};
      }
      if (command instanceof PutObjectCommand) {
        const body = Buffer.from(input.Body || '');
        objects.set(input.Key, { body, size: body.length, contentType: input.ContentType });
        return {};
      }
      throw new Error(`fake S3: unsupported ${command.constructor.name}`);
    }
  }
  const signed = [];
  const presigner = {
    async getSignedUrl(client, command, { expiresIn } = {}) {
      const { input } = command;
      signed.push({ name: command.constructor.name, input, expiresIn });
      const type = input.ContentType || input.ResponseContentType || '';
      return `https://media.test.invalid/${input.Key}?op=${command.constructor.name}&expires=${expiresIn}&type=${encodeURIComponent(type)}`;
    },
  };
  return {
    objects,
    calls,
    signed,
    put(key, bytes, { size, contentType = 'application/pdf' } = {}) {
      const body = Buffer.from(bytes);
      objects.set(key, { body, size: size === undefined ? body.length : size, contentType });
    },
    exports: { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand },
    presigner,
  };
}

/**
 * @param {{eventsEnabled?: string|null}} [opts] the EVENTS_ENABLED value to
 *   start with; null leaves it unset.
 * @returns {{table, sent, REPO, load: (rel: string) => any}}
 */
function installEventHarness({ eventsEnabled = 'on' } = {}) {
  const table = createTable();
  const sent = [];
  const media = createMediaBucket();
  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => table.doc },
      GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
      BatchGetCommand, TransactWriteCommand, BatchWriteCommand,
    }],
    ['@aws-sdk/client-kms', kmsStubs.makeKmsStub().exports],
    ['@aws-sdk/client-s3', media.exports],
    ['@aws-sdk/s3-request-presigner', media.presigner],
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
  process.env.MEDIA_BUCKET = 'test-media';
  if (eventsEnabled === null) delete process.env.EVENTS_ENABLED;
  else process.env.EVENTS_ENABLED = eventsEnabled;

  kmsStubs.installTestKeyLoader();
  return { table, sent, media, REPO, load: (rel) => require(path.join(REPO, rel)) };
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
