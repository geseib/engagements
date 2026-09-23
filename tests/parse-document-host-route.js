/**
 * A HOST CAN ATTACH A DOCUMENT TO AN AI BUILDER.
 *
 * The four AI builders (TriviaAIBuilder, PollAIBuilder, SurveyAIBuilder,
 * AIScenarioBuilder) attach a PDF or DOCX through FileUploadPrompt, which posts
 * the bytes to `POST /admin/parse-document` and gets text back. Hosts were given
 * the builders — every generation route and its poll is in HOST_ADMIN_ROUTES —
 * but not this route, so it fell to the `path.startsWith('admin')` catch-all
 * and a host was answered 403 `{"message":"Forbidden"}`. FileUploadPrompt reads
 * `result.error`, which that body does not carry, so the host saw "Processing
 * failed: Unknown error" and nothing said why. TXT and MD never showed it: the
 * component reads those in the browser and never calls the route.
 *
 * Safe to share because the handler is a pure function of the bytes it is
 * sent: it caps them at 5 MB, parses them and returns text. It reads no caller
 * identity, no org, no table and no bucket, and its function carries no IAM
 * policy that would let it. Sections 4 and 5 pin that, so the day it grows a
 * table read this suite fails and the host exposure is reconsidered with it.
 *
 * rejects: a prefix (`admin/parse-document*`, or `admin/` generally) instead
 * of the exact pair; the route losing its authorizer, which would open it to
 * anyone rather than to hosts; a pending account passing; the handler reaching
 * for anything but its two parsers.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const PARSE_DOCUMENT = path.join(REPO, 'lambda-functions/admin/parse-document.js');

// ---- Stubs, installed before either handler loads --------------------------
// Intercepted by REQUEST STRING, like authorizer-org-context.js. Every request
// parse-document.js makes is also RECORDED, so section 4 can assert what it
// reaches for rather than what it happens to call on one input.
const Module = require('module');
const stubs = new Map();
const parseDocumentRequires = [];
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === PARSE_DOCUMENT) parseDocumentRequires.push(request);
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

let userGroups = [];
stubs.set('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send() { return { Groups: userGroups.map((GroupName) => ({ GroupName })) }; }
  },
  AdminListGroupsForUserCommand: class { constructor(i) { this.input = i; } },
});
stubs.set('jsonwebtoken', {
  decode: () => ({ header: { kid: 'test-kid' } }),
  verify: (token) => JSON.parse(token),
});
stubs.set('jwk-to-pem', () => 'stub-pem');
stubs.set('axios', { get: async () => ({ data: { keys: [{ kid: 'test-kid' }] } }) });
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  QueryCommand: class { constructor(i) { this.input = i; } },
  GetCommand: class { constructor(i) { this.input = i; } },
  DynamoDBDocumentClient: { from: () => ({ async send() { return { Items: [] }; } }) },
});

// The two parsers. What they are handed is recorded, which is how section 4
// proves an oversized upload is refused BEFORE any parsing happens.
//
// `pdf-parse` is shaped like 2.x — `new PDFParse(loadParams)`, `getText(parseParams)`,
// `destroy()` — and records both parameter objects, because the options this
// handler passes are the security-relevant part of the upgrade.
//
// `first`/`last` behave as 2.4.5's do, measured against the real library: an
// inclusive page range, clipped at the last page, empty wholly past it, and
// `total` is always the document's page count.
const parsed = [];
const pdfParsers = [];
let pdfThrows = null;
let pdfPages = null;
const ONE_PAGE = ['Quarterly   plan\n\n\nfor the offsite'];
stubs.set('pdf-parse', {
  PDFParse: class {
    constructor(loadParams) {
      this.loadParams = loadParams; this.destroyed = false; this.ranges = []; pdfParsers.push(this);
    }
    async getText(parseParams) {
      this.parseParams = parseParams;
      if (pdfThrows) throw new Error(pdfThrows);
      parsed.push({ kind: 'pdf', buffer: this.loadParams.data });
      const pages = pdfPages || ONE_PAGE;
      const first = parseParams.first || 1;
      const last = Math.min(parseParams.last || pages.length, pages.length);
      this.ranges.push([first, last]);
      const text = pages.slice(first - 1, last).map((t) => `${t}\n\n`).join('');
      return { text, total: pages.length, pages: [] };
    }
    async destroy() { this.destroyed = true; }
  },
});
stubs.set('mammoth', {
  extractRawText: async ({ buffer }) => {
    parsed.push({ kind: 'docx', buffer });
    return { value: 'Agenda\n\nitem one', messages: [] };
  },
});

process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'test-client-id';
process.env.REGION = 'us-east-1';

const authorizer = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const { requiredGroupsForRoute, hasPermission } = authorizer;
const parseDocument = require(PARSE_DOCUMENT);
const requiredAtLoad = [...parseDocumentRequires];
const { routesFromTemplate, findRoute, assertScannerWorks, TEMPLATE } = require('./helpers/template-routes');

// ---- Tiny harness ----------------------------------------------------------
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${label}`); }
  catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

/** A real payload-2.0 REQUEST authorizer event, as authorizer-org-context.js builds it. */
const authEvent = (routeKey) => {
  const token = JSON.stringify({ sub: 'user-sub-1', 'cognito:username': 'ada', email: 'ada@example.invalid' });
  const rawPath = routeKey.split(' ')[1];
  return {
    version: '2.0',
    type: 'REQUEST',
    routeKey,
    rawPath,
    identitySource: [`Bearer ${token}`],
    headers: { authorization: `Bearer ${token}` },
    requestContext: { routeKey, http: { method: routeKey.split(' ')[0], path: rawPath } },
  };
};
const authorize = async (groups, routeKey) => {
  userGroups = groups;
  return (await authorizer.handler(authEvent(routeKey))).isAuthorized;
};

const THE_ROUTE = 'POST /admin/parse-document';
// Its neighbour in template-clean.yaml, and admins-only: it files GitHub issues
// with the platform's token.
const NEIGHBOUR = 'POST /admin/create-github-issue';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const parse = (body, requestContext) => parseDocument.handler({
  requestContext: { http: { method: 'POST' }, ...(requestContext || {}) },
  body: JSON.stringify(body),
});

(async () => {
  console.log('\n1. the route stays behind the authorizer');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('POST /admin/parse-document carries CognitoAuthorizer', () => {
    const hit = findRoute(routes, 'POST', '/admin/parse-document');
    assert.ok(hit, 'the route is not in the template at all');
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer',
      `authorizer was ${JSON.stringify(hit.authorizer)} — opening it to hosts would open it to everyone`);
  });

  console.log('\n2. the exact pair is open to hosts, and nothing beside it');
  await check('POST admin/parse-document requires hosts or admins', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/parse-document'), ['hosts', 'admins']));
  await check('...and still refuses a pending account', () =>
    assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('POST', 'admin/parse-document')), false));
  for (const [m, p] of [
    ['POST', 'admin/create-github-issue'],
    ['POST', 'admin/ai-generate-prompt'],
    ['POST', 'admin/ai-prompt-advisor'],
    ['POST', 'admin/toggle-question-set/{setId}'],
    // Prefix probes: each would pass if the entry were a startsWith.
    ['GET', 'admin/parse-document'],
    ['POST', 'admin/parse-document/extra'],
    ['POST', 'admin/parse-documents'],
    ['POST', 'admin/parse-document-batch'],
  ]) {
    await check(`${m} ${p} stays admins-only`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute(m, p), ['admins'], `${m} ${p} is ${JSON.stringify(requiredGroupsForRoute(m, p))}`));
  }

  console.log('\n3. the real authorizer, with tokens');
  await check(`a host token is allowed on ${THE_ROUTE}`, async () =>
    assert.strictEqual(await authorize(['hosts'], THE_ROUTE), true));
  await check(`the same host token is refused on ${NEIGHBOUR}`, async () =>
    assert.strictEqual(await authorize(['hosts'], NEIGHBOUR), false));
  await check(`a pending token is refused on ${THE_ROUTE}`, async () =>
    assert.strictEqual(await authorize(['pending'], THE_ROUTE), false));
  await check(`an admin token is still allowed on ${THE_ROUTE}`, async () =>
    assert.strictEqual(await authorize(['admins'], THE_ROUTE), true));
  await check(`and still allowed on ${NEIGHBOUR}`, async () =>
    assert.strictEqual(await authorize(['admins'], NEIGHBOUR), true));

  console.log('\n4. the handler parses bytes and returns text, and reaches for nothing else');
  /*
    pdf-parse 2 loads pdf.js, which polyfills DOMMatrix from the native
    `@napi-rs/canvas` binary as it loads and throws `DOMMatrix is not defined`
    when that binary cannot be loaded. Required at the top of the file, a
    missing binary would take DOCX uploads down with PDFs.
  */
  await check('at load it requires mammoth only — pdf-parse waits for a PDF', () =>
    assert.deepStrictEqual(requiredAtLoad, ['mammoth']));
  await check('it reads no caller identity and no environment', () => {
    const src = fs.readFileSync(PARSE_DOCUMENT, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    assert.ok(!/authorizer/.test(src), 'parse-document.js reads the authorizer context');
    assert.ok(!/process\.env/.test(src), 'parse-document.js reads the environment (a table or bucket name)');
  });

  parsed.length = 0;
  const pdf = await parse({ fileContent: b64('%PDF-1.4 fake'), fileType: 'pdf', fileName: 'plan.pdf' });
  await check('a PDF: its decoded bytes reach the parser and the text comes back', () => {
    assert.strictEqual(pdf.statusCode, 200, pdf.body);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].buffer.toString('utf8'), '%PDF-1.4 fake');
    assert.strictEqual(JSON.parse(pdf.body).text, 'Quarterly plan for the offsite');
  });
  await check('...handed over as `data`, never as a `url` the parser would fetch', () => {
    const { loadParams } = pdfParsers[pdfParsers.length - 1];
    assert.ok(Buffer.isBuffer(loadParams.data), 'the PDF bytes were not passed as data');
    assert.strictEqual(loadParams.url, undefined, 'a url was passed — PDFParse would fetch it server-side');
  });
  await check('...with pdf.js eval off and no page markers in the text', () => {
    const { loadParams, parseParams } = pdfParsers[pdfParsers.length - 1];
    assert.strictEqual(loadParams.isEvalSupported, false);
    assert.strictEqual(parseParams.pageJoiner, '', '2.x appends "-- 1 of 2 --" per page unless told not to');
  });
  await check('...and the parser is destroyed afterwards', () =>
    assert.strictEqual(pdfParsers[pdfParsers.length - 1].destroyed, true));

  parsed.length = 0;
  const docx = await parse({ fileContent: b64('PK fake docx'), fileType: 'docx', fileName: 'agenda.docx' });
  await check('a DOCX: the same, through mammoth', () => {
    assert.strictEqual(docx.statusCode, 200, docx.body);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(JSON.parse(docx.body).text, 'Agenda item one');
  });

  await check('the answer is the same whoever asks — no org, no identity, no difference', async () => {
    const body = { fileContent: b64('%PDF-1.4 fake'), fileType: 'pdf' };
    const asHost = await parse(body, { authorizer: { lambda: { userId: 'u-1', groups: 'hosts', orgId: 'org_acme', orgIds: 'org_acme' } } });
    const asNobody = await parse(body);
    assert.deepStrictEqual(asHost, asNobody);
  });

  pdfThrows = 'Invalid PDF structure.';
  const broken = await parse({ fileContent: b64('not a pdf'), fileType: 'pdf', fileName: 'broken.pdf' });
  pdfThrows = null;
  await check('a PDF the parser rejects: an error naming why, and the parser still destroyed', () => {
    assert.strictEqual(broken.statusCode, 500, broken.body);
    assert.match(JSON.parse(broken.body).error, /Failed to parse PDF: Invalid PDF structure/);
    assert.strictEqual(pdfParsers[pdfParsers.length - 1].destroyed, true);
  });

  /*
    A LONG PDF IS READ ONLY AS FAR AS THE TEXT THAT IS KEPT.

    cleanText keeps 50,000 characters. Measured on a 400-page PDF: 1.1.1 read
    it all in 10.4s, 2.4.5 in 19-22s — against a 30s timeout on a function
    with a third of a vCPU — and 2.4.5 reading ten pages at a time and stopping
    once past the cap took 0.74s, keeping identical text.
  */
  const page = (n) => `Page ${n}: ${'revenue hiring risks owners '.repeat(35)}`;
  const normalise = (t) => t.replace(/\s+/g, ' ').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  const pdfNamed = { fileContent: b64('%PDF-1.4 fake'), fileType: 'pdf', fileName: 'long.pdf' };

  pdfPages = Array.from({ length: 400 }, (_, i) => page(i + 1));
  const long = await parse(pdfNamed);
  const longParser = pdfParsers[pdfParsers.length - 1];
  const fullRead = normalise(pdfPages.map((t) => `${t}\n\n`).join(''));
  pdfPages = null;
  await check('a 400-page PDF: the kept text is exactly what a full read would keep', () => {
    assert.strictEqual(long.statusCode, 200, long.body);
    assert.strictEqual(JSON.parse(long.body).text, `${fullRead.slice(0, 50000)}... [truncated]`);
  });
  await check('...read ten pages at a time, in order, and stopped once past the cap', () => {
    const expected = longParser.ranges.map((_, i) => [i * 10 + 1, i * 10 + 10]);
    assert.deepStrictEqual(longParser.ranges, expected);
    const lastPage = longParser.ranges[longParser.ranges.length - 1][1];
    assert.ok(lastPage < 400, `read to page ${lastPage} of 400 to keep 50,000 characters`);
    assert.ok(longParser.destroyed);
  });

  pdfPages = Array.from({ length: 25 }, (_, i) => page(i + 1));
  const short = await parse(pdfNamed);
  const shortParser = pdfParsers[pdfParsers.length - 1];
  const shortFull = normalise(pdfPages.map((t) => `${t}\n\n`).join(''));
  pdfPages = null;
  await check('a 25-page PDF under the cap: every page read, nothing truncated', () => {
    assert.strictEqual(short.statusCode, 200, short.body);
    assert.ok(shortFull.length < 50000);
    assert.strictEqual(JSON.parse(short.body).text, shortFull);
    assert.deepStrictEqual(shortParser.ranges, [[1, 10], [11, 20], [21, 25]]);
  });

  await check('across every upload it required its two parsers and nothing else — no SDK, no table, no bucket', () =>
    assert.deepStrictEqual([...new Set(parseDocumentRequires)].sort(), ['mammoth', 'pdf-parse']));

  parsed.length = 0;
  const FIVE_MB = 5 * 1024 * 1024;
  const oversized = 'A'.repeat(Math.ceil((FIVE_MB + 1) / 3) * 4);
  assert.ok(Buffer.byteLength(oversized, 'base64') > FIVE_MB);
  const big = await parse({ fileContent: oversized, fileType: 'pdf', fileName: 'huge.pdf' });
  await check('over 5 MB is refused, and refused BEFORE anything is parsed', () => {
    assert.notStrictEqual(big.statusCode, 200);
    assert.match(JSON.parse(big.body).error, /too large/i);
    assert.strictEqual(parsed.length, 0, 'the parser was handed an oversized upload');
  });

  console.log('\n5. the function could not reach tenant data even if it tried');
  await check('AdminParseDocumentFunction carries no Policies and no Role', () => {
    const lines = fs.readFileSync(TEMPLATE, 'utf8').split('\n');
    const start = lines.findIndex((l) => /^ {2}AdminParseDocumentFunction:\s*$/.test(l));
    assert.ok(start >= 0, 'AdminParseDocumentFunction is not in the template');
    let end = start + 1;
    while (end < lines.length && !/^ {2}\S/.test(lines[end])) end += 1;
    const block = lines.slice(start, end).join('\n');
    assert.ok(/Handler:\s*parse-document\.handler/.test(block), 'the block scanned is not the parse-document function');
    assert.ok(!/^\s+Policies:/m.test(block), 'the function has been granted Policies — re-check what a host can reach through it');
    assert.ok(!/^\s+Role:/m.test(block), 'the function has been given a Role — re-check what a host can reach through it');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
