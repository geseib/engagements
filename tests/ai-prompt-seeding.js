/**
 * WHAT populate-defaults.js ACTUALLY PUTS IN S3, and why the shape matters.
 *
 * The runtime reads a prompt's body from the S3 object, not from the DynamoDB
 * metadata row (get-ai-summary.js:209-244). get-ai-summary.js:2168-2174 then
 * accepts a `template`, OR `instructions` AND `outputFormat` together — and
 * `template` WINS OUTRIGHT when present, so the other two are never read.
 *
 * This seeder used to write all three at once:
 *
 *     template:     promptData.template,
 *     instructions: promptData.template,
 *     outputFormat: "Provide your analysis in the specified format …",
 *
 * which meant the two named halves the editor is built around were decorative
 * on every shipped default: the engine took the template and discarded them,
 * and promptPreflight's promptSources() mirrors that rule, so it declined to
 * report on them too. Nineteen prompts carried one boilerplate sentence as
 * their entire format contract.
 *
 * These tests run the real handler with the AWS SDK stubbed and read what it
 * tried to write. They are about the SHAPE of the record, not its prose.
 *
 * Stubbing note: intercept Module._load by request name — client-s3 exists only
 * in the deployed bundle, so require.cache poisoning by path silently misses.
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const TABLE = 'engage-seed-test';
const BUCKET = 'engage-seed-prompts';

let pass = 0;
let fail = 0;
const check = (label, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${label}`); } catch (e) {
    fail++; console.log(`  FAIL  ${label}\n        ${e.message}`);
  }
};
/** Same, for a body that has to await a reseed. A rejection must not pass. */
const checkAsync = async (label, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${label}`); } catch (e) {
    fail++; console.log(`  FAIL  ${label}\n        ${e.message}`);
  }
};

/* ------------------------------------------------------------- stubbing -- */

const s3Puts = [];
const ddbPuts = [];
let existingItems = [];

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

const fakeDoc = {
  send: async (cmd) => {
    if (cmd.type === 'query') return { Items: existingItems };
    if (cmd.type === 'put') { ddbPuts.push(cmd.input.Item); return {}; }
    return {};
  },
};

class PutObjectCommand { constructor(i) { this.input = i; } }

const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => fakeDoc },
    GetCommand, PutCommand, QueryCommand,
  }],
  ['@aws-sdk/client-s3', {
    S3Client: class { async send(cmd) { s3Puts.push(cmd.input); return {}; } },
    PutObjectCommand,
  }],
]);

const realLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, ...rest);
};

process.env.TABLE_NAME = TABLE;
process.env.AI_PROMPTS_BUCKET = BUCKET;

/* ------------------------------------------------------------- the run -- */

// The handler is chatty by design; its console.log is the wrong output here.
const realLog = console.log;
const quiet = () => { console.log = () => {}; };
const loud = () => { console.log = realLog; };

async function seed({ existing = [], overwrite = false } = {}) {
  s3Puts.length = 0;
  ddbPuts.length = 0;
  existingItems = existing;
  delete require.cache[require.resolve(path.join(REPO, 'lambda-functions', 'admin', 'populate-defaults.js'))];
  const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'populate-defaults.js'));
  quiet();
  const res = await handler({ body: JSON.stringify({ overwrite }) });
  loud();
  return { res, body: JSON.parse(res.body) };
}

const bodyOf = (put) => JSON.parse(put.Body);

(async () => {
  console.log('\npopulate-defaults.js — the record it writes\n');

  const defaults = require(path.join(REPO, 'lambda-functions', 'admin', 'default-ai-prompts.json'));
  const shippedCount = Object.values(defaults)
    .reduce((n, categories) => n + Object.keys(categories).length, 0);

  const { body } = await seed();

  check('every shipped default is seeded, none errors', () => {
    assert.strictEqual(body.results.errors, 0, JSON.stringify(body.results));
    assert.strictEqual(body.results.created, shippedCount,
      `created ${body.results.created} of ${shippedCount}`);
  });

  const objects = s3Puts.map(bodyOf);

  check('every S3 record carries both halves', () => {
    const missing = objects.filter((o) => !o.instructions || !o.outputFormat);
    assert.strictEqual(missing.length, 0,
      `${missing.length} record(s) lack a half: ${missing.map((o) => o.name).join(', ')}`);
  });

  check('no S3 record carries a `template` alongside the halves', () => {
    // The whole point. A `template` here would be taken by
    // get-ai-summary.js:2168 and the outputFormat half would never be read.
    const shadowed = objects.filter((o) => o.template);
    assert.strictEqual(shadowed.length, 0,
      `${shadowed.length} record(s) still write a template that suppresses outputFormat: `
      + shadowed.map((o) => o.name).join(', '));
  });

  check('the outputFormat is the prompt\'s own, not one boilerplate sentence reused', () => {
    const formats = new Set(objects.map((o) => o.outputFormat));
    assert(formats.size >= 2,
      `all ${objects.length} prompts share ${formats.size} output format(s) — the seeder is `
      + 'substituting a constant rather than passing the authored half through');
    const boiler = objects.filter((o) =>
      /^Provide your analysis in the specified format/.test(o.outputFormat));
    assert.strictEqual(boiler.length, 0,
      `${boiler.length} record(s) still carry the old placeholder outputFormat`);
  });

  check('the halves are passed through byte-for-byte from the JSON', () => {
    for (const [gameType, categories] of Object.entries(defaults)) {
      for (const [scenario, p] of Object.entries(categories)) {
        const written = objects.find((o) => o.name === p.name);
        assert(written, `${gameType}/${scenario} was never written`);
        assert.strictEqual(written.instructions, p.instructions, `${p.name}: instructions differ`);
        assert.strictEqual(written.outputFormat, p.outputFormat, `${p.name}: outputFormat differs`);
      }
    }
  });

  check('each record satisfies the engine\'s shape gate', () => {
    const { isUsableSummaryPrompt } = require(path.join(REPO, 'lambda-functions', 'game', 'prompt-shape.js'));
    const unusable = objects.filter((o) => !isUsableSummaryPrompt(o));
    assert.strictEqual(unusable.length, 0,
      `${unusable.length} record(s) would fall through to the game-type default silently: `
      + unusable.map((o) => o.name).join(', '));
  });

  check('a declared output shape reaches S3, where the runtime reads it', () => {
    const art = objects.find((o) => /Art & Creative Titles/.test(o.name));
    assert(art, 'the art prompt was not written');
    assert(Array.isArray(art.outputSections) && art.outputSections.length === 5,
      `art outputSections: ${JSON.stringify(art.outputSections && art.outputSections.length)}`);
  });

  check('every record is stamped promptType analysis', () => {
    const wrong = objects.filter((o) => o.promptType !== 'analysis');
    assert.strictEqual(wrong.length, 0, `${wrong.length} record(s) are not analysis prompts`);
  });

  /* --------------------------------------------------------- the gate -- */

  check('a JSON entry with neither shape is refused rather than seeded', () => {
    // Simulated by proving the guard exists and names both alternatives: the
    // handler catches per-prompt errors into results.errors, so a malformed
    // entry must increment that rather than write a record the engine cannot
    // use. Checked against the source because the JSON is the shipped artifact
    // and must not be corrupted to run a test.
    const src = require('fs').readFileSync(
      path.join(REPO, 'lambda-functions', 'admin', 'populate-defaults.js'), 'utf8');
    assert(/hasTemplate\s*&&/.test(src) || /!hasTemplate\s*&&\s*!hasHalves/.test(src),
      'no shape gate in the seeder');
    assert(/throw new Error\(/.test(src), 'the gate does not stop the write');
  });

  /* ------------------------------------------- identity across a reseed -- */

  await checkAsync('overwrite reuses the promptId of the row with the same name', async () => {
    // `name` is the ONLY anchor: promptId is minted here and appears nowhere in
    // the JSON. A reseed that fails to match by name mints a new id, and every
    // question set carrying the old one is left pointing at the stale row.
    const target = defaults['call-and-answer']['lessons-learned'];
    const { body: b2 } = await seed({
      existing: [{ promptId: 'existing-id-42', name: target.name }],
      overwrite: true,
    });
    assert.strictEqual(b2.results.overwritten, 1, JSON.stringify(b2.results));
    const reused = ddbPuts.find((i) => i.promptId === 'existing-id-42');
    assert(reused, 'the existing promptId was not reused — every attached set would be orphaned');
    assert.strictEqual(reused.name, target.name);
  });

  await checkAsync('a name the table does not know is created, not overwritten', async () => {
    const { body: b3 } = await seed({
      existing: [{ promptId: 'unrelated', name: 'Some Prompt That Was Renamed Away' }],
      overwrite: true,
    });
    assert.strictEqual(b3.results.overwritten, 0, JSON.stringify(b3.results));
    assert.strictEqual(b3.results.created, shippedCount, JSON.stringify(b3.results));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { loud(); console.error('harness error:', e); process.exit(2); });
